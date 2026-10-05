import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { fsCache: false });
const {
  skillAllowed,
  mcpAllowed,
  automaticDelegateAllowed,
  registerProfileResources,
  resolveProfileTools,
} = await jiti.import("../profile-resources.ts");
test("profile tools include only installed visible optional tools and remain deduplicated", () => {
  const pi = {
    getAllTools: () => [
      { name: "goal_complete", exposure: "direct" },
      { name: "goal_blocked", exposure: "direct" },
      { name: "goal_wait", exposure: "hidden" },
      { name: "subagent_wait", exposure: "direct" },
      { name: "subagent_status", exposure: "direct" },
    ],
  };
  assert.deepEqual(
    resolveProfileTools(
      pi,
      {
        name: "orchestrator",
        scope: "orchestrator",
        tools: ["read", "goal_complete"],
      },
      [],
    ),
    ["read", "goal_complete", "goal_blocked", "subagent_wait", "subagent_status"],
  );
  assert.deepEqual(
    resolveProfileTools(
      pi,
      {
        name: "executor",
        scope: "executor",
        tools: ["read"],
      },
      [],
      true,
    ),
    ["read", "complete"],
  );
});
test("resource boundaries exclude other families, review staging and automatic scout", () => {
  const home = path.resolve("fixture/home"),
    agent = path.join(home, ".pi/agent"),
    cwd = path.join(home, "project");
  const skill = (name, filePath) => ({ name, filePath });
  assert.equal(
    skillAllowed(
      skill(
        "higgsfield-camera",
        path.join(
          home,
          ".agents/skills/higgsfield/skills/higgsfield-camera/SKILL.md",
        ),
      ),
      "higgsfield-specialist",
      cwd,
      agent,
    ),
    true,
  );
  assert.equal(
    skillAllowed(
      skill(
        "higgsfield-camera",
        path.join(
          home,
          ".agents/skills/higgsfield/skills/higgsfield-camera/SKILL.md",
        ),
      ),
      "orchestrator",
      cwd,
      agent,
    ),
    false,
  );
  assert.equal(
    skillAllowed(
      skill(
        "rendering",
        path.join(home, ".agents/skills/blender-arjun/rendering/SKILL.md"),
      ),
      "blender-specialist",
      cwd,
      agent,
    ),
    true,
  );
  assert.equal(
    skillAllowed(
      skill("local", path.join(cwd, "SKILLS/local/SKILL.md")),
      "executor",
      cwd,
      agent,
    ),
    true,
  );
  assert.equal(
    skillAllowed(
      skill("local", path.join(cwd, "SKILLS/under-review/local/SKILL.md")),
      "executor",
      cwd,
      agent,
    ),
    false,
  );
  assert.equal(
    skillAllowed(
      skill("global", path.join(home, ".codex/skills/global/SKILL.md")),
      "executor",
      home,
      agent,
    ),
    false,
  );
  assert.equal(
    mcpAllowed("mcp__windows_mcp__Snapshot", "desktop-operator"),
    true,
  );
  assert.equal(
    mcpAllowed("mcp__higgsfield__generate", "desktop-operator"),
    false,
  );
  assert.equal(automaticDelegateAllowed("workspace-scout"), false);
  assert.equal(automaticDelegateAllowed("executor"), true);
});
test("on-demand catalog reaches the shared agents library without advertising other families", async () => {
  const temp = await fs.mkdtemp(
      path.join(os.tmpdir(), "profile-shared-library-"),
    ),
    agentDir = path.join(temp, "home/.pi/agent"),
    shared = path.join(temp, "home/.agents/skills"),
    old = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    for (const [relative, name] of [
      ["superbuild", "superbuild"],
      ["blender-arjun/animation", "animation"],
    ]) {
      const folder = path.join(shared, relative);
      await fs.mkdir(folder, { recursive: true });
      await fs.writeFile(
        path.join(folder, "SKILL.md"),
        `---\nname: ${name}\ndescription: Shared ${name} procedure\n---\nSHARED_BODY_${name}`,
      );
    }
    await fs.mkdir(path.join(agentDir, "skills"), { recursive: true });
    await fs.symlink(
      path.join(shared, "blender-arjun/animation"),
      path.join(agentDir, "skills/animation"),
      "junction",
    );
    const tools = new Map();
    let scope = "planner";
    registerProfileResources(
      { registerTool: (t) => tools.set(t.name, t), on() {} },
      () => ({ name: scope, scope }),
    );
    const ctx = {
      cwd: path.join(temp, "project"),
      isProjectTrusted: () => true,
    };
    const lookup = async (query) =>
      JSON.parse(
        (
          await tools
            .get("skill_catalog")
            .execute("id", { query }, undefined, undefined, ctx)
        ).content[0].text,
      ).skills.map((s) => s.name);
    assert.deepEqual(await lookup("superbuild"), ["superbuild"]);
    assert.deepEqual(await lookup("animation"), []);
    scope = "blender-specialist";
    assert.deepEqual(await lookup("animation"), ["animation"]);
    const loaded = await tools
      .get("skill_load")
      .execute("id", { name: "animation" }, undefined, undefined, ctx);
    assert.match(JSON.stringify(loaded), /SHARED_BODY_animation/);
    const expectedBase = await fs.realpath(
      path.join(shared, "blender-arjun/animation"),
    );
    assert.ok(
      loaded.content[0].text.includes(`Base directory: ${expectedBase}`),
      "Relative references must resolve under the shared family, not the flat Pi alias",
    );
    scope = "orchestrator";
    assert.deepEqual(await lookup("superbuild"), []);
  } finally {
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = old;
    await fs.rm(temp, { recursive: true, force: true });
  }
});
test("child profiles suppress inherited skill metadata while keeping their tools and complete", () => {
  const hooks = new Map();
  let active;
  registerProfileResources(
    {
      registerTool() {},
      on(name, callback) {
        hooks.set(name, callback);
      },
      getAllTools: () => [],
      setActiveTools: (tools) => {
        active = tools;
      },
    },
    () => ({ name: "executor", scope: "executor", tools: ["read"] }),
    true,
  );
  const options = {
    skills: [{ name: "UNRELATED_SKILL_METADATA" }],
    selectedTools: [],
  };
  hooks.get("before_agent_start")({ systemPromptOptions: options });
  assert.deepEqual(options.skills, []);
  assert.deepEqual(active, ["read", "complete"]);
});
test("MCP gateway filters schemas, blocks cross-service calls and preserves image blocks", async () => {
  const tools = new Map(),
    hooks = new Map();
  registerProfileResources(
    {
      registerTool(t) {
        tools.set(t.name, t);
      },
      on(n, h) {
        hooks.set(n, h);
      },
    },
    () => ({
      name: "desktop-operator",
      scope: "desktop-operator",
      tools: ["profile_mcp"],
    }),
  );
  const image = { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
    result = {
      content: [{ type: "text", text: "snapshot" }, image],
      details: {},
    };
  const ctx = {
    cwd: process.cwd(),
    tools: [
      {
        name: "mcp__windows_mcp__Snapshot",
        description: "Inspect UI",
        parameters: { type: "object" },
      },
      {
        name: "mcp__higgsfield__generate",
        description: "PAID SERVICE SECRET",
        parameters: {},
      },
    ],
    executeTool: async (name) => {
      assert.equal(name, "mcp__windows_mcp__Snapshot");
      return { result, isError: false };
    },
  };
  const gateway = tools.get("profile_mcp");
  const list = await gateway.execute(
    "id",
    { action: "list" },
    undefined,
    undefined,
    ctx,
  );
  assert.match(JSON.stringify(list), /Snapshot/);
  assert.doesNotMatch(JSON.stringify(list), /higgsfield|PAID SERVICE SECRET/);
  assert.deepEqual(
    await gateway.execute(
      "id",
      { action: "call", name: "mcp__windows_mcp__Snapshot" },
      undefined,
      undefined,
      ctx,
    ),
    result,
  );
  await assert.rejects(
    () =>
      gateway.execute(
        "id",
        { action: "call", name: "mcp__higgsfield__generate" },
        undefined,
        undefined,
        ctx,
      ),
    /outside/,
  );
  assert.equal(
    hooks.get("tool_call")({
      toolName: "subagent",
      input: { agent: "workspace-scout" },
    }).block,
    true,
  );
  assert.equal(
    hooks.get("tool_call")({ toolName: "mcp__higgsfield__generate", input: {} })
      .block,
    true,
  );
});
test(
  "real SDK sends no automatic skill metadata across nine profiles and loads only requested permitted skills",
  { timeout: 120000 },
  async () => {
    const root = path.resolve(import.meta.dirname, ".."),
      temp = await fs.mkdtemp(path.join(os.tmpdir(), "profile-resource-sdk-"));
    const agentDir = path.join(temp, "home/.pi/agent"),
      cwd = path.join(temp, "project"),
      old = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    let session;
    try {
      await fs.mkdir(path.join(agentDir, "agents"), { recursive: true });
      await fs.mkdir(cwd, { recursive: true });
      for (const name of await fs.readdir(
        path.join(root, "examples/profiles"),
      )) {
        const content = (
          await fs.readFile(path.join(root, "examples/profiles", name), "utf8")
        ).replace("provider: codex-account-pool", "provider: offline-profiles");
        await fs.writeFile(path.join(agentDir, "agents", name), content);
      }
      const skillNames = [
        "pi-zgrep-search",
        "superbuild",
        "agent-browser",
        "higgsfield",
        "higgsfield-camera",
        "blender-director",
        "blender-image-to-3d",
        "rendering",
      ];
      const skills = skillNames.map((name) => ({
        name,
        description: "CATALOG_" + name,
        filePath: path.join(agentDir, "skills", name, "SKILL.md"),
        baseDir: agentDir,
        sourceInfo: {},
        disableModelInvocation: false,
      }));
      for (const s of skills) {
        await fs.mkdir(path.dirname(s.filePath), { recursive: true });
        await fs.writeFile(
          s.filePath,
          "---\nname: " +
            s.name +
            "\ndescription: " +
            s.description +
            "\n---\nBODY_" +
            s.name,
        );
      }
      const records = path.join(temp, "requests.jsonl"),
        provider = path.join(agentDir, "offline-provider.ts");
      await fs.writeFile(
        provider,
        `import {appendFileSync} from "node:fs";import {Type} from "typebox";import {createAssistantMessageEventStream} from "@earendil-works/pi-ai";
export default function(pi){
 for(const name of ["zg","subagent","todo","ask_user_question","goal_complete","goal_blocked","goal_wait","subagent_wait","subagent_status","plannotator_submit_plan","web_search","fetch_content","get_search_content","source_check"]){pi.registerTool({name,label:name,description:name,parameters:Type.Object({}),async execute(){return {content:[{type:"text",text:"fixture"}],details:{}}}});}
 pi.on("before_agent_start",e=>{e.systemPromptOptions.sections.mcp_servers="UNRELATED_SERVICE_CATALOG";});
 pi.registerProvider("offline-profiles",{api:"offline-profiles-api",baseUrl:"http://127.0.0.1:1/unused",apiKey:"offline-test",models:["gpt-6-astra","gpt-6.1-sol","gpt-6-luna"].map(id=>({id,name:id,reasoning:true,input:["text"],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:64000,maxTokens:4096})),streamSimple(model,context){
 appendFileSync(${JSON.stringify(records)},JSON.stringify({model:model.id,context})+"\\n");const s=createAssistantMessageEventStream();queueMicrotask(()=>{const last=context.messages.at(-1);const text=last?.role==="user"?JSON.stringify(last.content):"";const request=text.includes("QUERY_SUPERBUILD")?{name:"skill_catalog",arguments:{query:"superbuild",limit:1}}:text.includes("LOAD_SUPERBUILD")?{name:"skill_load",arguments:{name:"superbuild"}}:text.includes("DENY_HIGGSFIELD")?{name:"skill_load",arguments:{name:"higgsfield"}}:undefined;const content=request?[{type:"toolCall",id:"resource-"+Date.now(),...request}]:[{type:"text",text:"OFFLINE"}];const m={role:"assistant",api:"offline-profiles-api",provider:"offline-profiles",model:model.id,content,stopReason:request?"toolUse":"stop",timestamp:Date.now(),usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};s.push({type:"start",partial:m});s.push({type:"done",reason:m.stopReason,message:m});s.end()});return s;}});
}`,
      );
      const {
        createAgentSession,
        DefaultResourceLoader,
        SettingsManager,
        SessionManager,
        ModelRuntime,
      } = await import("@earendil-works/pi-coding-agent");
      const config = {
        extensions: [provider, path.join(root, "index.ts")],
        defaultProvider: "offline-profiles",
        defaultModel: "gpt-6.1-sol",
        defaultProjectTrust: "always",
        compaction: { enabled: false },
      };
      await fs.writeFile(
        path.join(agentDir, "settings.json"),
        JSON.stringify(config),
      );
      await fs.copyFile(
        path.join(root, "examples/agent-profiles.json"),
        path.join(agentDir, "agent-profiles.json"),
      );
      const settings = SettingsManager.inMemory(config),
        loader = new DefaultResourceLoader({
          cwd,
          agentDir,
          settingsManager: settings,
          noContextFiles: true,
          skillsOverride: () => ({ skills, diagnostics: [] }),
        });
      await loader.reload();
      const runtime = await ModelRuntime.create({
        authPath: path.join(agentDir, "auth.json"),
        modelsPath: null,
        modelsStorePath: path.join(temp, "cache.json"),
        refreshOnCreate: false,
        allowModelNetwork: false,
      });
      const created = await createAgentSession({
        cwd,
        agentDir,
        settingsManager: settings,
        resourceLoader: loader,
        modelRuntime: runtime,
        sessionManager: SessionManager.inMemory(cwd),
      });
      session = created.session;
      assert.deepEqual(created.extensionsResult.errors, []);
      await session.setModel(
        session.extensionRunner
          .getModelRegistry()
          .find("offline-profiles", "gpt-6.1-sol"),
      );
      const errors = [];
      session.extensionRunner.onError((e) => errors.push(e));
      await session.bindExtensions({ mode: "print" });
      for (const tool of ["goal_complete", "goal_blocked", "goal_wait", "subagent_wait", "subagent_status"])
        assert.ok(
          session.getActiveToolNames().includes(tool),
          `default orchestrator must enable ${tool} before its first turn`,
        );
      await session.prompt("Default profile fixture");
      assert.equal(session.thinkingLevel, "medium");
      assert.equal(
        session.getActiveToolNames().includes("agent_catalog"),
        true,
      );
      const expected = {
        planner: [],
        orchestrator: [],
        executor: [],
        reviewer: [],
        "workspace-scout": [],
        "browser-operator": [],
        "desktop-operator": [],
        "higgsfield-specialist": [],
        "blender-specialist": [],
      };
      for (const [name, allowed] of Object.entries(expected)) {
        await session.prompt("/agent " + name);
        for (const tool of ["goal_complete", "goal_blocked", "goal_wait", "subagent_wait", "subagent_status"])
          assert.equal(
            session.getActiveToolNames().includes(tool),
            name === "orchestrator",
            `${name}: immediate ${tool} access`,
          );
        await session.prompt("Probe " + name);
        const calls = (await fs.readFile(records, "utf8"))
            .trim()
            .split("\n")
            .map(JSON.parse),
          call = calls.at(-1),
          text = JSON.stringify(call.context);
        const catalogMarkers = new Set(text.match(/CATALOG_[a-z0-9-]+/g) ?? []);
        for (const skill of skillNames)
          assert.equal(
            catalogMarkers.has("CATALOG_" + skill),
            allowed.includes(skill),
            name + " skill " + skill,
          );
        assert.doesNotMatch(text, /UNRELATED_SERVICE_CATALOG/);
        const loadout = new Map();
        for (const m of call.context.messages.filter(
          (m) => m.role === "system",
        )) {
          for (const t of m.toolsAdded ?? []) loadout.set(t.name, t);
          for (const t of m.toolsRemoved ?? []) loadout.delete(t.name);
        }
        const declared = [...loadout.keys()];
        assert.equal(declared.includes("subagent"), name === "orchestrator");
        assert.equal(
          declared.includes("profile_mcp"),
          [
            "desktop-operator",
            "higgsfield-specialist",
            "blender-specialist",
          ].includes(name),
        );
        assert.equal(declared.includes("roles"), false);
        assert.equal(
          call.model,
          name === "planner"
            ? "gpt-6-astra"
            : [
                  "orchestrator",
                  "blender-specialist",
                  "higgsfield-specialist",
                ].includes(name)
              ? "gpt-6.1-sol"
              : "gpt-6-luna",
        );
      }
      const latest = async () =>
        JSON.parse(
          (await fs.readFile(records, "utf8")).trim().split("\n").at(-1),
        );
      await session.prompt("/agent planner");
      await session.prompt("QUERY_SUPERBUILD");
      assert.match(
        JSON.stringify((await latest()).context),
        /CATALOG_superbuild/,
      );
      assert.doesNotMatch(
        JSON.stringify((await latest()).context),
        /BODY_superbuild|CATALOG_higgsfield/,
      );
      await session.prompt("LOAD_SUPERBUILD");
      assert.match(JSON.stringify((await latest()).context), /BODY_superbuild/);
      await session.prompt("DENY_HIGGSFIELD");
      assert.doesNotMatch(
        JSON.stringify((await latest()).context),
        /BODY_higgsfield/,
      );
      assert.ok(
        session.messages.some(
          (m) =>
            m.role === "toolResult" &&
            m.isError &&
            JSON.stringify(m.content).includes("Skill is unavailable"),
        ),
      );
      await session.prompt("/agent orchestrator");
      await session.prompt("After skill use and profile switch");
      assert.doesNotMatch(
        JSON.stringify((await latest()).context),
        /BODY_superbuild|CATALOG_superbuild/,
      );
      await session.prompt("/agent reset");
      await session.prompt("Default also has no automatic skill catalog");
      const defaultSystems = (await latest()).context.messages.filter(
        (m) => m.role === "system",
      );
      assert.doesNotMatch(JSON.stringify(defaultSystems), /CATALOG_|<skills>/);
      assert.deepEqual(errors, []);
    } finally {
      if (session) {
        await session.abort();
        session.dispose();
      }
      if (old === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = old;
      await fs.rm(temp, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  },
);
