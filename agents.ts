import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  getAgentDir,
  parseFrontmatter,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

export interface AgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  tools?: string[];
  skills?: string[] | false;
  thinking?: ReturnType<ExtensionAPI["getThinkingLevel"]>;
  model?: string;
  provider?: string;
  context?: false;
  mode: "primary" | "subagent" | "both";
  source: "user" | "project";
  filePath: string;
  shared: boolean;
}
export interface AgentDiscoveryResult {
  agents: AgentConfig[];
  diagnostics: string[];
}
const levels = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
const identity = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

function list(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  const values = typeof value === "string" ? value.split(",") : value;
  if (!Array.isArray(values) || values.some((v) => typeof v !== "string"))
    throw new Error(`Invalid ${field}`);
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}
export function parseAgent(
  content: string,
  filePath: string,
  source: AgentConfig["source"],
  shared: boolean,
): AgentConfig {
  const { frontmatter: f, body } =
    parseFrontmatter<Record<string, unknown>>(content);
  if (
    typeof f.name !== "string" ||
    !identity.test(f.name) ||
    ["reset", "default", "off"].includes(f.name)
  )
    throw new Error("Invalid or reserved agent name");
  if (
    typeof f.description !== "string" ||
    !f.description.trim() ||
    !body.trim()
  )
    throw new Error("Agent needs a description and prompt");
  const thinking = f.thinking ?? f.thinkingLevel;
  if (
    thinking !== undefined &&
    (typeof thinking !== "string" || !levels.has(thinking))
  )
    throw new Error("Invalid thinking level");
  for (const field of ["model", "provider"] as const)
    if (
      f[field] !== undefined &&
      (typeof f[field] !== "string" || !f[field].trim())
    )
      throw new Error(`Invalid ${field}`);
  if (f.provider && !f.model) throw new Error("provider needs model");
  if (f.context !== undefined && typeof f.context !== "boolean")
    throw new Error("Invalid context");
  const mode = f.mode ?? (shared ? "both" : "primary");
  if (!["primary", "subagent", "both"].includes(String(mode)))
    throw new Error("Invalid mode");
  return {
    name: f.name,
    description: f.description.trim(),
    systemPrompt: body.trim(),
    tools: list(f.tools, "tools"),
    skills: f.skills === false ? false : list(f.skills, "skills"),
    thinking: thinking as AgentConfig["thinking"],
    model: f.model as string | undefined,
    provider: f.provider as string | undefined,
    ...(f.context === false ? { context: false as const } : {}),
    mode: mode as AgentConfig["mode"],
    source,
    filePath,
    shared,
  };
}
async function directory(dir: string) {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}
async function nearest(cwd: string, subdir: string) {
  let dir = path.resolve(cwd);
  while (true) {
    const candidate = path.join(dir, ".pi", subdir);
    if (await directory(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
async function load(
  dir: string | undefined,
  source: AgentConfig["source"],
  shared: boolean,
  diagnostics: string[],
) {
  if (!dir) return [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const result: AgentConfig[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(dir, entry.name);
    if (!shared && entry.isDirectory()) {
      result.push(...(await load(file, source, shared, diagnostics)));
      continue;
    }
    if (
      !entry.name.endsWith(".md") ||
      (!entry.isFile() && !entry.isSymbolicLink())
    )
      continue;
    try {
      result.push(
        parseAgent(await readFile(file, "utf8"), file, source, shared),
      );
    } catch (error) {
      diagnostics.push(
        `${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return result;
}
/** Explicit primary profiles override shared agents within the same scope; project wins globally. */
export async function discoverAgents(
  cwd: string,
): Promise<AgentDiscoveryResult> {
  const diagnostics: string[] = [];
  const [sharedProject, primaryProject] = await Promise.all([
    nearest(cwd, "agents"),
    nearest(cwd, "k-priagent"),
  ]);
  const groups = await Promise.all([
    load(path.join(getAgentDir(), "agents"), "user", true, diagnostics),
    load(path.join(getAgentDir(), "k-priagent"), "user", false, diagnostics),
    load(sharedProject, "project", true, diagnostics),
    load(primaryProject, "project", false, diagnostics),
  ]);
  const agents = new Map<string, AgentConfig>();
  for (const group of groups)
    for (const agent of group) agents.set(agent.name, agent);
  return {
    agents: [...agents.values()].sort((a, b) => a.name.localeCompare(b.name)),
    diagnostics,
  };
}
/** Delegation uses only definitions consumed by the installed subagent runtime. */
export async function discoverDelegates(
  cwd: string,
): Promise<AgentDiscoveryResult> {
  const diagnostics: string[] = [];
  const project = await nearest(cwd, "agents");
  const groups = await Promise.all([
    load(path.join(getAgentDir(), "agents"), "user", true, diagnostics),
    load(project, "project", true, diagnostics),
  ]);
  const agents = new Map<string, AgentConfig>();
  for (const group of groups)
    for (const agent of group) agents.set(agent.name, agent);
  return {
    agents: [...agents.values()]
      .filter((agent) => agent.mode !== "primary")
      .sort((a, b) => a.name.localeCompare(b.name)),
    diagnostics,
  };
}
