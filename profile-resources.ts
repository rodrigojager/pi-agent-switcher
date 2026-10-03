import { readFile } from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import {
  getAgentDir,
  loadSkills,
  createMcpExtension,
  type Skill,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { discoverAgents, parseAgent } from "./agents.js";

export interface ResourceProfile {
  name: string;
  scope?: string;
  tools?: string[];
}
interface Policy {
  skills: string[];
  family?: "higgsfield" | "blender";
  project?: boolean;
  mcp?: string;
  optionalTools?: string[];
}
export const POLICIES: Record<string, Policy> = {
  planner: {
    skills: ["pi-zgrep-search", "superbuild"],
    project: true,
    optionalTools: ["ask_user_question", "plannotator_submit_plan"],
  },
  orchestrator: {
    skills: ["pi-zgrep-search"],
    optionalTools: [
      "ask_user_question",
      "todo",
      "goal_complete",
      "goal_blocked",
      "goal_wait",
    ],
  },
  executor: { skills: ["pi-zgrep-search"], project: true },
  reviewer: { skills: ["pi-zgrep-search"], project: true },
  "workspace-scout": { skills: ["pi-zgrep-search"] },
  "browser-operator": {
    skills: ["agent-browser"],
    optionalTools: [
      "web_search",
      "fetch_content",
      "get_search_content",
      "source_check",
    ],
  },
  "desktop-operator": { skills: [], mcp: "mcp__windows_mcp__" },
  "higgsfield-specialist": {
    skills: ["higgsfield"],
    family: "higgsfield",
    mcp: "mcp__higgsfield__",
  },
  "blender-specialist": {
    skills: ["blender-director", "blender-image-to-3d"],
    family: "blender",
    mcp: "mcp__blender__",
  },
};
const normalized = (value: string) =>
  path.resolve(value).replace(/\\/g, "/").toLowerCase();
const beneath = (file: string, root: string) =>
  normalized(file).startsWith(normalized(root) + "/");
export function skillAllowed(
  skill: Pick<Skill, "name" | "filePath">,
  scope: string,
  cwd: string,
  agentDir = getAgentDir(),
): boolean {
  const policy = POLICIES[scope];
  if (
    !policy ||
    /(?:^|[\\/])(under-review|_migration)(?:[\\/]|$)/i.test(skill.filePath)
  )
    return false;
  if (policy.skills.includes(skill.name)) return true;
  const shared = path.join(
    path.dirname(path.dirname(agentDir)),
    ".agents",
    "skills",
  );
  if (
    policy.family === "higgsfield" &&
    beneath(skill.filePath, path.join(shared, "higgsfield"))
  )
    return true;
  if (
    policy.family === "blender" &&
    (beneath(skill.filePath, path.join(shared, "blender-arjun")) ||
      beneath(skill.filePath, path.join(shared, "blender-image-to-3d")))
  )
    return true;
  return (
    !!policy.project &&
    [".pi/skills", ".agents/skills", "SKILLS", "skills"].some((dir) =>
      beneath(skill.filePath, path.join(cwd, dir)),
    ) &&
    !beneath(skill.filePath, shared) &&
    !beneath(skill.filePath, agentDir)
  );
}
export function mcpAllowed(name: string, scope: string): boolean {
  const prefix = POLICIES[scope]?.mcp;
  return !!prefix && name.startsWith(prefix);
}
export function automaticDelegateAllowed(name: string): boolean {
  return name !== "workspace-scout";
}

export function registerProfileResources(
  pi: ExtensionAPI,
  current: () => ResourceProfile | undefined,
  child = false,
): void {
  if (typeof pi.registerTool !== "function") return;
  let lastSkills: Skill[] = [];
  const waitedForMcp = new Set<string>();
  async function catalog(cwd: string, allowProject = false): Promise<Skill[]> {
    const agentDir = getAgentDir();
    const shared = path.join(
      path.dirname(path.dirname(agentDir)),
      ".agents",
      "skills",
    );
    let configured: string[] = [];
    try {
      configured =
        JSON.parse(
          await readFile(path.join(agentDir, "settings.json"), "utf8"),
        ).skills?.filter(
          (p: unknown) => typeof p === "string" && !p.startsWith("!"),
        ) ?? [];
    } catch {
      /* Defaults remain usable. */
    }
    lastSkills = loadSkills({
      cwd,
      agentDir,
      includeDefaults: true,
      skillPaths: [
        ...configured,
        path.join(shared, "higgsfield", "skills"),
        ...(allowProject
          ? [path.join(cwd, "SKILLS"), path.join(cwd, "skills")]
          : []),
      ],
    }).skills;
    const scope = current()?.scope;
    return scope
      ? lastSkills.filter((s) =>
          skillAllowed(
            s,
            scope,
            allowProject ? cwd : path.join(agentDir, "no-project-skills"),
          ),
        )
      : [];
  }
  const json = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    details: {},
  });
  pi.registerTool({
    name: "skill_catalog",
    label: "Skill catalog",
    defaultActive: false,
    description:
      "Find skills permitted for this profile. Returns bounded metadata only; use skill_load for relevant instructions.",
    parameters: Type.Object({
      query: Type.Optional(Type.String()),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
    }),
    async execute(_id, args, _signal, _update, ctx) {
      const query = (args.query ?? "").toLowerCase();
      const matches = (await catalog(ctx.cwd, ctx.isProjectTrusted())).filter(
        (s) => `${s.name} ${s.description}`.toLowerCase().includes(query),
      );
      const offset = args.offset ?? 0,
        limit = args.limit ?? 5;
      return json({
        skills: matches
          .slice(offset, offset + limit)
          .map((s) => ({ name: s.name, description: s.description })),
        total: matches.length,
        ...(offset + limit < matches.length
          ? { nextOffset: offset + limit }
          : {}),
      });
    },
  });
  pi.registerTool({
    name: "skill_load",
    label: "Load skill",
    defaultActive: false,
    description:
      "Read one permitted skill on demand. Relative references resolve against the returned baseDir. Does not add other skills to discovery.",
    parameters: Type.Object({ name: Type.String() }),
    async execute(_id, args, _signal, _update, ctx) {
      const skill = (await catalog(ctx.cwd, ctx.isProjectTrusted())).find(
        (s) => s.name === args.name,
      );
      if (!skill)
        throw new Error(`Skill is unavailable in this profile: ${args.name}`);
      return {
        content: [
          {
            type: "text" as const,
            text: `Skill: ${skill.name}\nBase directory: ${skill.baseDir}\n\n${await readFile(skill.filePath, "utf8")}`,
          },
        ],
        details: {
          profileSkill: { name: skill.name, filePath: skill.filePath },
        },
      };
    },
  });
  pi.registerTool({
    name: "agent_catalog",
    label: "Agent catalog",
    defaultActive: false,
    description:
      "Find an appropriate delegate by capability. Returns names and descriptions, without prompts, roles or skills. User-only agents are excluded.",
    parameters: Type.Object({
      query: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
    }),
    async execute(_id, args, _signal, _update, ctx) {
      const query = (args.query ?? "").toLowerCase();
      const agents = (await discoverAgents(ctx.cwd)).agents.filter(
        (a) =>
          a.mode !== "primary" &&
          automaticDelegateAllowed(a.name) &&
          `${a.name} ${a.description}`.toLowerCase().includes(query),
      );
      return json({
        agents: agents
          .slice(0, args.limit ?? 5)
          .map((a) => ({ name: a.name, description: a.description })),
        total: agents.length,
      });
    },
  });
  pi.registerTool({
    name: "profile_mcp",
    label: "Profile MCP",
    defaultActive: false,
    description:
      "Discover or call MCP tools allowed for this profile. List with a focused query or exact name to obtain the actual schema, then call that name. Screenshots and other result blocks are preserved.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("list"), Type.Literal("call")]),
      query: Type.Optional(Type.String()),
      name: Type.Optional(Type.String()),
      args: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
    }),
    async execute(_id, args, signal, _update, ctx) {
      const scope = current()?.scope ?? "";
      if (!POLICIES[scope]?.mcp)
        throw new Error("This profile has no MCP service.");
      if (args.action === "call") {
        if (!args.name || !mcpAllowed(args.name, scope))
          throw new Error("MCP tool is outside this profile's scope.");
        const outcome = await ctx.executeTool(args.name, args.args ?? {}, {
          signal,
        });
        if (outcome.isError)
          throw new Error(
            outcome.result.content
              .filter((c) => c.type === "text")
              .map((c) => c.text)
              .join("\n"),
          );
        return outcome.result;
      }
      const query = (args.query ?? "").toLowerCase();
      const candidates = () =>
        typeof pi.getAllTools === "function"
          ? pi.getAllTools().filter((t) => t.exposure !== "hidden")
          : ctx.tools;
      // Deferred/codemode servers connect in the background. A first focused
      // lookup waits briefly for registration without exposing global discovery.
      if (
        !waitedForMcp.has(scope) &&
        !candidates().some((t) => mcpAllowed(t.name, scope))
      ) {
        waitedForMcp.add(scope);
        const deadline = Date.now() + 3000;
        while (
          !signal?.aborted &&
          Date.now() < deadline &&
          !candidates().some((t) => mcpAllowed(t.name, scope))
        )
          await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const matches = candidates().filter(
        (t) =>
          mcpAllowed(t.name, scope) &&
          (!args.name || t.name === args.name) &&
          `${t.name} ${t.description}`.toLowerCase().includes(query),
      );
      const offset = args.offset ?? 0,
        limit = args.limit ?? 3;
      return json({
        tools: matches.slice(offset, offset + limit).map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
        total: matches.length,
        ...(offset + limit < matches.length
          ? { nextOffset: offset + limit }
          : {}),
        ...(matches.length === 0
          ? {
              hint: "No matching tools are connected. Check /mcp for connection or authentication status.",
            }
          : {}),
      });
    },
  });
  pi.on("before_agent_start", (event) => {
    const profile = current(),
      scope = profile?.scope;
    if (!scope || !POLICIES[scope]) return;
    const optional = POLICIES[scope].optionalTools ?? [];
    const configured = new Set(pi.getAllTools().map((t) => t.name));
    const tools = [
      ...new Set([
        ...(profile.tools ?? pi.getActiveTools()),
        ...optional.filter((t) => configured.has(t)),
        ...(child ? ["complete"] : []),
      ]),
    ];
    pi.setActiveTools(tools);
    event.systemPromptOptions.selectedTools = tools;
  });
  pi.on("tool_call", (event) => {
    const scope = current()?.scope;
    if (!scope || !POLICIES[scope]) return;
    if (
      event.toolName.startsWith("mcp__") &&
      !mcpAllowed(event.toolName, scope)
    )
      return {
        block: true,
        reason: "MCP service is outside the active profile's scope.",
      };
    if (
      event.toolName === "subagent" &&
      !automaticDelegateAllowed(String(event.input.agent))
    )
      return {
        block: true,
        reason:
          "workspace-scout is user-only. Use a direct search or let the user invoke @workspace-scout.",
      };
  });
  pi.on("context_with_system", async (event, ctx) => {
    const scope = current()?.scope;
    if (!scope || !POLICIES[scope]) return;
    if (!lastSkills.length) await catalog(ctx.cwd);
    // Replay patches first, then erase obsolete resource descriptions from earlier
    // system messages. The saved transcript is untouched; only this request changes.
    const owned = [
      "skills",
      "agent_profile",
      "professional_role",
      "tools",
      "rules",
      "project_context",
    ];
    const effective: Record<string, string | null> = {};
    const declarations = new Map();
    let lastSystem = -1;
    event.messages.forEach((message, index) => {
      if (message.role !== "system") return;
      lastSystem = index;
      for (const tool of message.toolsAdded ?? [])
        declarations.set(tool.name, tool);
      for (const tool of message.toolsRemoved ?? [])
        declarations.delete(tool.name);
      for (const key of owned)
        if (message.sections && key in message.sections)
          effective[key] = message.sections[key];
    });
    const skillReads = new Map<string, string>();
    for (const message of event.messages) {
      if (message.role !== "assistant") continue;
      for (const content of message.content) {
        if (content.type !== "toolCall") continue;
        if (
          content.name === "read" &&
          typeof content.arguments.path === "string" &&
          /SKILL\.md$/i.test(content.arguments.path)
        )
          skillReads.set(
            content.id,
            path.resolve(ctx.cwd, content.arguments.path),
          );
      }
    }
    return {
      messages: event.messages.map((message, index) => {
        if (message.role === "system") {
          const sections = { ...message.sections };
          for (const key of owned) {
            if (key in sections) sections[key] = null;
            if (index === lastSystem && key in effective)
              sections[key] = effective[key];
          }
          if ("mcp_servers" in sections) sections.mcp_servers = null;
          const removeMcp = (text: string) =>
            text.replace(/<mcp_servers>[\s\S]*?<\/mcp_servers>/g, "");
          return {
            ...message,
            sections,
            toolsAdded:
              index === lastSystem ? [...declarations.values()] : undefined,
            toolsRemoved: undefined,
            content:
              typeof message.content === "string"
                ? removeMcp(message.content)
                : message.content.map((c) => ({
                    ...c,
                    text: removeMcp(c.text),
                  })),
          };
        }
        if (message.role !== "toolResult") return message;
        const detail = (
          message.details as
            { profileSkill?: { name: string; filePath: string } } | undefined
        )?.profileSkill;
        const source =
          detail ??
          lastSkills.find(
            (s) =>
              normalized(s.filePath) ===
              normalized(skillReads.get(message.toolCallId) ?? "."),
          );
        if (!source || skillAllowed(source, scope, ctx.cwd)) return message;
        return {
          ...message,
          content: [
            {
              type: "text" as const,
              text: "Skill instructions from another profile were omitted from this request.",
            },
          ],
        };
      }),
    };
  });
}

/** Explicit child extension entrypoints restore only the resources of their profile. */
export function createChildProfile(name: string) {
  return async (pi: ExtensionAPI) => {
    if (Number(process.env.PI_SUBAGENT_DEPTH ?? "0") <= 0) return;
    const file = path.join(getAgentDir(), "agents", `${name}.md`);
    const agent = parseAgent(await readFile(file, "utf8"), file, "user", true);
    registerProfileResources(
      pi,
      () => ({
        name: agent.name,
        scope: agent.resourceProfile,
        tools: agent.tools,
      }),
      true,
    );
    if (agent.resourceProfile && POLICIES[agent.resourceProfile]?.mcp)
      await createMcpExtension()(pi);
  };
}
