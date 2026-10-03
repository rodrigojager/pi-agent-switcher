import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Input,
  getKeybindings,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type TUI,
} from "@earendil-works/pi-tui";
import type { AgentConfig } from "./agents.js";
import { discoverRoles, resolveRole } from "pi-subagent-runtime/roles";

export interface PickerItem {
  name: string;
  description: string;
  value: string;
}
function normalize(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
export function filterItems(items: PickerItem[], query: string) {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  return items.filter((item) =>
    words.every((word) =>
      normalize(`${item.name} ${item.description}`).includes(word),
    ),
  );
}
/** Focus stays in a real Input, preserving paste, undo, backspace and Unicode handling. */
export class AgentPicker {
  readonly input = new Input({
    prompt: "Search: ",
    placeholder: "Name, ID, category or description",
  });
  private selected = 0;
  private matches: PickerItem[];
  private focus = false;
  constructor(
    private items: PickerItem[],
    private current: string | undefined,
    private title: string,
    private tui: Pick<TUI, "requestRender"> & { terminal?: { rows: number } },
    private theme: Theme,
    private done: (result: string | null) => void,
  ) {
    this.matches = items;
    this.selected = Math.max(
      0,
      items.findIndex((item) => item.value === current),
    );
    this.input.onSubmit = () => {
      const item = this.matches[this.selected];
      if (item) this.done(item.value);
    };
    this.input.onEscape = () => this.done(null);
  }
  get focused() {
    return this.focus;
  }
  set focused(value: boolean) {
    this.focus = value;
    this.input.focused = value;
  }
  invalidate() {
    this.input.invalidate();
  }
  handleInput(data: string) {
    const kb = getKeybindings();
    if (kb.matches(data, "tui.select.cancel")) this.done(null);
    else if (kb.matches(data, "tui.select.confirm")) {
      const item = this.matches[this.selected];
      if (item) this.done(item.value);
    } else if (kb.matches(data, "tui.select.up"))
      this.selected =
        (this.selected - 1 + this.matches.length) %
        Math.max(1, this.matches.length);
    else if (kb.matches(data, "tui.select.down"))
      this.selected = (this.selected + 1) % Math.max(1, this.matches.length);
    else {
      const before = this.input.getValue();
      this.input.handleInput(data);
      if (before !== this.input.getValue()) {
        this.matches = filterItems(this.items, this.input.getValue());
        this.selected = 0;
      }
    }
    this.tui.requestRender();
  }
  render(width: number) {
    const w = Math.max(1, width);
    const inner = Math.max(1, w - 4);
    const line = (text: string) => truncateToWidth(`  ${text}`, w, "");
    const lines = [
      this.theme.fg("accent", "─".repeat(w)),
      line(this.theme.bold(this.title)),
      line(`Active: ${this.current ?? "Pi default"}`),
      ...this.input.render(inner).map(line),
      "",
    ];
    const rowBudget = Math.max(
      1,
      Math.floor((this.tui.terminal?.rows ?? 40) * 0.8) - 9,
    );
    const entryRows =
      inner >= 60 &&
      this.matches.every((item) => visibleWidth(item.name) + 15 < inner)
        ? 1
        : 3;
    const maxVisible = Math.max(
      1,
      Math.min(7, Math.floor(rowBudget / entryRows)),
    );
    const start = Math.max(
      0,
      Math.min(
        this.selected - Math.floor(maxVisible / 2),
        this.matches.length - maxVisible,
      ),
    );
    for (
      let i = start;
      i < Math.min(this.matches.length, start + maxVisible);
      i++
    ) {
      const item = this.matches[i]!;
      const prefix = i === this.selected ? "› " : "  ";
      const name = this.theme.bold(item.name);
      const badge = item.value === this.current ? " · active" : "";
      const label = `${prefix}${name}${badge}`;
      const description = item.description.replace(/[\r\n]+/g, " ");
      if (visibleWidth(label) + 5 < inner && inner >= 60) {
        lines.push(
          line(
            `${i === this.selected ? this.theme.fg("accent", label) : label}  ${this.theme.fg("muted", truncateToWidth(description, inner - visibleWidth(label) - 2))}`,
          ),
        );
      } else {
        lines.push(
          line(i === this.selected ? this.theme.fg("accent", label) : label),
        );
        lines.push(
          ...wrapTextWithAnsi(
            this.theme.fg("muted", description),
            Math.max(1, inner - 2),
          )
            .slice(0, 2)
            .map((text) => line(`  ${text}`)),
        );
      }
    }
    if (!this.matches.length)
      lines.push(line(this.theme.fg("warning", "No matching items")));
    lines.push(
      "",
      line(
        this.theme.fg(
          "dim",
          `${this.matches.length} result(s) · ↑↓ navigate · Enter select · Esc cancel`,
        ),
      ),
      this.theme.fg("accent", "─".repeat(w)),
    );
    return lines;
  }
}
export async function pickAgent(
  ctx: ExtensionContext,
  agents: AgentConfig[],
  current: string | undefined,
  delegation = false,
) {
  const catalog = await discoverRoles({
    cwd: ctx.cwd,
    allowProject: ctx.isProjectTrusted(),
  });
  const items: PickerItem[] = agents.map((agent) => ({
    name: agent.name,
    value: agent.name,
    description: `${agent.description} · Role: ${resolveRole(catalog, agent.role).displayName ?? "None"}`,
  }));
  if (!delegation)
    items.push({
      name: "Pi default",
      value: "__reset__",
      description:
        "Restore the original prompt, tools, model and thinking level",
    });
  if (!ctx.hasUI) {
    ctx.ui.notify(
      "Use /agent <name> or /delegate <name> <task> in this mode.",
      "warning",
    );
    return null;
  }
  if (ctx.mode !== "tui")
    return (
      (await ctx.ui.select(
        delegation ? "Delegate to agent" : "Switch agent",
        items.map((item) => item.value),
      )) ?? null
    );
  return ctx.ui.custom<string | null>(
    (tui, theme, _keys, done) =>
      new AgentPicker(
        items,
        current,
        delegation ? "Delegate to an agent" : "Switch main agent",
        tui,
        theme,
        done,
      ),
    {
      overlay: true,
      overlayOptions: {
        width: "85%",
        maxHeight: "80%",
        minWidth: 20,
        anchor: "center",
      },
    },
  );
}

export async function pickItems(
  ctx: ExtensionContext,
  items: PickerItem[],
  current: string | undefined,
  title: string,
) {
  if (!ctx.hasUI) return null;
  if (ctx.mode !== "tui") {
    const labels = items.map((item) => `${item.name} — ${item.description}`);
    const selected = await ctx.ui.select(title, labels);
    return selected ? (items[labels.indexOf(selected)]?.value ?? null) : null;
  }
  return ctx.ui.custom<string | null>(
    (tui, theme, _keys, done) =>
      new AgentPicker(items, current, title, tui, theme, done),
    {
      overlay: true,
      overlayOptions: {
        width: "85%",
        maxHeight: "80%",
        minWidth: 20,
        anchor: "center",
      },
    },
  );
}
