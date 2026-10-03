import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "agent-switcher-"));
process.env.PI_CODING_AGENT_DIR = path.join(temp, "user");
const jiti = createJiti(import.meta.url, { fsCache: false });
const register = await jiti.import("../index.ts", { default: true });
const { discoverAgents, discoverDelegates, parseAgent } =
  await jiti.import("../agents.ts");
const { agentAutocomplete, DELEGATION_CHANNEL } =
  await jiti.import("../delegation.ts");
const models = [
  { id: "base", provider: "fake" },
  { id: "cheap", provider: "fake" },
];
async function writeRole(folder, id, body) {
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, id + ".md"), body);
}
async function writeAgent(
  folder,
  name,
  fields = "",
  body = "Act as a focused specialist.",
) {
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, name + ".md"),
    `---\nname: ${name}\ndescription: ${name} description\n${fields}\n---\n${body}\n`,
  );
}
async function fixture() {
  const cwd = await fs.mkdtemp(path.join(temp, "project-"));
  await writeAgent(
    path.join(cwd, ".pi/agents"),
    "scout",
    "model: cheap\nprovider: fake\nthinking: low\ntools: read\nskills: false",
  );
  await writeAgent(
    path.join(cwd, ".pi/k-priagent"),
    "planner",
    "skills: video\ntools: read, subagent",
  );
  return cwd;
}
function host(cwd) {
  const commands = new Map(),
    handlers = new Map(),
    shortcuts = new Map(),
    notifications = [],
    bus = new Map();
  let tools = ["read", "write", "subagent"],
    model = models[0],
    thinking = "high",
    branch = [],
    editor = "",
    status,
    authorized = true,
    idle = true,
    trusted = true,
    wrapper;
  const pi = {
    on(name, fn) {
      handlers.set(name, [...(handlers.get(name) ?? []), fn]);
    },
    registerCommand(name, spec) {
      commands.set(name, spec);
    },
    registerShortcut(key, spec) {
      shortcuts.set(key, spec);
    },
    getActiveTools: () => [...tools],
    getAllTools: () =>
      ["read", "write", "subagent"].map((name) => ({
        name,
        exposure: "direct",
      })),
    setActiveTools(value) {
      tools = [...value];
    },
    getThinkingLevel: () => thinking,
    setThinkingLevel(value) {
      thinking = value;
    },
    async setModel(value) {
      if (!authorized) return false;
      model = value;
      return true;
    },
    appendEntry(customType, data) {
      branch.push({ type: "custom", customType, data });
    },
    events: {
      emit(channel, data) {
        for (const callback of bus.get(channel) ?? []) callback(data);
      },
      on(channel, callback) {
        bus.set(channel, [...(bus.get(channel) ?? []), callback]);
      },
    },
  };
  const ctx = {
    cwd,
    mode: "tui",
    hasUI: true,
    get model() {
      return model;
    },
    isIdle: () => idle,
    isProjectTrusted: () => trusted,
    modelRegistry: {
      find: (provider, id) =>
        models.find((m) => m.provider === provider && m.id === id),
      getAvailable: () => models,
    },
    sessionManager: { getBranch: () => branch },
    ui: {
      notify(message, type) {
        notifications.push({ message, type });
      },
      setStatus(_key, value) {
        status = value;
      },
      setEditorText(value) {
        editor = value;
      },
      addAutocompleteProvider(value) {
        wrapper = value;
      },
    },
  };
  register(pi);
  return {
    pi,
    ctx,
    commands,
    handlers,
    shortcuts,
    notifications,
    get state() {
      return { tools, model, thinking, editor, status, branch, wrapper };
    },
    setAuthorized(value) {
      authorized = value;
    },
    setIdle(value) {
      idle = value;
    },
    setTrusted(value) {
      trusted = value;
    },
    setBranch(value) {
      branch = value;
    },
    async command(name, args = "") {
      await commands.get(name).handler(args, ctx);
    },
    async emit(name, event = {}) {
      let result;
      for (const handler of handlers.get(name) ?? [])
        result = await handler({ type: name, ...event }, ctx);
      return result;
    },
  };
}

