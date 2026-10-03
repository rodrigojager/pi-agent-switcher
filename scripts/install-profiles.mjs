import fs from "node:fs/promises";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
const root = path.resolve(import.meta.dirname, ".."),
  agentDir = getAgentDir();
const update = process.argv.includes("--update-on-demand");
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
  let content = await fs.readFile(
    path.join(root, "examples/profiles", file),
    "utf8",
  );
  if (update) {
    try {
      content = (
        await fs.readFile(path.join(agentDir, "agents", file), "utf8")
      ).replace(/^skills:.*$/m, "skills: false");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  await save("agents/" + file, content);
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
let config = JSON.parse(
  await fs.readFile(path.join(root, "examples/agent-profiles.json"), "utf8"),
);
if (update) {
  try {
    config = {
      ...config,
      ...JSON.parse(
        await fs.readFile(path.join(agentDir, "agent-profiles.json"), "utf8"),
      ),
      skillDiscoveryMode: "on-demand",
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
await save("agent-profiles.json", JSON.stringify(config) + "\n");
await save(
  "extensions/profile-provider.ts",
  await fs.readFile(path.join(root, "examples/extensions/profile-provider.ts")),
);
console.log(
  JSON.stringify({ installed: true, profiles: 11, backup, agentDir }),
);
