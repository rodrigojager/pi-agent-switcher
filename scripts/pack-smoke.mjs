import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, "Run with npm run pack:smoke to resolve npm cross-platform");
const stage = await mkdtemp(path.join(os.tmpdir(), "pi-switcher-pack-"));
const npm = (args, cwd) =>
  execFileSync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
try {
  const [packed] = JSON.parse(
    npm(["pack", "--json", "--pack-destination", stage], root),
  );
  const tarball = path.join(stage, packed.filename);
  await writeFile(
    path.join(stage, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  npm(
    [
      "install",
      "--ignore-scripts",
      "--omit=dev",
      tarball,
      "@earendil-works/pi-coding-agent@1.0.0",
      "@earendil-works/pi-tui@1.0.0",
    ],
    stage,
  );
  const switcherRoot = path.join(stage, "node_modules", "pi-agent-switcher");
  const runtimeRoot = path.join(stage, "node_modules", "pi-subagent-runtime");
  const switcher = JSON.parse(
    await readFile(path.join(switcherRoot, "package.json"), "utf8"),
  );
  const runtime = JSON.parse(
    await readFile(path.join(runtimeRoot, "package.json"), "utf8"),
  );
  assert.match(
    switcher.dependencies["pi-subagent-runtime"],
    /^github:rodrigojager\/pi-subagent#[a-f0-9]{40}$/,
  );
  assert.equal(runtime.exports["./roles"], "./src/roles/index.ts");
  assert.deepEqual(runtime.pi.skills, ["./skills"]);
  for (const file of [
    "scripts/import-agency-roles.ts",
    "skills/pi-subagent-usage/SKILL.md",
    "docs/roles.md",
    "src/roles/index.ts",
  ])
    await readFile(path.join(runtimeRoot, file));
  const output = execFileSync(
    process.execPath,
    [
      "--test",
      path.join(root, "tests", "role-picker.test.mjs"),
      path.join(root, "tests", "keybindings.test.mjs"),
      path.join(root, "tests", "sdk.test.mjs"),
    ],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        PI_SWITCHER_TEST_ROOT: switcherRoot,
        PI_SUBAGENT_TEST_ENTRY: path.join(runtimeRoot, "src", "index.ts"),
      },
    },
  );
  process.stdout.write(output);
  console.log(
    `Clean production package smoke passed: switcher ${switcher.version}, runtime ${runtime.version}`,
  );
} finally {
  const relative = path.relative(os.tmpdir(), stage);
  assert.ok(
    !path.isAbsolute(relative) &&
      !relative.startsWith("..") &&
      relative.startsWith("pi-switcher-pack-"),
  );
  await rm(stage, { recursive: true, force: true });
}