test("roles command shows names and descriptions without IDs or User labels, retaining ID search", async () => {
  const folder = path.join(temp, "user/roles");
  const id = "hidden-listing-id";
  await writeRole(
    folder,
    id,
    "---\nname: Readable Specialist\ndescription: Investigate failures with objective evidence.\ncategory: engineering\n---\nInvestigate.\n",
  );
  try {
    const h = host(await fixture());
    await h.command("roles", id);
    const text = h.notifications.at(-1).message;
    assert.equal(
      text,
      "Readable Specialist\n  Investigate failures with objective evidence.",
    );
    assert.doesNotMatch(text, /hidden-listing-id|\(user\)|engineering/);
  } finally {
    await fs.unlink(path.join(folder, id + ".md"));
  }
});

test("base roles are branch-aware, named agents own their defaults, and missing roles clear only the owned section", async () => {
  const cwd = await fixture();
  await writeRole(
    path.join(cwd, ".pi/roles"),
    "backend-architect",
    "ARCHITECT_ROLE",
  );
  await writeRole(
    path.join(cwd, ".pi/roles"),
    "code-reviewer",
    "REVIEWER_ROLE",
  );
  await writeAgent(
    path.join(cwd, ".pi/agents"),
    "architect",
    "role: backend-architect",
    "ARCHITECT_AGENT",
  );
  await writeAgent(
    path.join(cwd, ".pi/agents"),
    "missing",
    "role: absent",
    "MISSING_AGENT",
  );
  const h = host(cwd);
  await h.emit("session_start");
  const options = () => ({
    skills: [],
    contextFiles: [],
    sections: { unrelated: "KEEP" },
  });
  await h.command("role", "code-reviewer");
  const branch = [...h.state.branch];
  let prompt = options();
  await h.emit("before_agent_start", { systemPromptOptions: prompt });
  assert.match(prompt.sections.professional_role, /REVIEWER_ROLE/);
  await h.command("agent", "architect");
  await h.emit("before_agent_start", { systemPromptOptions: prompt });
  assert.match(prompt.sections.professional_role, /ARCHITECT_ROLE/);
  assert.doesNotMatch(prompt.sections.professional_role, /REVIEWER_ROLE/);
  await h.command("role", "none");
  await h.emit("before_agent_start", { systemPromptOptions: prompt });
  assert.match(prompt.sections.professional_role, /ARCHITECT_ROLE/);
  await h.command("agent", "missing");
  await h.emit("before_agent_start", { systemPromptOptions: prompt });
  assert.equal(prompt.sections.professional_role, undefined);
  assert.equal(prompt.sections.unrelated, "KEEP");
  await h.command("agent", "reset");
  await h.emit("before_agent_start", { systemPromptOptions: prompt });
  assert.match(prompt.sections.professional_role, /REVIEWER_ROLE/);
  assert.equal(prompt.sections.agent_profile, undefined);
  await h.command("role", "none");
  h.setBranch(branch);
  await h.emit("session_tree");
  prompt = options();
  await h.emit("before_agent_start", { systemPromptOptions: prompt });
  assert.match(prompt.sections.professional_role, /REVIEWER_ROLE/);
  h.setBranch([]);
  await h.emit("session_tree");
  await h.emit("before_agent_start", { systemPromptOptions: prompt });
  assert.equal(prompt.sections.professional_role, undefined);
});

