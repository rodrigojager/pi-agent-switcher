import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { stat } from "node:fs/promises";
import path from "node:path";
import {
  discoverAgents,
  discoverDelegates,
  type AgentConfig,
} from "./agents.js";
import {
  AgentStateManager,
  type PersistedState,
  type Baseline,
} from "./agent-state.js";
import { pickAgent } from "./picker.js";
import { delegate, parseMention, agentAutocomplete } from "./delegation.js";
import {
  discoverRoles,
  resolveRole,
  rolePrompt,
  declaredRole,
  parseRolePrefix,
  type RoleCatalog,
} from "pi-subagent-runtime/roles";
import { pickRole, previewRole } from "./role-picker.js";

export default function agentSwitcherExtension(pi: ExtensionAPI) {
  const state = new AgentStateManager();
  let cwd = process.cwd();
  let selecting = false;
  let changing = false;
  const catalogFor = (ctx: ExtensionContext) =>
    discoverRoles({ cwd: ctx.cwd, allowProject: ctx.isProjectTrusted() });
  const effectiveRole = (catalog: RoleCatalog) =>
    state.agent
      ? resolveRole(catalog, state.agent.role)
      : resolveRole(
          catalog,
          undefined,
          state.baseConversationRole ?? "none",
          "base-conversation",
        );
  const status = async (ctx: ExtensionContext) => {
    const role = effectiveRole(await catalogFor(ctx));
    ctx.ui.setStatus(
      "agent-switcher",
      `Agent: ${state.agent?.name ?? "Pi default"} | Role: ${role.displayName ?? "None"}`,
    );
  };
  const report = (ctx: ExtensionContext, error: unknown) =>
    ctx.ui.notify(
      error instanceof Error ? error.message : String(error),
      "error",
    );
  const primary = async (ctx: ExtensionContext) =>
    (await discoverAgents(ctx.cwd)).agents.filter((a) => a.mode !== "subagent");

  function modelFor(
    agent: AgentConfig | undefined,
    baseline: Baseline,
    ctx: ExtensionContext,
  ) {
    const override = agent ? state.overrides[agent.name]?.model : undefined;
    if (override) {
      const model = ctx.modelRegistry.find(override.provider, override.id);
      if (!model)
        throw new Error(
          `Selected model is no longer available: ${override.provider}/${override.id}`,
        );
      return model;
    }
    if (!agent?.model)
      return baseline.model
        ? ctx.modelRegistry.find(baseline.model.provider, baseline.model.id)
        : undefined;
    const slash = agent.model.indexOf("/");
    const provider =
      agent.provider ?? (slash > 0 ? agent.model.slice(0, slash) : undefined);
    const id = slash > 0 ? agent.model.slice(slash + 1) : agent.model;
    const model = provider
      ? ctx.modelRegistry.find(provider, id)
      : ctx.modelRegistry.find(
          baseline.model?.provider ?? ctx.model?.provider ?? "",
          id,
        );
    if (model) return model;
    const matches = provider
      ? []
      : ctx.modelRegistry.getAvailable().filter((m) => m.id === id);
    if (matches.length === 1) return matches[0];
    throw new Error(
      `Model unavailable or ambiguous for ${agent.name}: ${agent.model}`,
    );
  }
  async function change(
    name: string | null,
    ctx: ExtensionContext,
    persist = true,
  ) {
    if (!ctx.isIdle() || changing)
      throw new Error(
        "Wait for the current turn to finish before switching the main agent.",
      );
    changing = true;
    try {
      const agent = name
        ? (await primary(ctx)).find((a) => a.name === name)
        : undefined;
      if (name && !agent)
        throw new Error(
          `Unknown main agent: ${name}. Open /agent to see available profiles.`,
        );
      if (agent?.source === "project" && !ctx.isProjectTrusted())
        throw new Error(
          "Trust this project in Pi before activating its agent profile.",
        );
      if (!agent && !state.baseline) {
        state.agent = null;
        if (persist) state.persist(pi);
        await status(ctx);
        return;
      }
      const baseline = state.baseline ?? state.capture(pi, ctx);
      const tools = agent?.tools ?? baseline.tools;
      const configured = new Set(
        pi
          .getAllTools()
          .filter((t) => t.exposure !== "hidden")
          .map((t) => t.name),
      );
      const missing = tools.filter((tool) => !configured.has(tool));
      if (missing.length)
        throw new Error(`Unavailable tools: ${missing.join(", ")}`);
      const model = modelFor(agent, baseline, ctx);
      if (baseline.model && !agent?.model && !model)
        throw new Error(
          `Original model is no longer available: ${baseline.model.provider}/${baseline.model.id}`,
        );
      const modelChanged =
        model &&
        (model.provider !== ctx.model?.provider || model.id !== ctx.model?.id);
      if (modelChanged && !(await pi.setModel(model)))
        throw new Error(
          `Authentication unavailable for ${model.provider}/${model.id}`,
        );
      pi.setActiveTools(tools);
      pi.setThinkingLevel(
        (agent ? state.overrides[agent.name]?.thinking : undefined) ??
          agent?.thinking ??
          baseline.thinking,
      );
      state.baseline = agent ? baseline : undefined;
      state.agent = agent ?? null;
      if (persist) state.persist(pi);
      await status(ctx);
      if (persist)
        ctx.ui.notify(
          agent ? `Main agent: ${agent.name}` : "Pi default restored",
          "info",
        );
    } finally {
      changing = false;
    }
  }
  async function open(ctx: ExtensionContext, delegation = false) {
    if (selecting) return;
    if (!delegation && !ctx.isIdle()) {
      ctx.ui.notify(
        "Wait for the current turn to finish before switching the main agent.",
        "info",
      );
      return;
    }
    selecting = true;
    try {
      const agents = delegation
        ? (await discoverDelegates(ctx.cwd)).agents
        : await primary(ctx);
      if (delegation && !agents.length) {
        ctx.ui.notify(
          "No subagent definitions found in .pi/agents or ~/.pi/agent/agents.",
          "warning",
        );
        return;
      }
      const choice = await pickAgent(
        ctx,
        agents,
        state.agent?.name,
        delegation,
      );
      if (!choice) return;
      if (!delegation)
        await change(choice === "__reset__" ? null : choice, ctx);
      else {
        const role = await pickRole(
          ctx,
          await catalogFor(ctx),
          undefined,
          agents.find((a) => a.name === choice)?.role,
          true,
        );
        if (role === null) return;
        const task = await ctx.ui.input(
          `Task for ${choice}`,
          "Describe the task and include the context the specialist needs",
        );
        if (task?.trim()) await dispatch(ctx, choice, task.trim(), role);
      }
    } catch (error) {
      report(ctx, error);
    } finally {
      selecting = false;
    }
  }
  async function dispatch(
    ctx: ExtensionContext,
    agent: string,
    task: string,
    role?: string,
  ) {
    const result = await delegate(pi, ctx, agent, task, role);
    if (!result.ok) throw new Error(result.message);
    ctx.ui.notify(result.message, "info");
  }
  async function restore(ctx: ExtensionContext) {
    cwd = ctx.cwd;
    const previousBaseline = state.baseline;
    state.agent = null;
    let saved: PersistedState | undefined;
    for (const entry of ctx.sessionManager.getBranch())
      if (
        entry.type === "custom" &&
        entry.customType === "agent-switcher-state"
      )
        saved = entry.data as PersistedState | undefined;
    state.baseline = saved?.baseline ?? previousBaseline;
    state.overrides = saved?.overrides ?? {};
    state.baseConversationRole = declaredRole(saved?.baseConversationRole);
    try {
      if (saved?.currentAgent) await change(saved.currentAgent, ctx, false);
      else if (state.baseline) await change(null, ctx, false);
    } catch (error) {
      report(ctx, error);
    }
    await status(ctx);
  }
  pi.on("session_start", async (_event, ctx) => {
    await restore(ctx);
    if (ctx.mode === "tui")
      ctx.ui.addAutocompleteProvider((base) =>
        agentAutocomplete(
          base,
          async () => (await discoverDelegates(cwd)).agents,
          () => ({ cwd, allowProject: ctx.isProjectTrusted() }),
        ),
      );
  });
  pi.on("session_tree", async (_event, ctx) => restore(ctx));
  pi.on("model_select", (event) => {
    if (!state.agent || changing || event.source === "restore") return;
    state.overrides = {
      ...state.overrides,
      [state.agent.name]: {
        ...state.overrides[state.agent.name],
        model: { provider: event.model.provider, id: event.model.id },
      },
    };
    state.persist(pi);
  });
  pi.on("thinking_level_select", (event) => {
    if (!state.agent || changing) return;
    state.overrides = {
      ...state.overrides,
      [state.agent.name]: {
        ...state.overrides[state.agent.name],
        thinking: event.level,
      },
    };
    state.persist(pi);
  });
  pi.on("resources_discover", (_event, ctx) => {
    cwd = ctx.cwd;
  });
  pi.on("before_agent_start", async (event, ctx) => {
    const agent = state.agent;
    const options = event.systemPromptOptions;
    delete options.sections.professional_role;
    delete options.sections.agent_profile;
    const role = effectiveRole(await catalogFor(ctx));
    const contribution = rolePrompt(role);
    if (contribution) options.sections.professional_role = contribution;
    await status(ctx);
    if (!agent) return;
    if (agent.skills !== undefined) {
      const allow = agent.skills === false ? [] : agent.skills;
      const unknown = allow.filter(
        (name) => !options.skills.some((skill) => skill.name === name),
      );
      options.skills = options.skills.filter((skill) =>
        allow.includes(skill.name),
      );
      if (unknown.length)
        ctx.ui.notify(
          `Skills are not loaded in this Pi session and were omitted: ${unknown.join(", ")}`,
          "warning",
        );
    }
    if (agent.context === false) options.contextFiles = [];
    options.sections.agent_profile = `Active main agent: ${agent.name}\n\n${agent.systemPrompt}`;
  });
  pi.on("input", async (event, ctx) => {
    if (event.source !== "interactive") return { action: "continue" };
    const mention = parseMention(
      event.text,
      (await discoverDelegates(ctx.cwd)).agents,
    );
    if (!mention) return { action: "continue" };
    if (!mention.explicit && mention.agent) {
      try {
        await stat(path.resolve(ctx.cwd, mention.agent));
        return { action: "continue" };
      } catch {
        /* No file with this name: address the agent. */
      }
    }
    try {
      if ("error" in mention && mention.error) throw new Error(mention.error);
      if (!mention.agent)
        throw new Error(
          "Unknown delegation target. Use /delegate to select an agent.",
        );
      if (event.images?.length)
        throw new Error(
          "Attachments cannot be forwarded by this subagent runtime. Include file paths and a text task instead.",
        );
      if (!mention.task)
        throw new Error(
          `Add a task after @${mention.agent}, or use /delegate.`,
        );
      await dispatch(
        ctx,
        mention.agent,
        mention.task,
        "role" in mention ? mention.role : undefined,
      );
    } catch (error) {
      report(ctx, error);
      ctx.ui.setEditorText(event.text);
    }
    return { action: "handled" };
  });
  pi.registerShortcut("alt+a", {
    description: "Search and switch main agent",
    handler: async (ctx) => open(ctx),
  });
  const completions = async (prefix: string) =>
    (await discoverAgents(cwd)).agents
      .filter(
        (a) =>
          a.mode !== "subagent" &&
          a.name.toLowerCase().includes(prefix.toLowerCase()),
      )
      .map((a) => ({
        value: a.name,
        label: a.name,
        description: a.description,
      }));
  pi.registerCommand("agent", {
    description: "Search/switch main agent: /agent [name|reset]",
    getArgumentCompletions: completions,
    handler: async (args, ctx) => {
      cwd = ctx.cwd;
      if (!args.trim()) return open(ctx);
      try {
        await change(
          ["reset", "default", "off"].includes(args.trim())
            ? null
            : args.trim(),
          ctx,
        );
      } catch (error) {
        report(ctx, error);
      }
    },
  });
  pi.registerCommand("agents", {
    description: "List main-agent profiles and descriptions",
    handler: async (_args, ctx) => {
      const result = await discoverAgents(ctx.cwd);
      ctx.ui.notify(
        [
          `Main agent: ${state.agent?.name ?? "Pi default"}`,
          ...result.agents
            .filter((a) => a.mode !== "subagent")
            .map((a) => `${a.name} — ${a.description} (${a.source})`),
          ...result.diagnostics,
        ].join("\n"),
        "info",
      );
    },
  });
  pi.registerCommand("delegate", {
    description: "Delegate: /delegate <agent> [--role default|none|id] <task>",
    getArgumentCompletions: async (prefix) =>
      await delegationCompletions(prefix),
    handler: async (args, ctx) => {
      if (!args.trim()) return open(ctx, true);
      const match = args.trimStart().match(/^(\S+)(?:\s+([\s\S]*))?$/);
      try {
        if (!match)
          throw new Error(
            "Usage: /delegate <agent> [--role default|none|id] <task>",
          );
        const parsed = parseRolePrefix(match[2] ?? "");
        if (!parsed.task.trim()) throw new Error("Add a task for delegation.");
        if (
          !(await discoverDelegates(ctx.cwd)).agents.some(
            (a) => a.name === match[1],
          )
        )
          throw new Error(`Unknown subagent: ${match[1]}`);
        await dispatch(ctx, match[1]!, parsed.task, parsed.role);
      } catch (error) {
        report(ctx, error);
        ctx.ui.setEditorText(`/delegate ${args}`);
      }
    },
  });
  async function delegationCompletions(prefix: string) {
    const match = prefix.match(/^\S+\s+--role(?:=|\s+)([a-z0-9._-]*)$/);
    if (match) {
      const catalog = await discoverRoles({ cwd });
      return ["default", "none", ...catalog.roles.map((r) => r.id)]
        .filter((id) => id.startsWith(match[1]!))
        .map((id) => ({
          value: prefix.slice(0, prefix.length - match[1]!.length) + id,
          label: id,
          description:
            catalog.roles.find((r) => r.id === id)?.description ??
            "Role for this task",
        }));
    }
    return (await discoverDelegates(cwd)).agents
      .filter((a) => a.name.startsWith(prefix))
      .map((a) => ({
        value: a.name,
        label: a.name,
        description: a.description,
      }));
  }
  pi.registerCommand("role", {
    description:
      "Browse roles; /role <id|none|show> selects only in Pi default",
    getArgumentCompletions: async (prefix) =>
      ["none", "show", ...(await discoverRoles({ cwd })).roles.map((r) => r.id)]
        .filter((id) => id.startsWith(prefix))
        .map((id) => ({ value: id, label: id })),
    handler: async (args, ctx) => {
      try {
        const catalog = await catalogFor(ctx);
        if (args.trim() === "show")
          return previewRole(ctx, effectiveRole(catalog));
        if (state.agent) {
          if (args.trim()) {
            ctx.ui.notify(
              "Role from agent configuration. Use /agent reset to select a role for Pi default.",
              "info",
            );
            return;
          }
          const id = await pickRole(
            ctx,
            catalog,
            effectiveRole(catalog).effectiveId,
            state.agent.role,
            false,
            true,
          );
          if (id) await previewRole(ctx, resolveRole(catalog, undefined, id));
          return;
        }
        if (!ctx.isIdle())
          throw new Error(
            "Wait for the current turn to finish before selecting a role.",
          );
        const id =
          args.trim() ||
          (await pickRole(ctx, catalog, state.baseConversationRole));
        if (!id) return;
        const role = resolveRole(catalog, undefined, id, "base-conversation");
        state.baseConversationRole =
          role.requested.kind === "named" ? role.requested.id : undefined;
        state.persist(pi);
        await status(ctx);
        ctx.ui.notify(
          `Role: ${role.displayName ?? "None"}${role.status === "missing" || role.status === "invalid" || role.status === "unreadable" ? ` (${role.status}: ${role.requestedId})` : ""}`,
          "info",
        );
      } catch (error) {
        report(ctx, error);
      }
    },
  });
  pi.registerCommand("roles", {
    description: "List role metadata and diagnostics: /roles [refresh|query]",
    handler: async (args, ctx) => {
      const catalog = await catalogFor(ctx);
      const query = args.trim() === "refresh" ? "" : args.trim().toLowerCase();
      ctx.ui.notify(
        [
          ...catalog.roles
            .filter((r) =>
              `${r.id} ${r.name} ${r.description} ${r.category}`
                .toLowerCase()
                .includes(query),
            )
            .map(
              (r) =>
                `${r.id} — ${r.name} (${r.source}) · ${r.category} · ${r.description}`,
            ),
          ...catalog.diagnostics,
        ].join("\n") || "No roles installed.",
        "info",
      );
      await status(ctx);
    },
  });
}
