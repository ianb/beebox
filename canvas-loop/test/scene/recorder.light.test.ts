// Chunk 4 in the recorder: painterly effect options, lit groups, lights and
// materials checked at the call (R8), the paper `effects.paper` uses (R9),
// the R8 warnings, and `v.noise` (draft 2.3 section 15).
import assert from "node:assert/strict";
import { test } from "node:test";
import { SketchUsageError } from "../../src/core/errors.js";
import type { View } from "../../src/scene/api.js";
import { sceneOutline } from "../../src/scene/outline.js";
import { valueNoise } from "../../src/scene/recorder/noise.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";

const usage = (message: RegExp) => (e: unknown): boolean => e instanceof SketchUsageError && message.test(e.message);
const record = (draw: (v: View) => void): ReturnType<SceneRecorder["record"]> => new SceneRecorder({ width: 100, height: 80 }).record(draw);

test("painterly effects, lighting, lights and materials are checked at the call", () => {
  const cases: [RegExp, (v: View) => void][] = [
    // @ts-expect-error -- a key Wash does not have
    [/effects.wash: no "wet"/, (v) => v.group({ effects: { wash: { wet: 1 } } }, () => {})],
    [/effects.wash.granulate: must be a number in 0..1/, (v) => v.group({ effects: { wash: { granulate: 2 } } }, () => {})],
    // @ts-expect-error -- amount is required
    [/effects.hatching.amount: must be a number in 0..1/, (v) => v.group({ effects: { hatching: {} } }, () => {})],
    [/effects.hatching.spacing: must be a number ≥ 0.5/, (v) => v.rect(0, 0, 1, 1, { fill: "#000", effects: { hatching: { amount: 1, spacing: 0 } } })],
    [/effects.paper: must be a number in 0..1/, (v) => v.group({ effects: { paper: -1 } }, () => {})],
    // @ts-expect-error -- not a shadow kind
    [/lighting.shadows: must be none, hard or soft/, (v) => v.group({ lighting: { shadows: "deep" } }, () => {})],
    // @ts-expect-error -- castsShadow is a boolean or a height
    [/material.castsShadow: must be a number in 0..1024/, (v) => v.rect(0, 0, 1, 1, { fill: "#000", material: { castsShadow: "tall" } })],
    [/material.castsShadow: must be a number in 0..1024/, (v) => v.rect(0, 0, 1, 1, { fill: "#000", material: { castsShadow: 2000 } })],
    [/lighting.exposure: must be a number in -16..16/, (v) => v.group({ lighting: { exposure: Number.NaN } }, () => {})],
    [/lighting.toneCurve: must be a number in 0..1/, (v) => v.group({ lighting: { toneCurve: 1.5 } }, () => {})],
    [/material.relief: must be a number in 0..1/, (v) => v.place(v.picture({ key: "p", width: 1, height: 1 }, () => {}), 0, 0, { material: { relief: 3 } })],
    // @ts-expect-error -- not a light kind
    [/light kind: must be point, spot or directional/, (v) => v.light({ kind: "area", at: [0, 0] })],
    [/light \(point\): needs at/, (v) => v.light({ kind: "point" })],
    [/light cone: must be a number in 0.000001..3.14/, (v) => v.light({ kind: "spot", at: [0, 0], cone: 4 })],
    [/noise takes finite numbers/, (v) => v.noise(Number.NaN)],
  ];
  for (const [message, draw] of cases) assert.throws(() => record(draw), usage(message), String(message));
  assert.doesNotThrow(() => record((v) => v.group({ lighting: {} }, () => v.light({ kind: "spot", at: [0, 0], cone: Math.PI }))), "a full-angle cone is allowed");
});

