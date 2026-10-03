import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import type { AgentConfig } from "./agents.js";

export const DELEGATION_CHANNEL = "rodrigojager:pi-subagent:delegate:v1";
export interface DelegationReply {
  ok: boolean;
  message: string;
}
export interface DelegationRequest {
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
): Promise<DelegationReply> {
  let run: (() => Promise<DelegationReply>) | undefined;
  pi.events.emit(DELEGATION_CHANNEL, {
    agent,
    task,
    context: ctx,
    accept: (handler) => {
      run ??= handler;
    },
  } satisfies DelegationRequest);
  if (!run)
    return {
      ok: false,
      message:
        "Delegation needs rodrigojager/pi-subagent v0.12.4-rodrigo.2 or newer. You can still use /run <agent> <task>.",
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
    task: match[3]?.trim() ?? "",
    explicit: !!match[1],
  };
}
export function agentAutocomplete(
  base: AutocompleteProvider,
  agents: () => Promise<AgentConfig[]>,
): AutocompleteProvider {
  return {
    triggerCharacters: [...new Set([...(base.triggerCharacters ?? []), "@"])],
    shouldTriggerFileCompletion: base.shouldTriggerFileCompletion?.bind(base),
    async getSuggestions(lines, row, col, options) {
      const before = lines[row]?.slice(0, col) ?? "";
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
      if (!item.value.startsWith("@agent:"))
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
