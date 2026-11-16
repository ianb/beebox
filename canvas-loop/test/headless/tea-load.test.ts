// The loader ignores a `renderer` export: it was the marker of the move to the
// scene renderer, and a figure written then still exports it. Every sketch
// draws on the scene renderer.
import assert from "node:assert/strict";
import { test } from "node:test";
import { toTeaModule } from "../../src/headless/tea-load.js";

test("a renderer export, whatever its value, is ignored", () => {
  const base = { init: () => ({}), update: (m: object) => m, draw: () => {} };
  for (const renderer of ["scene", "Scene", true]) assert.deepEqual(Object.keys(toTeaModule({ ...base, renderer })), Object.keys(toTeaModule(base)));
});
