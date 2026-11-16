// Starting params for a headless run (`teaRun`'s `initialParams`, fed
// by `bbx figure run --params` and card defaults): a value the browser would
// clamp or drop is an error here, so a run never reports success on a value
// the figure would not show. And reading a param the sketch does not declare
// is an error.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ParamsDecl } from "../../src/core/tea.js";
import { SketchUsageError } from "../../src/core/errors.js";
import { guardParams, startParams } from "../../src/headless/tea-runtime/guards.js";

const decl = {
  level: { type: "number", min: 0, max: 10, default: 2 },
  go: { type: "trigger" },
} as const satisfies ParamsDecl;

test("starting params: defaults, an in-range value, and each refusal", () => {
  assert.deepEqual(startParams(decl, {}), { level: 2 });
  assert.deepEqual(startParams(decl, { level: 10 }), { level: 10 });
  const refusal = (initial: Record<string, number | boolean | string>): string => {
    try {
      startParams(decl, initial);
      return "accepted";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
  assert.deepEqual([refusal({ level: 20 }), refusal({ level: "3" }), refusal({ go: "1" }), refusal({ lvl: 1 })], [
    'Sketch API misuse: initial param "level": refused, since it would be clamped 20 to the declared [0, 10]',
    'Sketch API misuse: initial param "level": "3" is not a number',
    'Sketch API misuse: initial param "go": a trigger param takes no value',
    'Sketch API misuse: initial param "lvl": the sketch declares no such param',
  ]);
});

test("reading an undeclared param is an error, including names an object inherits", () => {
  const p = guardParams({ size: { type: "number", min: 1, max: 10, default: 4 } }, { size: 4 });
  assert.equal(p["size"], 4);
  for (const name of ["speed", "toString", "valueOf", "constructor"]) {
    assert.throws(() => p[name], (e: unknown) => e instanceof SketchUsageError && e.message.includes(`params.${name}: the sketch declares no param`), name);
  }
  assert.deepEqual({ ...p }, { size: 4 }, "spreading reads only the declared values");
  assert.equal(JSON.stringify(p), '{"size":4}');
});
