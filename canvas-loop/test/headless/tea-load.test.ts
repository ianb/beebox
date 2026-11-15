// The loader's `renderer` field: `export const renderer = "scene"` picks the
// scene surface; no export keeps the Canvas2D one. Any other value is an
// error, so a typo cannot run the sketch with the wrong View.
import assert from "node:assert/strict";
import { test } from "node:test";
import { toTeaModule } from "../../src/headless/tea-load.js";

test("the renderer export picks the surface; an unknown value is an error", () => {
  const base = { init: () => ({}), update: (m: object) => m, draw: () => {} };
  assert.equal(toTeaModule(base).renderer, undefined);
  assert.equal(toTeaModule({ ...base, renderer: "scene" }).renderer, "scene");
  assert.throws(() => toTeaModule({ ...base, renderer: "Scene" }), /export const renderer must be "scene" or absent; got "Scene"/u);
  assert.throws(() => toTeaModule({ ...base, renderer: true }), /export const renderer must be "scene" or absent; got true/u);
});
