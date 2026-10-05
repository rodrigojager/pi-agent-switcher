import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SettingsManager,
  SessionManager,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";

test(
  "installed /goal starts immediately after orchestrator selection in an isolated offline SDK session",
  {
    skip: !process.env.PI_GOAL_EXTENSION_PATH,
    timeout: 20000,
  },
  async () => {
    const temp = await fs.mkdtemp(
      path.join(os.tmpdir(), "goal-allowlist-smoke-"),
    );
    const agentDir = path.join(temp, "agent"),
      cwd = path.join(temp, "project");
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    let session;
    try {
      await fs.mkdir(path.join(agentDir, "agents"), { recursive: true });
      await fs.mkdir(cwd);
      const profile = await fs.readFile(
        path.join(import.meta.dirname, "../examples/profiles/orchestrator.md"),
        "utf8",
      );
      await fs.writeFile(
        path.join(agentDir, "agents/orchestrator.md"),
        profile.replace(
          "provider: codex-account-pool",
          "provider: offline-goal",
        ),
      );
      const provider = path.join(agentDir, "offline.ts");
      await fs.writeFile(
        provider,
        `
import { Type } from "typebox";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
export default function(pi) {
  for (const name of ["zg", "subagent"]) pi.registerTool({ name, label: name, description: name,
    parameters: Type.Object({}), async execute() { return { content: [{type:"text",text:"offline"}], details:{} }; } });
  pi.registerProvider("offline-goal", { api: "offline-goal-api", baseUrl: "http://127.0.0.1:1/unused", apiKey: "fixture",
    models: [{id:"gpt-6.1-sol",name:"Offline goal",reasoning:true,input:["text"],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:64000,maxTokens:4096}],
    streamSimple(model, context) {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const last = context.messages.at(-1);
        const text = last?.role === "user" ? last.content.map(c => c.text ?? "").join(" ") : "";
        const id = text.split("<goal_id>")[1]?.split("</goal_id>")[0]?.trim();
        const content = id ? [{type:"toolCall",id:"finish-offline-goal",name:"goal_complete",arguments:{goal_id:id,summary:"Verified isolated goal startup and active tool allowlist."}}] : [{type:"text",text:"OFFLINE"}];
        const message = {role:"assistant",api:"offline-goal-api",provider:"offline-goal",model:model.id,content,stopReason:id?"toolUse":"stop",timestamp:Date.now(),usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
        stream.push({type:"start",partial:message});stream.push({type:"done",reason:message.stopReason,message});stream.end();
      });
      return stream;
    }
  });
}`,
      );
      const config = {
        extensions: [
          provider,
          path.resolve(import.meta.dirname, "../index.ts"),
          process.env.PI_GOAL_EXTENSION_PATH,
        ],
        defaultProvider: "offline-goal",
        defaultModel: "gpt-6.1-sol",
        defaultProjectTrust: "always",
        compaction: { enabled: false },
      };
      const settingsManager = SettingsManager.inMemory(config);
      const resourceLoader = new DefaultResourceLoader({
        cwd,
        agentDir,
        settingsManager,
        noSkills: true,
        noContextFiles: true,
      });
      await resourceLoader.reload();
      const modelRuntime = await ModelRuntime.create({
        authPath: path.join(agentDir, "auth.json"),
        modelsPath: null,
        modelsStorePath: path.join(temp, "models.json"),
        refreshOnCreate: false,
        allowModelNetwork: false,
      });
      const created = await createAgentSession({
        cwd,
        agentDir,
        settingsManager,
        resourceLoader,
        modelRuntime,
        sessionManager: SessionManager.inMemory(cwd),
      });
      session = created.session;
      assert.deepEqual(created.extensionsResult.errors, []);
      const errors = [];
      session.extensionRunner.onError((e) => errors.push(e));
      await session.bindExtensions({ mode: "print" });
      await session.prompt("/agent orchestrator");
      for (const name of ["goal_complete", "goal_blocked"])
        assert.ok(session.getActiveToolNames().includes(name));
      await session.prompt(
        "/goal Verify isolated startup before any ordinary message",
      );
      const states = () =>
        session.sessionManager
          .getBranch()
          .filter((e) => e.type === "custom" && e.customType === "goal-state");
      assert.ok(
        states().some((e) => e.data?.goal?.status === "active"),
        "installed goal command must create an active goal",
      );
      const deadline = Date.now() + 5000;
      while (
        !states().some((e) => e.data?.goal?.status === "complete") &&
        Date.now() < deadline
      )
        await new Promise((resolve) => setTimeout(resolve, 20));
      assert.ok(
        states().some((e) => e.data?.goal?.status === "complete"),
        "offline tool must complete the started goal",
      );
      assert.deepEqual(errors, []);
    } finally {
      if (session) {
        await session.abort();
        session.dispose();
      }
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
      await fs.rm(temp, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  },
);
