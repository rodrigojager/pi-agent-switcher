import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
import { visibleWidth } from "@earendil-works/pi-tui";
const jiti = createJiti(import.meta.url, { fsCache: false });
const { AgentPicker, filterItems } = await jiti.import("../picker.ts");
const items = [
  {
    name: "scout",
    value: "scout",
    description: "Find source files and collect evidence",
  },
  {
    name: "reviewer",
    value: "reviewer",
    description: "Revisão e análise de qualidade",
  },
  {
    name: "builder-3d",
    value: "builder-3d",
    description: "Create and validate 3D assets",
  },
];
const theme = {
  fg: (_color, text) => text,
  bold: (text) => "\x1b[1m" + text + "\x1b[22m",
};
function picker() {
  let result;
  const component = new AgentPicker(
    items,
    "scout",
    "Switch main agent",
    { requestRender() {} },
    theme,
    (value) => {
      result = value;
    },
  );
  return { component, result: () => result };
}
test("name and description search supports accents, multiple words and digits", () => {
  assert.deepEqual(
    filterItems(items, "revisao qualidade").map((a) => a.name),
    ["reviewer"],
  );
  assert.deepEqual(
    filterItems(items, "3d").map((a) => a.name),
    ["builder-3d"],
  );
  assert.deepEqual(
    filterItems(items, "files").map((a) => a.name),
    ["scout"],
  );
});
test("typing, deletion, empty results and Enter select the visible result", () => {
  const { component, result } = picker();
  for (const char of "reviewerx") component.handleInput(char);
  assert.match(component.render(100).join("\n"), /No matching agents/);
  component.handleInput("\r");
  assert.equal(result(), undefined);
  component.handleInput("\x7f");
  const rendered = component.render(100).join("\n");
  assert.ok(rendered.includes("\x1b[1mreviewer\x1b[22m"));
  assert.ok(!rendered.includes("Find source"));
  component.handleInput("\r");
  assert.equal(result(), "reviewer");
});
test("digits filter instead of selecting accidentally; arrows and Escape work", () => {
  const { component, result } = picker();
  component.handleInput("3");
  assert.equal(result(), undefined);
  assert.match(component.render(80).join("\n"), /builder-3d/);
  component.handleInput("\x1b");
  assert.equal(result(), null);
  const next = picker();
  next.component.handleInput("\x1b[B");
  next.component.handleInput("\r");
  assert.equal(next.result(), "reviewer");
});
test("focus reaches Input and rendered lines fit narrow and wide terminals", () => {
  const { component } = picker();
  component.focused = true;
  assert.equal(component.input.focused, true);
  component.focused = false;
  assert.equal(component.input.focused, false);
  for (const width of [1, 10, 20, 40, 80, 140])
    for (const line of component.render(width))
      assert.ok(visibleWidth(line) <= width, `width ${width}: ${line}`);
});
test("small viewport keeps the selected agent visible while navigating", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    name: `agent-${i}`,
    value: `agent-${i}`,
    description: `Task ${i}`,
  }));
  const component = new AgentPicker(
    many,
    "agent-0",
    "Agents",
    { requestRender() {}, terminal: { rows: 14 } },
    theme,
    () => {},
  );
  for (let i = 0; i < 12; i++) component.handleInput("\x1b[B");
  const rendered = component.render(40);
  assert.ok(rendered.slice(0, 11).join("\n").includes("\x1b[1magent-12"));
});
