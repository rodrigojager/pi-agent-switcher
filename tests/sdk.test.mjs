import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

test(
  "real Pi SDK switches profiles and delegates to a real offline child without a main-model request",
  { timeout: 120000 },
  async () => {
    const root = process.env.PI_SWITCHER_TEST_ROOT
      ? path.resolve(process.env.PI_SWITCHER_TEST_ROOT)
      : path.resolve(import.meta.dirname, "..");
    const temp = await fs.mkdtemp(
      path.join(os.tmpdir(), "agent-switcher-sdk-"),
    );
    const agentDir = path.join(temp, "agent");
    const marker = path.join(temp, "requests.jsonl");
    const provider = path.join(agentDir, "offline-provider.ts");
    const bridge =
      process.env.PI_SUBAGENT_TEST_ENTRY ??
      fileURLToPath(import.meta.resolve("pi-subagent-runtime"));
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
        "---\nname: scout\ndescription: Offline evidence collector\nprovider: offline-switcher\nmodel: cheap\nthinking: low\nrole: backend-architect\ntools: read\nskills: false\nextensions: offline-provider\n---\nCollect the requested evidence.",
      );
      await fs.writeFile(
        path.join(agentDir, "agents/planner.md"),
        "---\nname: planner\ndescription: Offline planner\nskills: video\ntools: read\n---\nPlan the work.",
      );
      await fs.mkdir(path.join(agentDir, "roles"), { recursive: true });
      await fs.writeFile(
        path.join(agentDir, "roles/backend-architect.md"),
        "ARCHITECT_ROLE",
      );
      await fs.writeFile(
        path.join(agentDir, "roles/code-reviewer.md"),
        "REVIEWER_ROLE",
      );
      await fs.writeFile(
        path.join(agentDir, "agents/executor.md"),
        "---\nname: executor\ndescription: Roles fixture\nprovider: offline-switcher\nmodel: cheap\nrole: backend-architect\nskills: false\ncontext: false\nextensions: offline-provider\nreplace_prompt: true\n---\nEXECUTOR_BODY",
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
      if (child && JSON.stringify(context.messages).includes('roles-cancel')) { setInterval(() => {}, 1000); return stream; }
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
      await fs.mkdir(path.join(agentDir, "extensions"), { recursive: true });
      await fs.writeFile(
        path.join(agentDir, "extensions/resource-executor.ts"),
        `import {createChildProfile} from ${JSON.stringify(path.join(root, "profile-resources.ts").replace(/\\/g, "/"))}; export default createChildProfile("scoped");`,
      );
      await fs.writeFile(
        path.join(agentDir, "agents/scoped.md"),
        "---\nname: scoped\ndescription: Scoped child fixture\nprovider: offline-switcher\nmodel: cheap\nthinking: high\nresource_profile: executor\ntools: read, skill_catalog, skill_load\nskills: false\ncontext: false\nextensions: offline-provider, resource-executor\n---\nSCOPED_CHILD_BODY",
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
      await session.setModel(
        session.extensionRunner
          .getModelRegistry()
          .find("offline-switcher", "base"),
      );
      session.setThinkingLevel("medium");
      await session.prompt("/agent planner");
      await session.prompt("/agent scout");
      assert.equal(session.model.id, "base");
      assert.equal(session.thinkingLevel, "medium");
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
      const launchForms = [
        "@agent:executor roles-default",
        "/delegate executor --role none roles-none",
        "/run executor --role=code-reviewer roles-reviewer",
      ];
      await Promise.all(
        launchForms.map((text) =>
          session.prompt(text, { source: "interactive" }),
        ),
      );
      const expectedResults = 4;
      const roleDeadline = Date.now() + 20000;
      while (
        Date.now() < roleDeadline &&
        session.messages.filter(
          (m) => m.role === "custom" && m.customType === "subagent-result",
        ).length < expectedResults
      )
        await new Promise((resolve) => setTimeout(resolve, 50));
      const resultMessages = session.messages.filter(
        (m) => m.role === "custom" && m.customType === "subagent-result",
      );
      assert.equal(
        resultMessages.length,
        expectedResults,
        "All concurrent roles return completion",
      );
      calls = await records();
      for (const [task, id, marker] of [
        ["roles-default", "backend-architect", "ARCHITECT_ROLE"],
        ["roles-none", undefined, undefined],
        ["roles-reviewer", "code-reviewer", "REVIEWER_ROLE"],
      ]) {
        const call = calls.find(
          (c) => c.child && JSON.stringify(c.context.messages).includes(task),
        );
        assert.ok(call, `Actual child model input captured: ${task}`);
        const systemPrompt = JSON.stringify(
          call.context.messages.filter((m) => m.role === "system"),
        );
        assert.match(systemPrompt, /EXECUTOR_BODY/);
        assert.match(systemPrompt, /complete/);
        assert.equal(
          (systemPrompt.match(/ARCHITECT_ROLE/g) ?? []).length,
          marker === "ARCHITECT_ROLE" ? 1 : 0,
        );
        assert.equal(
          (systemPrompt.match(/REVIEWER_ROLE/g) ?? []).length,
          marker === "REVIEWER_ROLE" ? 1 : 0,
        );
        const details = resultMessages.find(
          (m) => m.details?.results?.[0]?.task === task,
        )?.details.results[0];
        assert.ok(details);
        assert.equal(details.role.effectiveId, id);
        assert.equal(
          details.role.origin,
          task === "roles-default" ? "agent-default" : "invocation",
        );
        assert.equal(details.role.body, undefined);
        assert.equal(details.role.sourcePath, undefined);
      }
      assert.match(
        await fs.readFile(path.join(agentDir, "agents/executor.md"), "utf8"),
        /role: backend-architect/,
      );
      const defaultChild = calls.find(
        (c) =>
          c.child &&
          JSON.stringify(c.context.messages).includes("collect evidence"),
      );
      assert.match(
        JSON.stringify(
          defaultChild.context.messages.filter((m) => m.role === "system"),
        ),
        /ARCHITECT_ROLE/,
      );
      await session.prompt("@executor Fresh default after override", {
        source: "interactive",
      });
      const finalDeadline = Date.now() + 15000;
      while (
        Date.now() < finalDeadline &&
        session.messages.filter(
          (m) => m.role === "custom" && m.customType === "subagent-result",
        ).length < 5
      )
        await new Promise((resolve) => setTimeout(resolve, 50));
      calls = await records();
      assert.match(
        JSON.stringify(
          calls
            .find(
              (c) =>
                c.child &&
                JSON.stringify(c.context.messages).includes(
                  "Fresh default after override",
                ),
            )
            .context.messages.filter((m) => m.role === "system"),
        ),
        /ARCHITECT_ROLE/,
      );
      assert.equal(
        calls.filter((c) => c.pid === process.pid).length,
        mainCalls,
        "Delegation never called the main model",
      );
      await session.prompt("@executor --role code-reviewer roles-cancel", {
        source: "interactive",
      });
      let cancelCall;
      const cancelStartDeadline = Date.now() + 15000;
      while (Date.now() < cancelStartDeadline && !cancelCall) {
        cancelCall = (await records()).find(
          (c) =>
            c.child &&
            JSON.stringify(c.context.messages).includes("roles-cancel"),
        );
        if (!cancelCall)
          await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(
        cancelCall,
        "Cancellation fixture reached an actual child model request",
      );
      await fs.writeFile(
        path.join(agentDir, "roles/code-reviewer.md"),
        "CHANGED_REVIEWER_ROLE",
      );
      const cancelPrompt = JSON.stringify(
        cancelCall.context.messages.filter((m) => m.role === "system"),
      );
      assert.match(cancelPrompt, /REVIEWER_ROLE/);
      assert.doesNotMatch(cancelPrompt, /CHANGED_REVIEWER_ROLE/);
      const cancelledRun = session.messages.find(
        (m) =>
          m.role === "custom" &&
          m.customType === "subagent-progress" &&
          m.details?.role?.effectiveId === "code-reviewer" &&
          m.details?.requestId &&
          m.details.role.contentHash ===
            resultMessages.find(
              (r) => r.details?.results?.[0]?.task === "roles-reviewer",
            ).details.results[0].role.contentHash,
      );
      assert.ok(cancelledRun, "Live metadata keeps the captured role hash");
      const cancellationNotices = [];
      session.extensionRunner.setUIContext(
        {
          ...session.extensionRunner.getUIContext(),
          notify: (text) => cancellationNotices.push(text),
        },
        "print",
      );
      await session.prompt("/cancel-subagent all");
      const alive = (pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      const cancelDeadline = Date.now() + 5000;
      while (Date.now() < cancelDeadline && alive(cancelCall.pid))
        await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(
        alive(cancelCall.pid),
        false,
        "Cancellation stopped the real child process",
      );
      while (
        Date.now() < cancelDeadline &&
        cancellationNotices.at(-1) !== "No active /run jobs."
      ) {
        await session.prompt("/cancel-subagent all");
        if (cancellationNotices.at(-1) !== "No active /run jobs.")
          await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(
        cancellationNotices.at(-1),
        "No active /run jobs.",
        "Cancellation lifecycle released the run registry before session disposal",
      );
      assert.deepEqual(errors, []);
      await session.prompt("@scoped Verify child resource scope", {
        source: "interactive",
      });
      const scopedDeadline = Date.now() + 15000;
      while (
        Date.now() < scopedDeadline &&
        !session.messages.some(
          (m) =>
            m.role === "custom" &&
            m.customType === "subagent-result" &&
            JSON.stringify(m).includes("Verify child resource scope"),
        )
      )
        await new Promise((r) => setTimeout(r, 50));
      const scopedCall = (await records()).find(
        (c) =>
          c.child &&
          JSON.stringify(c.context.messages).includes(
            "Verify child resource scope",
          ),
      );
      assert.ok(scopedCall, "Scoped child reached the actual offline runtime");
      const scopedTools = scopedCall.context.messages
        .filter((m) => m.role === "system")
        .flatMap((m) => m.toolsAdded ?? [])
        .map((t) => t.name);
      assert.ok(scopedTools.includes("complete"));
      assert.ok(scopedTools.includes("skill_load"));
      assert.equal(scopedTools.includes("subagent"), false);
      assert.equal(scopedTools.includes("roles"), false);
      assert.match(JSON.stringify(scopedCall.context), /SCOPED_CHILD_BODY/);
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
      await fs.rm(temp, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100,
      });
    }
  },
);
