import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { KeybindingsManager } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";

test("Alt+M opens the native model selector, retains Ctrl+L and applies on keybindings reload", async () => {
  const root =
    process.env.PI_SWITCHER_TEST_ROOT ??
    path.resolve(import.meta.dirname, "..");
  const config = JSON.parse(
    await readFile(path.join(root, "examples/keybindings.json"), "utf8"),
  );
  const temp = await mkdtemp(path.join(os.tmpdir(), "pi-model-keybindings-"));
  try {
    await writeFile(
      path.join(temp, "keybindings.json"),
      JSON.stringify({
        "app.model.select": "ctrl+l",
        "app.editor.external": "ctrl+g",
      }),
    );
    const keys = KeybindingsManager.create(temp);
    assert.equal(keys.matches("\x1bm", "app.model.select"), false);
    await writeFile(
      path.join(temp, "keybindings.json"),
      JSON.stringify({ "app.editor.external": "ctrl+g", ...config }),
    );
    keys.reload();
    assert.equal(keys.matches("\x1bm", "app.model.select"), true);
    assert.equal(keys.matches("\x0c", "app.model.select"), true);
    assert.equal(keys.matches("\x07", "app.editor.external"), true);
    assert.equal(keys.matches("\x1br", "app.model.select"), false);
    assert.equal(keys.matches("\x1ba", "app.model.select"), false);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
