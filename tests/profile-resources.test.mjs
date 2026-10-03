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
} = await jiti.import("../profile-resources.ts");
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
  "real SDK sends only selected catalogs and declarations across nine profile changes",
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
 for(const name of ["zg","subagent","todo","ask_user_question","goal_complete","goal_blocked","goal_wait","plannotator_submit_plan","web_search","fetch_content","get_search_content","source_check"]){pi.registerTool({name,label:name,description:name,parameters:Type.Object({}),async execute(){return {content:[{type:"text",text:"fixture"}],details:{}}}});}
 pi.on("before_agent_start",e=>{e.systemPromptOptions.sections.mcp_servers="UNRELATED_SERVICE_CATALOG";});
 pi.registerProvider("offline-profiles",{api:"offline-profiles-api",baseUrl:"http://127.0.0.1:1/unused",apiKey:"offline-test",models:["gpt-6-astra","gpt-6.1-sol","gpt-6-luna"].map(id=>({id,name:id,reasoning:true,input:["text"],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:64000,maxTokens:4096})),streamSimple(model,context){
 appendFileSync(${JSON.stringify(records)},JSON.stringify({model:model.id,context})+"\\n");const s=createAssistantMessageEventStream();queueMicrotask(()=>{const m={role:"assistant",api:"offline-profiles-api",provider:"offline-profiles",model:model.id,content:[{type:"text",text:"OFFLINE"}],stopReason:"stop",timestamp:Date.now(),usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};s.push({type:"start",partial:m});s.push({type:"done",reason:"stop",message:m});s.end()});return s;}});
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
      await session.prompt("Default profile fixture");
      assert.equal(session.thinkingLevel, "medium");
      assert.equal(
        session.getActiveToolNames().includes("agent_catalog"),
        true,
      );
      const expected = {
        planner: ["pi-zgrep-search"],
        orchestrator: ["pi-zgrep-search"],
        executor: ["pi-zgrep-search"],
        reviewer: ["pi-zgrep-search"],
        "workspace-scout": ["pi-zgrep-search"],
        "browser-operator": ["agent-browser"],
        "desktop-operator": [],
        "higgsfield-specialist": ["higgsfield"],
        "blender-specialist": ["blender-director", "blender-image-to-3d"],
      };
      for (const [name, allowed] of Object.entries(expected)) {
        await session.prompt("/agent " + name);
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
