import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "./agents.js";

export interface Baseline {
  tools: string[];
  model?: { provider: string; id: string };
  thinking: ReturnType<ExtensionAPI["getThinkingLevel"]>;
}
export interface PersistedState {
  baseConversationRole?: string;
  currentAgent: string | null;
  baseline?: Baseline;
  overrides?: Record<string, ProfileOverride>;
}
export interface ProfileOverride {
  model?: { provider: string; id: string };
  thinking?: ReturnType<ExtensionAPI["getThinkingLevel"]>;
}
export class AgentStateManager {
  baseConversationRole: string | undefined;
  agent: AgentConfig | null = null;
  baseline: Baseline | undefined;
  overrides: Record<string, ProfileOverride> = {};
  capture(pi: ExtensionAPI, ctx: ExtensionContext): Baseline {
    return {
      tools: pi.getActiveTools(),
      model: ctx.model
        ? { provider: ctx.model.provider, id: ctx.model.id }
        : undefined,
      thinking: pi.getThinkingLevel(),
    };
  }
  persist(pi: ExtensionAPI) {
    pi.appendEntry("agent-switcher-state", {
      currentAgent: this.agent?.name ?? null,
      baseConversationRole: this.baseConversationRole,
      baseline: this.baseline,
      overrides: this.overrides,
    } satisfies PersistedState);
  }
}