test("a lit group, its lights and materials are recorded with their defaults; outlines show them", () => {
  const { scene, warnings } = record((v) => {
    v.group({ lighting: {}, name: "room" }, () => {
      v.rect(0, 0, 10, 10, { fill: "#888", material: { bevel: 4, castsShadow: true } });
      v.at({ translate: [5, 0] }, () => v.light({ kind: "spot", at: [1, 2] }));
    });
  });
  assert.deepEqual(warnings, []);
  const [g] = scene.children;
  assert.ok(g?.kind === "group");
  assert.deepEqual(g.lighting, { ambient: "#4d4d4d", shadows: "soft", exposure: 0, toneCurve: 0 });
  const [shape, at] = g.children;
  assert.ok(shape?.kind === "shape");
  assert.deepEqual(shape.style.material, { bevel: 4, castsShadow: true });
  assert.ok(at?.kind === "at" && at.children[0]?.kind === "light");
  assert.deepEqual(at.children[0].light, { kind: "spot", at: [1, 2], height: 80, color: "#ffffff", energy: 1, reach: 400, direction: Math.PI / 2, cone: Math.PI / 6 });
  const outline = sceneOutline(scene);
  assert.match(outline, /group "room" opacity 1 blend normal lit ambient #4d4d4d shadows soft/);
  assert.match(outline, /rect \(0,0\) 10×10 fill #888 stroke none material bevel,castsShadow/);
  assert.match(outline, /light spot at \(1,2\) height 80 #f{6} energy 1/);
});

test("effects.paper uses the paper at the end of the group's body; a shape's, the paper at its call (R9)", () => {
  const { scene } = record((v) => {
    v.paper({ seed: 3 });
    v.group({ effects: { paper: 1 } }, () => v.paper({ seed: 9 }));
    v.rect(0, 0, 1, 1, { fill: "#000", effects: { wash: {} } });
  });
  const [g, r] = scene.children;
  assert.ok(g?.kind === "group" && r?.kind === "shape");
  assert.equal(g.paper.seed, 9);
  assert.equal(r.style.effectsPaper?.seed, 3, "the group's paper ended with it");
});

test("a light outside any lit group, or in a mask's artwork, warns; a picture's light warns where it is placed unlit", () => {
  const lamp = (v: View): ReturnType<View["picture"]> => v.picture({ key: "lamp", width: 10, height: 10 }, () => v.light({ kind: "point", at: [5, 5] }));
  assert.match(record((v) => v.light({ kind: "point", at: [1, 2] })).warnings.join("\n"), /light point at \(1,2\) is outside any lit group and does nothing/);
  assert.match(record((v) => v.group({ lighting: {} }, () => v.mask(() => v.light({ kind: "directional" }), () => {}))).warnings.join("\n"), /inside a mask's artwork and does nothing/);
  assert.deepEqual(record((v) => v.group({ lighting: {} }, () => v.group({}, () => v.light({ kind: "point", at: [0, 0] })))).warnings, [], "any depth inside a lit group");
  assert.deepEqual(record((v) => lamp(v)).warnings, [], "a light in a picture body warns only where the picture is placed");
  assert.match(record((v) => v.place(lamp(v), 0, 0)).warnings.join("\n"), /place picture "lamp": its light is outside any lit group/);
  assert.deepEqual(record((v) => v.group({ lighting: {} }, () => v.place(lamp(v), 0, 0))).warnings, []);
  assert.match(record((v) => v.group({ lighting: {} }, () => v.mask(() => v.place(lamp(v), 0, 0), () => {}))).warnings.join("\n"), /place picture "lamp": its light is inside a mask's artwork/);
  const ownLit = (v: View): void => v.place(v.picture({ key: "lit", width: 1, height: 1 }, () => v.group({ lighting: {} }, () => v.light({ kind: "point", at: [0, 0] }))), 0, 0);
  assert.deepEqual(record(ownLit).warnings, [], "a picture's own lit group keeps its light");
});

test("noise is seeded value noise in 0..1: deterministic, smooth, seeded by the run's seed", () => {
  const at = (seed: number, xyz: readonly [number, number?, number?]): number => new SceneRecorder({ width: 1, height: 1 }, { seed }).record((v) => v.log(v.noise(...xyz))).logs.map(Number)[0] ?? Number.NaN;
  assert.equal(at(42, [1.3, 2.7, 0.5]), at(42, [1.3, 2.7, 0.5]), "same seed, same value");
  assert.notEqual(at(42, [1.3, 2.7]), at(43, [1.3, 2.7]), "another seed, another value");
  assert.equal(at(42, [1.3]), at(42, [1.3, 0, 0]), "y and z default to 0");
  let lo = 1;
  let hi = 0;
  let jump = 0;
  for (let i = 0; i < 4000; i++) {
    const x = i * 0.037 - 50;
    const y = Math.sin(i) * 30;
    const n = valueNoise(7, { x, y, z: i % 5 });
    lo = Math.min(lo, n);
    hi = Math.max(hi, n);
    jump = Math.max(jump, Math.abs(valueNoise(7, { x: x + 1e-3, y, z: i % 5 }) - n));
  }
  assert.ok(lo >= 0 && hi < 1, `range [${lo}, ${hi}] inside [0, 1)`);
  assert.ok(lo < 0.25 && hi > 0.75, `it spans most of the range [${lo}, ${hi}]`);
  assert.ok(jump < 0.02, `a step of 0.001 changes it a little (largest change ${jump})`);
  // Integer hashing only, so these hold in every JavaScript runtime; pinned to catch a change.
  assert.deepEqual([valueNoise(42, { x: 0.5, y: 0.25, z: 0 }), valueNoise(1, { x: -3.75, y: 12.5, z: 2 })].map((v) => v.toFixed(12)), PINNED);
});

const PINNED = ["0.507570817143", "0.777153634777"];
