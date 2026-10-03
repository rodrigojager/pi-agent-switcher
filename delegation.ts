import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import type { AgentConfig } from "./agents.js";
import {
  parseRolePrefix,
  discoverRoles,
  resolveRole,
} from "pi-subagent-runtime/roles";

export const DELEGATION_CHANNEL = "rodrigojager:pi-subagent:delegate:v2";
export interface DelegationReply {
  ok: boolean;
  message: string;
}
export interface DelegationRequest {
  role?: string;
  agent: string;
  task: string;
  context: ExtensionContext;
  accept: (run: () => Promise<DelegationReply>) => void;
}
export async function delegate(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  agent: string,
  task: string,
  role?: string,
): Promise<DelegationReply> {
  let run: (() => Promise<DelegationReply>) | undefined;
  pi.events.emit(DELEGATION_CHANNEL, {
    agent,
    task,
    ...(role !== undefined ? { role } : {}),
    context: ctx,
    accept: (handler) => {
      run ??= handler;
    },
  } satisfies DelegationRequest);
  if (!run)
    return {
      ok: false,
      message:
        "Role-aware delegation needs rodrigojager/pi-subagent v0.13.0-rodrigo.1 or newer (v2 bridge). Update the runtime and reload Pi.",
    };
  return run();
}
export function parseMention(text: string, agents: AgentConfig[]) {
  const match = text.match(
    /^\s*@(?:(agent):)?([a-zA-Z0-9][a-zA-Z0-9_.-]*)(?:\s+([\s\S]*))?$/,
  );
  if (!match) return undefined;
  const agent = agents.find((a) => a.name === match[2]);
  if (!agent && !match[1]) return undefined; // Leave ordinary @file references alone.
  return {
    agent: agent?.name,
    ...(() => {
      try {
        return parseRolePrefix(match[3] ?? "");
      } catch (error) {
        return {
          task: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })(),
    explicit: !!match[1],
  };
}
export function agentAutocomplete(
  base: AutocompleteProvider,
  agents: () => Promise<AgentConfig[]>,
  workspace?: () => { cwd: string; allowProject: boolean },
): AutocompleteProvider {
  return {
    triggerCharacters: [...new Set([...(base.triggerCharacters ?? []), "@"])],
    shouldTriggerFileCompletion: base.shouldTriggerFileCompletion?.bind(base),
    async getSuggestions(lines, row, col, options) {
      const before = lines[row]?.slice(0, col) ?? "";
      const roleMatch =
        row === 0
          ? before.match(
              /^\s*@(?:agent:)?(\S+)\s+--role(?:=|\s+)([a-z0-9._-]*)$/,
            )
          : null;
      if (roleMatch) {
        const available = await agents();
        const selected = available.find((a) => a.name === roleMatch[1]);
        if (!selected) return base.getSuggestions(lines, row, col, options);
        const catalog = await discoverRoles(
          workspace?.() ?? { cwd: process.cwd() },
        );
        const prefix = roleMatch[2]!;
        const items = ["default", "none", ...catalog.roles.map((r) => r.id)]
          .filter((id) => id.startsWith(prefix))
          .map((id) => ({
            value: id,
            label: id,
            description:
              id === "default"
                ? `Agent default: ${resolveRole(catalog, selected.role).displayName ?? "None"}`
                : id === "none"
                  ? "Ignore this agent's configured role"
                  : catalog.roles.find((r) => r.id === id)?.description,
          }));
        return options.signal.aborted ? null : { prefix, items };
      }
      const match =
        row === 0 ? before.match(/^\s*(@(?:agent:)?[a-zA-Z0-9_.-]*)$/) : null;
      if (!match) return base.getSuggestions(lines, row, col, options);
      const prefix = match[1]!;
      const query = prefix.replace(/^@(?:agent:)?/, "").toLowerCase();
      const [available, native] = await Promise.all([
        agents(),
        prefix.startsWith("@agent:")
          ? Promise.resolve(null)
          : base.getSuggestions(lines, row, col, options),
      ]);
      if (options.signal.aborted) return null;
      const items = available
        .filter((a) => a.name.toLowerCase().includes(query))
        .map((a) => ({
          value: `@agent:${a.name}`,
          label: `@${a.name}`,
          description: `Delegate · ${a.description}`,
        }));
      if (native && native.prefix !== prefix) return native;
      return items.length || native?.items.length
        ? { prefix, items: [...items, ...(native?.items ?? [])] }
        : null;
    },
    applyCompletion(lines, row, col, item, prefix) {
      const roleCompletion =
        /^\s*@(?:agent:)?\S+\s+--role(?:=|\s+)[a-z0-9._-]*$/.test(
          (lines[row] ?? "").slice(0, col),
        );
      if (!item.value.startsWith("@agent:") && !roleCompletion)
        return base.applyCompletion(lines, row, col, item, prefix);
      const text = lines[row] ?? "";
      const before = text.slice(0, col - prefix.length);
      const next = [...lines];
      next[row] = `${before}${item.value} ${text.slice(col)}`;
      return {
        lines: next,
        cursorLine: row,
        cursorCol: before.length + item.value.length + 1,
      };
    },
  };
}
