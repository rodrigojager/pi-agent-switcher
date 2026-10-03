import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

test(
  "real Pi SDK switches profiles and delegates to a real offline child without a main-model request",
  { timeout: 30000 },
  async () => {
    const root = path.resolve(import.meta.dirname, "..");
    const temp = await fs.mkdtemp(
      path.join(os.tmpdir(), "agent-switcher-sdk-"),
    );
    const agentDir = path.join(temp, "agent");
    const marker = path.join(temp, "requests.jsonl");
    const provider = path.join(agentDir, "offline-provider.ts");
    const bridge = fileURLToPath(import.meta.resolve("pi-subagent-runtime"));
    const oldDir = process.env.PI_CODING_AGENT_DIR,
      oldMarker = process.env.SWITCHER_TEST_MARKER,
      oldArgv = process.argv[1],
      oldNotifications = process.env.PI_SUBAGENT_DESKTOP_NOTIFICATIONS;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env.SWITCHER_TEST_MARKER = marker;
    process.env.PI_SUBAGENT_DESKTOP_NOTIFICATIONS = "0";
    let session;
    try {
      await fs.mkdir(path.join(agentDir, "agents"), { recursive: true });
      await fs.writeFile(
        path.join(agentDir, "agents/scout.md"),
        "---\nname: scout\ndescription: Offline evidence collector\nprovider: offline-switcher\nmodel: cheap\nthinking: low\ntools: read\nskills: false\nextensions: offline-provider\n---\nCollect the requested evidence.",
      );
      await fs.writeFile(
        path.join(agentDir, "agents/planner.md"),
        "---\nname: planner\ndescription: Offline planner\nskills: video\ntools: read\n---\nPlan the work.",
      );
      await fs.writeFile(
        provider,
        `import { appendFileSync } from 'node:fs';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
export default function(pi) {
  pi.registerProvider('offline-switcher', {
    api: 'offline-switcher-api', baseUrl: 'http://127.0.0.1:1/unused', apiKey: 'offline-test',
    models: ['base', 'cheap'].map(id => ({ id, name: id, reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 64000, maxTokens: 4096 })),
    streamSimple(model, context) {
      const child = Number(process.env.PI_SUBAGENT_DEPTH ?? '0') > 0;
      appendFileSync(process.env.SWITCHER_TEST_MARKER, JSON.stringify({ pid: process.pid, child, model: model.id, context }) + '\\n');
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const message = { role: 'assistant', api: 'offline-switcher-api', provider: 'offline-switcher', model: model.id,
          content: child ? [{ type: 'toolCall', id: 'offline-complete', name: 'complete', arguments: { outcome: 'Verified offline delegation' } }] : [{ type: 'text', text: 'OFFLINE OK' }],
          stopReason: child ? 'toolUse' : 'stop', timestamp: Date.now(),
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        stream.push({ type: 'start', partial: message }); stream.push({ type: 'done', reason: message.stopReason, message }); stream.end();
      }); return stream;
    }
  });
}`,
      );
      const config = {
        extensions: [provider, path.join(root, "index.ts"), bridge],
        defaultProvider: "offline-switcher",
        defaultModel: "base",
        defaultThinkingLevel: "high",
        defaultProjectTrust: "always",
        compaction: { enabled: false },
      };
      await fs.writeFile(
        path.join(agentDir, "settings.json"),
        JSON.stringify(config),
      );
      const {
        createAgentSession,
        DefaultResourceLoader,
        SettingsManager,
        SessionManager,
        ModelRuntime,
      } = await import("@earendil-works/pi-coding-agent");
      const { KeybindingsManager } =
        await import("../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js");
      process.argv[1] = fileURLToPath(
        import.meta.resolve("@earendil-works/pi-coding-agent"),
      ).replace(/index\.js$/, "bundle/cli.js");
      const settings = SettingsManager.inMemory(config);
      const loader = new DefaultResourceLoader({
        cwd: temp,
        agentDir,
        settingsManager: settings,
        noSkills: true,
        noContextFiles: true,
        skillsOverride: () => ({
          skills: [
            {
              name: "video",
              description: "VIDEO_SKILL_MARKER",
              filePath: "video/SKILL.md",
              baseDir: "video",
              sourceInfo: {},
              disableModelInvocation: false,
            },
            {
              name: "3d",
              description: "HIDDEN_3D_SKILL_MARKER",
              filePath: "3d/SKILL.md",
              baseDir: "3d",
              sourceInfo: {},
              disableModelInvocation: false,
            },
          ],
          diagnostics: [],
        }),
      });
      await loader.reload();
      const runtime = await ModelRuntime.create({
        authPath: path.join(agentDir, "auth.json"),
        modelsPath: null,
        modelsStorePath: path.join(temp, "model-cache.json"),
        refreshOnCreate: false,
        allowModelNetwork: false,
      });
      const created = await createAgentSession({
        cwd: temp,
        agentDir,
        settingsManager: settings,
        resourceLoader: loader,
        modelRuntime: runtime,
        sessionManager: SessionManager.inMemory(temp),
      });
      session = created.session;
      await session.setModel(
        session.extensionRunner
          .getModelRegistry()
          .find("offline-switcher", "base"),
      );
      session.setThinkingLevel("high");
      assert.equal(
        session.model.id,
        "base",
        "The fixture must start with the original base model",
      );
      assert.deepEqual(created.extensionsResult.errors, []);
      const errors = [];
      session.extensionRunner.onError((error) => errors.push(error));
      const shortcuts = session.extensionRunner.getShortcuts(
        KeybindingsManager.create(agentDir).getEffectiveConfig(),
      );
      assert.ok(shortcuts.has("alt+a"));
      assert.deepEqual(session.extensionRunner.getShortcutDiagnostics(), []);
      await session.prompt("/agent scout");
      assert.equal(session.model.id, "cheap");
      assert.equal(session.thinkingLevel, "low");
      assert.deepEqual(session.getActiveToolNames(), ["read"]);
      await session.prompt("Check the selected profile");
      const records = async () =>
        (await fs.readFile(marker, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
      let calls = await records();
      assert.equal(calls.length, 1);
      assert.doesNotMatch(
        JSON.stringify(calls[0].context),
        /HIDDEN_3D_SKILL_MARKER|VIDEO_SKILL_MARKER/,
      );
      assert.match(
        JSON.stringify(calls[0].context),
        /Active main agent: scout/,
      );
      await session.prompt("/agent planner");
      await session.prompt("Check planner");
      calls = await records();
      assert.equal(session.model.id, "base");
      assert.match(JSON.stringify(calls.at(-1).context), /VIDEO_SKILL_MARKER/);
      assert.doesNotMatch(
        JSON.stringify(calls.at(-1).context),
        /HIDDEN_3D_SKILL_MARKER/,
      );
      await session.prompt("/agent reset");
      assert.ok(session.getActiveToolNames().includes("subagent"));
      assert.equal(session.model.id, "base");
      const mainCalls = calls.filter((call) => call.pid === process.pid).length;
      await session.prompt("@scout collect evidence", {
        source: "interactive",
      });
      const deadline = Date.now() + 15000;
      while (
        Date.now() < deadline &&
        !session.messages.some(
          (message) =>
            message.role === "custom" &&
            message.customType === "subagent-result",
        )
      )
        await new Promise((resolve) => setTimeout(resolve, 50));
      const result = session.messages.find(
        (message) =>
          message.role === "custom" && message.customType === "subagent-result",
      );
      assert.ok(result, "Actual child completion returned to the main session");
      assert.match(JSON.stringify(result), /Verified offline delegation/);
      calls = await records();
      assert.equal(
        calls.filter((call) => call.pid === process.pid).length,
        mainCalls,
      );
      assert.ok(calls.some((call) => call.child && call.model === "cheap"));
      assert.equal(session.model.id, "base");
      assert.deepEqual(errors, []);
    } finally {
      if (session) {
        await session.abort();
        session.dispose();
      }
      process.argv[1] = oldArgv;
      if (oldDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = oldDir;
      if (oldMarker === undefined) delete process.env.SWITCHER_TEST_MARKER;
      else process.env.SWITCHER_TEST_MARKER = oldMarker;
      if (oldNotifications === undefined)
        delete process.env.PI_SUBAGENT_DESKTOP_NOTIFICATIONS;
      else process.env.PI_SUBAGENT_DESKTOP_NOTIFICATIONS = oldNotifications;
      await fs.rm(temp, { recursive: true, force: true });
    }
  },
);
