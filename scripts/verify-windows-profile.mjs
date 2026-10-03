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
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
const root = path.resolve(import.meta.dirname, ".."),
  actualDir = getAgentDir(),
  config = JSON.parse(
    await fs.readFile(path.join(actualDir, "mcp.json"), "utf8"),
  );
assert.equal(process.platform, "win32");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-profile-windows-")),
  agentDir = path.join(temp, "agent"),
  previousDir = process.env.PI_CODING_AGENT_DIR,
  previousDepth = process.env.PI_SUBAGENT_DEPTH;
let session;
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_SUBAGENT_DEPTH = "1";
try {
  await fs.mkdir(path.join(agentDir, "agents"), { recursive: true });
  await fs.copyFile(
    path.join(root, "examples/profiles/desktop-operator.md"),
    path.join(agentDir, "agents/desktop-operator.md"),
  );
  await fs.writeFile(
    path.join(agentDir, "mcp.json"),
    JSON.stringify({
      mcpServers: { "windows-mcp": config.mcpServers["windows-mcp"] },
    }),
  );
  const provider = path.join(agentDir, "probe.ts"),
    marker = path.join(temp, "types.jsonl");
  await fs.writeFile(
    provider,
    `import {appendFileSync} from "node:fs";import {createAssistantMessageEventStream} from "@earendil-works/pi-ai";import {createChildProfile} from ${JSON.stringify(path.join(root, "profile-resources.ts").replace(/\\/g, "/"))};
export default async function(pi) {await createChildProfile("desktop-operator")(pi);
 pi.registerProvider("offline-windows",{api:"offline-windows-api",baseUrl:"http://127.0.0.1:1/unused",apiKey:"offline",models:[{id:"probe",name:"probe",reasoning:false,input:["text","image"],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:64000,maxTokens:4096}],streamSimple(model,context){
 const results=context.messages.filter(m=>m.role==="toolResult"), last=results.at(-1);let content=[{type:"text",text:"VERIFIED"}];
 if(results.length===0)content=[{type:"toolCall",id:"list",name:"profile_mcp",arguments:{action:"list",query:"Snapshot",limit:1}}];
 else if(results.length===1){const found=JSON.parse(last.content.find(c=>c.type==="text").text).tools[0];if(!found||!/__Snapshot$/.test(found.name))throw new Error("Snapshot unavailable");content=[{type:"toolCall",id:"snapshot",name:"profile_mcp",arguments:{action:"call",name:found.name,args:{use_vision:true}}}];}
 else appendFileSync(${JSON.stringify(marker)},JSON.stringify({isError:last.isError,types:last.content.map(c=>c.type)})+"\\n");
 const s=createAssistantMessageEventStream();queueMicrotask(()=>{const message={role:"assistant",api:"offline-windows-api",provider:"offline-windows",model:"probe",content,stopReason:content[0].type==="toolCall"?"toolUse":"stop",timestamp:Date.now(),usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};s.push({type:"start",partial:message});s.push({type:"done",reason:message.stopReason,message});s.end()});return s;}});
}`,
  );
  const settings = SettingsManager.inMemory({
    extensions: [provider],
    compaction: { enabled: false },
    defaultProjectTrust: "always",
  });
  const loader = new DefaultResourceLoader({
    cwd: temp,
    agentDir,
    settingsManager: settings,
    noSkills: true,
    noContextFiles: true,
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
    cwd: temp,
    agentDir,
    settingsManager: settings,
    resourceLoader: loader,
    modelRuntime: runtime,
    sessionManager: SessionManager.inMemory(temp),
  });
  session = created.session;
  assert.deepEqual(created.extensionsResult.errors, []);
  await session.setModel(
    session.extensionRunner.getModelRegistry().find("offline-windows", "probe"),
  );
  await session.bindExtensions({ mode: "print" });
  const deadline = Date.now() + 30000;
  while (
    Date.now() < deadline &&
    !session.getAllTools().some((t) => t.name === "mcp__windows_mcp__Snapshot")
  )
    await new Promise((r) => setTimeout(r, 100));
  await session.prompt("Inspect the desktop once. Do not act.");
  const result = JSON.parse((await fs.readFile(marker, "utf8")).trim());
  assert.equal(result.isError, false);
  assert.ok(result.types.includes("image"));
  console.log(
    JSON.stringify({
      passed: true,
      service: "windows-mcp",
      operation: "Snapshot",
      imagePreserved: true,
      paidRequests: 0,
      desktopActions: 0,
    }),
  );
} finally {
  if (session) {
    await session.extensionRunner.emit({
      type: "session_shutdown",
      reason: "exit",
    });
    await session.abort();
    session.dispose();
  }
  if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousDir;
  if (previousDepth === undefined) delete process.env.PI_SUBAGENT_DEPTH;
  else process.env.PI_SUBAGENT_DEPTH = previousDepth;
  await fs.rm(temp, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 100,
  });
}
