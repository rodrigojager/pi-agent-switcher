import fs from "node:fs/promises";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
const root = path.resolve(import.meta.dirname, ".."),
  agentDir = getAgentDir();
const backup = path.join(
  agentDir,
  "backups",
  "agent-profiles-" + new Date().toISOString().replace(/[:.]/g, "-"),
);
async function save(relative, content) {
  const target = path.join(agentDir, relative);
  try {
    await fs.mkdir(path.dirname(path.join(backup, relative)), {
      recursive: true,
    });
    await fs.copyFile(target, path.join(backup, relative));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}
for (const file of await fs.readdir(path.join(root, "examples/profiles"))) {
  if (!file.endsWith(".md")) continue;
  const name = file.slice(0, -3);
  await save(
    "agents/" + file,
    await fs.readFile(path.join(root, "examples/profiles", file)),
  );
  await save(
    "extensions/profile-" + name + ".ts",
    "import {createChildProfile} from " +
      JSON.stringify(
        path.join(root, "profile-resources.ts").replace(/\\/g, "/"),
      ) +
      ";\nexport default createChildProfile(" +
      JSON.stringify(name) +
      ");\n",
  );
}
await save(
  "agent-profiles.json",
  await fs.readFile(path.join(root, "examples/agent-profiles.json")),
);
await save(
  "extensions/profile-provider.ts",
  await fs.readFile(path.join(root, "examples/extensions/profile-provider.ts")),
);
console.log(
  JSON.stringify({ installed: true, profiles: 11, backup, agentDir }),
);
