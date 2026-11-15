// Starting params for a headless scene run (`runSpike`'s `initialParams`, fed
// by `bbx figure run --params` and card defaults): a value the browser would
// clamp or drop is an error here, so a run never reports success on a value
// the figure would not show.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ParamsDecl } from "../../src/core/tea.js";
import { sceneArgs, startParams } from "../../src/scene-spike/run/runner.js";

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

test("--scene alone outlines every captured frame; --scene first only the first", () => {
  assert.deepEqual(sceneArgs(["s.ts", "--scene", "--frames", "4"]), ["s.ts", "--scene=all", "--frames", "4"]);
  assert.deepEqual(sceneArgs(["s.ts", "--scene", "first", "--frames", "4"]), ["s.ts", "--scene=first", "--frames", "4"]);
});
