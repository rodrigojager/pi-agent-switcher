import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Markdown, getKeybindings } from "@earendil-works/pi-tui";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import {
  type RoleCatalog,
  type RoleResolution,
  resolveRole,
} from "pi-subagent-runtime/roles";
import { pickItems } from "./picker.js";

export function pickRole(
  ctx: ExtensionContext,
  catalog: RoleCatalog,
  current?: string,
  agentRole?: string,
  delegation = false,
  readonly = false,
) {
  const roles = catalog.roles.map((r) => ({
    name: r.name,
    metadata: [r.category, r.source === "project" ? "Project" : undefined]
      .filter(Boolean)
      .join(" · "),
    value: r.id,
    description: r.description,
    searchText: `${r.id} ${r.category}`,
  }));
  const choices = delegation
    ? [
        {
          name: `Default — ${resolveRole(catalog, agentRole).displayName ?? "None"}`,
          value: "default",
          description: "Use this agent's configured role",
        },
        {
          name: "None",
          value: "none",
          description: "Ignore this agent's configured role",
        },
        ...roles,
      ]
    : [
        { name: "None", value: "none", description: "No professional role" },
        ...roles,
      ];
  return pickItems(
    ctx,
    choices,
    delegation ? "default" : (current ?? "none"),
    readonly
      ? "Browse roles · Role from agent configuration"
      : delegation
        ? "Role for this task"
        : "Role for Pi default",
    "cards",
  );
}

/** Preview is a UI surface, never a chat message or model-history entry. */
export async function previewRole(ctx: ExtensionContext, role: RoleResolution) {
  const text = [
    `${role.displayName ?? "None"} · ${role.effectiveId ?? role.requestedId ?? "none"}`,
    `Status: ${role.status} · Origin: ${role.origin}`,
    role.sourcePath ? `Source: ${role.sourcePath}` : "",
    role.body ?? "No role instructions applied.",
  ]
    .filter(Boolean)
    .join("\n\n");
  if (!ctx.hasUI) {
    ctx.ui.notify(text, "info");
    return;
  }
  if (ctx.mode !== "tui") {
    await ctx.ui.select(text, ["Close"]);
    return;
  }
  await ctx.ui.custom<void>((tui, theme, _keys, done) => {
    const box = new Box(1, 1);
    box.addChild(new Markdown(text, 0, 0, getMarkdownTheme()));
    let offset = 0;
    let maximum = 0;
    return {
      invalidate: () => box.invalidate(),
      render: (width) => {
        const lines = box.render(width);
        const budget = Math.max(1, tui.terminal.rows - 4);
        maximum = Math.max(0, lines.length - budget);
        offset = Math.min(offset, maximum);
        return [
          ...lines.slice(offset, offset + budget),
          theme.fg("dim", "↑↓ scroll · Enter/Esc close"),
        ];
      },
      handleInput: (data) => {
        const keys = getKeybindings();
        if (
          keys.matches(data, "tui.select.cancel") ||
          keys.matches(data, "tui.select.confirm")
        )
          done();
        else if (keys.matches(data, "tui.select.up"))
          offset = Math.max(0, offset - 1);
        else if (keys.matches(data, "tui.select.down"))
          offset = Math.min(maximum, offset + 1);
        tui.requestRender();
      },
    };
  });
}
