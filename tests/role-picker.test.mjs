import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
import { visibleWidth } from "@earendil-works/pi-tui";
import path from "node:path";

const jiti = createJiti(import.meta.url, { fsCache: false });
const root =
  process.env.PI_SWITCHER_TEST_ROOT ?? path.resolve(import.meta.dirname, "..");
const { pickRole } = await jiti.import(path.join(root, "role-picker.ts"));
const theme = {
  fg: (_color, text) => text,
  bold: (text) => `\x1b[1m${text}\x1b[22m`,
};
const plain = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");
const description =
  "Diagnose intermittent software failures by reproducing the issue, isolating the cause, and validating the correction.";
const role = {
  id: "hidden-debugger-id",
  name: "Root Cause Debugger",
  category: "hidden-category",
  description,
  source: "user",
  sourcePath: "/roles/hidden-debugger-id.md",
  body: "Diagnose failures.",
  contentHash: "fixture",
};
function catalog(roles = [role]) {
  return { roles, diagnostics: [], rejected: new Map(), userRoot: "/roles" };
}
async function dialog(roles, interact, current = role.id, rows = 40) {
  let result, component;
  const ctx = {
    hasUI: true,
    mode: "tui",
    ui: {
      async custom(factory) {
        component = factory(
          { requestRender() {}, terminal: { rows } },
          theme,
          {},
          (value) => {
            result = value;
          },
        );
        interact(component);
        return result;
      },
    },
  };
  const value = await pickRole(ctx, roles, current);
  return { value, component };
}

test("role cards show full-width descriptions below names and hide IDs and User scope", async () => {
  const { value } = await dialog(catalog(), (component) => {
    const lines = component.render(140).map(plain);
    const row = lines.findIndex((line) =>
      line.includes("› Root Cause Debugger"),
    );
    assert.ok(row >= 0);
    assert.equal(lines[row + 1].trim(), description);
    assert.ok(!lines[row].includes("Diagnose"));
    assert.ok(lines.join("\n").includes("Active: Root Cause Debugger"));
    assert.doesNotMatch(
      lines.join("\n"),
      /hidden-debugger-id|hidden-category|\bUser\b/,
    );
    component.handleInput("\r");
  });
  assert.equal(value, role.id, "selection still returns the internal ID");
});

test("a blank line separates role cards without separating a name from its description", async () => {
  const roles = [
    role,
    {
      ...role,
      id: "another-role",
      name: "Another Specialist",
      description: "Different responsibility.",
    },
  ];
  await dialog(catalog(roles), (component) => {
    const lines = component.render(140).map(plain);
    const first = lines.findIndex((line) =>
      line.includes("› Root Cause Debugger"),
    );
    assert.equal(lines[first + 1].trim(), description);
    assert.equal(lines[first + 2], "");
    assert.equal(lines[first + 3].trim(), "Another Specialist");
    assert.equal(lines[first + 4].trim(), "Different responsibility.");
  });
  await dialog(
    catalog(roles),
    (component) => {
      component.handleInput("\x1b[B");
      const lines = component.render(80).map(plain);
      const row = lines.findIndex((line) =>
        line.includes("› Another Specialist"),
      );
      assert.ok(row >= 0);
      assert.equal(lines[row + 1].trim(), "Different responsibility.");
      assert.ok(lines.length <= Math.floor(18 * 0.8));
    },
    role.id,
    18,
  );
});

test("hidden role IDs and categories remain searchable with normal Input handling", async () => {
  for (const query of [
    "hidden-debugger-id",
    "hidden-category",
    "software failures",
  ]) {
    const { value } = await dialog(catalog(), (component) => {
      for (const char of query) component.handleInput(char);
      assert.match(
        plain(component.render(100).join("\n")),
        /› Root Cause Debugger/,
      );
      component.handleInput("\r");
    });
    assert.equal(value, role.id, query);
  }
});

test("two-line role cards fit narrow widths and keep the selected role inside small overlays", async () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    ...role,
    id: `hidden-role-${i}`,
    name: `Specialist ${i}`,
    description: `Descrição ${i}: investigate failures without changing unrelated behavior.`,
  }));
  await dialog(
    catalog(many),
    (component) => {
      for (let i = 0; i < 12; i++) component.handleInput("\x1b[B");
      for (const width of [1, 10, 20, 40, 80, 140]) {
        const lines = component.render(width);
        assert.ok(lines.length <= Math.floor(14 * 0.8));
        for (const line of lines) assert.ok(visibleWidth(line) <= width);
      }
      const lines = component.render(80).map(plain);
      const row = lines.findIndex((line) => line.includes("› Specialist 12"));
      assert.ok(row >= 0);
      assert.match(lines[row + 1], /Descrição 12/);
    },
    many[0].id,
    14,
  );
});

test("RPC role labels hide internal metadata but selection maps to the correct ID", async () => {
  let labels;
  const value = await pickRole(
    {
      hasUI: true,
      mode: "rpc",
      ui: {
        async select(_title, choices) {
          labels = choices;
          return choices[1];
        },
      },
    },
    catalog(),
  );
  assert.equal(value, role.id);
  assert.equal(labels[1], `${role.name} — ${description}`);
  assert.doesNotMatch(
    labels.join("\n"),
    /hidden-debugger-id|hidden-category|\bUser\b/,
  );
});

test("delegation Default and None choices remain visible and return their selection modes", async () => {
  for (const offset of [0, 1]) {
    let rendered, result;
    const value = await pickRole(
      {
        hasUI: true,
        mode: "tui",
        ui: {
          async custom(factory) {
            const component = factory(
              { requestRender() {}, terminal: { rows: 40 } },
              theme,
              {},
              (v) => {
                result = v;
              },
            );
            rendered = plain(component.render(140).join("\n"));
            if (offset) component.handleInput("\x1b[B");
            component.handleInput("\r");
            return result;
          },
        },
      },
      catalog(),
      undefined,
      role.id,
      true,
    );
    assert.match(rendered, /Default — Root Cause Debugger/);
    assert.match(rendered, /Use this agent's configured role/);
    assert.match(rendered, /Ignore this agent's configured role/);
    assert.equal(value, offset ? "none" : "default");
  }
});