test("mentions and commands forward one role; parsing failures and old bridges preserve tasks without launch", async () => {
  const cwd = await fixture();
  const h = host(cwd);
  const requests = [];
  h.pi.events.on(DELEGATION_CHANNEL, (request) => {
    requests.push(request);
    request.accept(async () => ({ ok: true, message: "Started" }));
  });
  await h.emit("input", {
    source: "interactive",
    text: "@scout --role=none Task\n  exact indentation",
  });
  assert.equal(requests[0].role, "none");
  assert.equal(requests[0].task, "Task\n  exact indentation");
  await h.command("delegate", "scout --role code-reviewer Review");
  assert.equal(requests[1].role, "code-reviewer");
  await h.emit("input", {
    source: "interactive",
    text: "@agent:scout Fresh task",
  });
  assert.equal(requests[2].role, undefined);
  const malformed = "@scout --role none --role default Task";
  await h.emit("input", { source: "interactive", text: malformed });
  assert.equal(requests.length, 3);
  assert.equal(h.state.editor, malformed);
  const old = host(cwd);
  let launches = 0;
  old.pi.events.on("rodrigojager:pi-subagent:delegate:v1", () => {
    launches++;
  });
  await old.emit("input", {
    source: "interactive",
    text: "@scout --role none Task",
  });
  assert.equal(launches, 0);
  assert.equal(old.state.editor, "@scout --role none Task");
  assert.match(old.notifications.at(-1).message, /v2 bridge/);
});
test.after(async () => {
  await fs.rm(temp, { recursive: true, force: true });
});

