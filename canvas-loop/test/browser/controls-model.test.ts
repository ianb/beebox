import assert from "node:assert/strict";
import { test } from "node:test";
import { controlModels, parseField } from "../../src/browser/controls-model.js";
import type { ParamsDecl } from "../../src/core/tea.js";
import { toTeaModule } from "../../src/headless/tea-load.js";

const decl = {
  coefficient: { type: "number", min: 1, max: 12, step: 1, default: 1, control: "field" },
  temperature: { type: "number", min: 0, max: 100, default: 20 },
} as const satisfies ParamsDecl;

test("a number param shows as a field only when it asks to", () => {
  const [field, slider] = controlModels({ decl, values: {} });
  assert.equal(field?.kind === "number" ? field.control : undefined, "field");
  assert.equal(slider?.kind === "number" ? slider.control : undefined, "slider");
});

test("a field sends only valid, in-range values (whole numbers for a step of 1)", () => {
  const [model] = controlModels({ decl, values: {} });
  if (model?.kind !== "number") throw new TypeError("expected a number control");
  assert.equal(parseField("3", model), 3);
  assert.equal(parseField(" 12 ", model), 12);
  for (const bad of ["", "abc", "0", "13", "2.5"]) assert.equal(parseField(bad, model), undefined, JSON.stringify(bad));
});

test("loading a module keeps a number param's control (the path mountSketch takes)", () => {
  const loaded = toTeaModule({ params: decl, init: () => ({}), update: (m: unknown) => m, draw: () => {} });
  const [field] = controlModels({ decl: loaded.params ?? {}, values: {} });
  assert.equal(field?.kind === "number" ? field.control : undefined, "field");
  assert.throws(() => toTeaModule({ params: { x: { type: "number", min: 0, max: 1, default: 0, control: "knob" } }, init: () => ({}), update: (m: unknown) => m, draw: () => {} }), /"control" must be/);
});