test("manual model and thinking selections survive profile changes, restore and reset", async () => {
  const cwd = await fixture();
  const app = host(cwd);
  await app.command("agent", "scout");
  const initialBranch = [...app.state.branch];
  await app.pi.setModel(models[0]);
  await app.emit("model_select", { model: models[0], source: "set" });
  app.pi.setThinkingLevel("medium");
  await app.emit("thinking_level_select", { level: "medium" });
  assert.deepEqual(initialBranch.at(-1).data.overrides, {});
  await app.command("agent", "planner");
  await app.command("agent", "scout");
  assert.equal(app.state.model.id, "base");
  assert.equal(app.state.thinking, "medium");
  const resumed = host(cwd);
  resumed.setBranch(app.state.branch);
  await resumed.emit("session_start");
  assert.equal(resumed.state.model.id, "base");
  assert.equal(resumed.state.thinking, "medium");
  await resumed.emit("model_select", { model: models[1], source: "restore" });
  await resumed.command("agent", "scout");
  assert.equal(resumed.state.model.id, "base");
  await resumed.command("agent", "reset");
  assert.equal(resumed.state.thinking, "high");
  assert.deepEqual(resumed.state.tools, ["read", "write", "subagent"]);
  await resumed.command("agent", "scout");
  assert.equal(resumed.state.thinking, "medium");
  const fresh = host(cwd);
  await fresh.emit("session_start");
  await fresh.command("agent", "scout");
  assert.equal(fresh.state.model.id, "cheap");
  assert.equal(fresh.state.thinking, "low");
  const beforeOverride = host(cwd);
  beforeOverride.setBranch(initialBranch);
  await beforeOverride.emit("session_tree");
  assert.equal(beforeOverride.state.model.id, "cheap");
  assert.equal(beforeOverride.state.thinking, "low");
});
test("discovers existing subagent files and explicit primary profiles, with project precedence", async () => {
  const cwd = await fixture();
  await writeAgent(
    path.join(process.env.PI_CODING_AGENT_DIR, "agents"),
    "scout",
    "",
    "Global prompt",
  );
  let found = await discoverAgents(cwd);
  assert.equal(found.agents.find((a) => a.name === "scout").source, "project");
  assert.equal(found.agents.find((a) => a.name === "scout").skills, false);
  assert.equal(
    (await discoverDelegates(cwd)).agents.some((a) => a.name === "planner"),
    false,
  );
  await writeAgent(path.join(cwd, ".pi/agents"), "scout", "mode: primary");
  assert.equal(
    (await discoverDelegates(cwd)).agents.some((a) => a.name === "scout"),
    false,
  );
  await writeAgent(
    path.join(cwd, ".pi/k-priagent"),
    "scout",
    "",
    "Explicit primary prompt",
  );
  found = await discoverAgents(cwd);
  assert.equal(
    found.agents.find((a) => a.name === "scout").systemPrompt,
    "Explicit primary prompt",
  );
});
test("validates frontmatter and preserves explicit empty tool and skill lists", () => {
  const profile = parseAgent(
    "---\nname: safe\ndescription: safe profile\ntools: []\nskills: []\n---\nPrompt",
    "safe.md",
    "user",
    false,
  );
  assert.deepEqual(profile.tools, []);
  assert.deepEqual(profile.skills, []);
  assert.throws(() =>
    parseAgent(
      "---\nname: reset\ndescription: bad\n---\nPrompt",
      "",
      "user",
      false,
    ),
  );
  assert.throws(() =>
    parseAgent(
      "---\nname: safe\ndescription: bad\nthinking: nonsense\n---\nPrompt",
      "",
      "user",
      false,
    ),
  );
});
test("switches model/tools/thinking immediately; omitted settings and reset use original baseline", async () => {
  const h = host(await fixture());
  await h.command("agent", "scout");
  assert.deepEqual(h.state.tools, ["read"]);
  assert.equal(h.state.model.id, "cheap");
  assert.equal(h.state.thinking, "low");
  await h.command("agent", "planner");
  assert.equal(h.state.model.id, "base");
  assert.equal(h.state.thinking, "high");
  assert.deepEqual(h.state.tools, ["read", "subagent"]);
  await h.command("agent", "reset");
  assert.deepEqual(h.state.tools, ["read", "write", "subagent"]);
  assert.equal(h.state.status, "Agent: Pi default | Role: None");
  assert.equal(h.state.branch.at(-1).data.currentAgent, null);
  assert.ok(h.shortcuts.has("alt+a"));
  assert.ok(!h.shortcuts.has("ctrl+a"));
});
test("unavailable model/auth/tool, busy turn and untrusted project do not change current profile", async () => {
  const cwd = await fixture();
  const h = host(cwd);
  h.setAuthorized(false);
  await h.command("agent", "scout");
  assert.deepEqual(h.state.tools, ["read", "write", "subagent"]);
  assert.equal(h.state.branch.length, 0);
  h.setAuthorized(true);
  h.setIdle(false);
  await h.command("agent", "scout");
  assert.equal(h.state.branch.length, 0);
  h.setIdle(true);
  h.setTrusted(false);
  await h.command("agent", "scout");
  assert.equal(h.state.branch.length, 0);
  h.setTrusted(true);
  await writeAgent(
    path.join(cwd, ".pi/k-priagent"),
    "missing",
    "tools: nonexistent",
  );
  await h.command("agent", "missing");
  assert.equal(h.state.branch.length, 0);
});
function promptOptions() {
  return {
    skills: [
      { name: "video", filePath: "video/SKILL.md" },
      { name: "3d", filePath: "3d/SKILL.md" },
    ],
    sections: { guardian: "Preserve another extension" },
    contextFiles: [{ path: "AGENTS.md", content: "Project instructions" }],
  };
}
test("structured prompt preserves other sections and filters skills by profile without changing defaults", async () => {
  const h = host(await fixture());
  await h.command("agent", "scout");
  let options = promptOptions();
  await h.emit("before_agent_start", { systemPromptOptions: options });
  assert.deepEqual(options.skills, []);
  assert.ok(options.sections.agent_profile.includes("scout"));
  assert.equal(options.sections.guardian, "Preserve another extension");
  assert.equal(options.contextFiles.length, 1);
  await h.command("agent", "planner");
  options = promptOptions();
  await h.emit("before_agent_start", { systemPromptOptions: options });
  assert.deepEqual(
    options.skills.map((s) => s.name),
    ["video"],
  );
  await h.command("agent", "reset");
  options = promptOptions();
  await h.emit("before_agent_start", { systemPromptOptions: options });
  assert.equal(options.skills.length, 2);
  assert.equal(options.sections.agent_profile, undefined);
});
test("missing named skill is omitted rather than leaking the full catalog", async () => {
  const cwd = await fixture();
  await writeAgent(
    path.join(cwd, ".pi/k-priagent"),
    "limited",
    "skills: missing",
  );
  const h = host(cwd);
  await h.command("agent", "limited");
  const options = promptOptions();
  await h.emit("before_agent_start", { systemPromptOptions: options });
  assert.deepEqual(options.skills, []);
  assert.match(h.notifications.at(-1).message, /were omitted/);
});
test("resume restores active profile and original baseline; moving before activation restores defaults", async () => {
  const cwd = await fixture(),
    first = host(cwd);
  await first.command("agent", "scout");
  const second = host(cwd);
  second.setBranch(first.state.branch);
  await second.emit("session_start");
  assert.equal(second.state.model.id, "cheap");
  assert.deepEqual(second.state.tools, ["read"]);
  second.setBranch([]);
  await second.emit("session_tree");
  assert.equal(second.state.model.id, "base");
  assert.deepEqual(second.state.tools, ["read", "write", "subagent"]);
});
test("mentions delegate once without switching profile; normal file references continue", async () => {
  const cwd = await fixture(),
    h = host(cwd);
  let requests = [];
  h.pi.events.on(DELEGATION_CHANNEL, (request) =>
    request.accept(async () => {
      requests.push({ agent: request.agent, task: request.task });
      return { ok: true, message: "started #1" };
    }),
  );
  assert.deepEqual(
    await h.emit("input", {
      text: "@scout find files\nand report paths",
      source: "interactive",
    }),
    { action: "handled" },
  );
  assert.deepEqual(requests, [
    { agent: "scout", task: "find files\nand report paths" },
  ]);
  assert.equal(h.state.status, undefined);
  assert.deepEqual(
    await h.emit("input", {
      text: "@README.md explain this",
      source: "interactive",
    }),
    { action: "continue" },
  );
  assert.deepEqual(
    await h.emit("input", {
      text: "Explain @scout behavior",
      source: "interactive",
    }),
    { action: "continue" },
  );
  await fs.writeFile(path.join(cwd, "scout"), "A file with the same name");
  assert.deepEqual(
    await h.emit("input", {
      text: "@scout read this file",
      source: "interactive",
    }),
    { action: "continue" },
  );
  await h.emit("input", {
    text: "@agent:scout find more files",
    source: "interactive",
  });
  assert.equal(requests.length, 2);
});
test("missing bridge, attachments and unknown explicit target preserve the task for retry", async () => {
  const h = host(await fixture());
  await h.emit("input", { text: "@scout inspect", source: "interactive" });
  assert.match(h.notifications.at(-1).message, /delegation needs/);
  assert.equal(h.state.editor, "@scout inspect");
  await h.emit("input", {
    text: "@scout inspect",
    source: "interactive",
    images: [{}],
  });
  assert.match(h.notifications.at(-1).message, /Attachments/);
  await h.emit("input", {
    text: "@agent:unknown inspect",
    source: "interactive",
  });
  assert.match(h.notifications.at(-1).message, /Unknown delegation/);
  assert.deepEqual(
    await h.emit("input", { text: "@scout inspect", source: "extension" }),
    { action: "continue" },
  );
});
test("autocomplete merges agents and files and delegates native completion unchanged", async () => {
  const file = { value: "@source.ts", label: "source.ts", description: "file" };
  let nativeApplied = false;
  const base = {
    triggerCharacters: ["@"],
    getSuggestions: async () => ({ prefix: "@s", items: [file] }),
    applyCompletion() {
      nativeApplied = true;
      return { lines: ["native"], cursorLine: 0, cursorCol: 6 };
    },
  };
  const provider = agentAutocomplete(base, async () => [
    { name: "scout", description: "Find evidence" },
  ]);
  const found = await provider.getSuggestions(["@s"], 0, 2, {
    signal: new AbortController().signal,
  });
  assert.deepEqual(
    found.items.map((i) => i.value),
    ["@agent:scout", "@source.ts"],
  );
  assert.equal(
    provider.applyCompletion(["@s"], 0, 2, found.items[0], found.prefix)
      .lines[0],
    "@agent:scout ",
  );
  provider.applyCompletion(["@s"], 0, 2, file, found.prefix);
  assert.equal(nativeApplied, true);
});
