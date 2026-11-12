// Group effects, soft masks, the added blend modes, and tween/ease (the klad
// gaps that Canvas2D already provides; plan:
// beebox/docs/implemented-plans/canvas-brushes-effects.subplan.md).
import assert from "node:assert/strict";
import { test } from "node:test";
import { teaView } from "../helpers.js";

test("blend add sums light; difference and the hue family are accepted", () => {
  const { v, rgba } = teaView({ width: 40, height: 20 });
  v.background("#006400");
  v.rect(0, 0, 20, 20, { fill: "#c80000", blend: "add" });
  assert.deepEqual(rgba(5, 5), [200, 100, 0, 255]);
  v.rect(20, 0, 20, 20, { fill: "#ffffff", blend: "difference" });
  assert.deepEqual(rgba(25, 5), [255, 155, 255, 255]);
  for (const blend of ["exclusion", "hue", "saturation", "color", "luminosity"] as const) v.rect(0, 0, 1, 1, { fill: "#808080", blend });
});

test("an unknown blend name is an error, not a silent normal blend", () => {
  const { v } = teaView({ width: 20, height: 20 });
  // @ts-expect-error -- a name a CSS habit might suggest; the runtime must refuse it
  assert.throws(() => v.rect(0, 0, 5, 5, { fill: "#000", blend: "plus-lighter" }), /blend "plus-lighter" is not one of: normal, multiply/);
});

test("blur softens a hard edge; without it the edge is sharp", () => {
  const sharp = teaView({ width: 60, height: 40 });
  sharp.v.group({}, () => sharp.v.rect(20, 10, 20, 20, { fill: "#000000" }));
  assert.equal(sharp.alpha(17, 20), 0);
  const soft = teaView({ width: 60, height: 40 });
  soft.v.group({ effects: { blur: 4 } }, () => soft.v.rect(20, 10, 20, 20, { fill: "#000000" }));
  const outside = soft.alpha(17, 20);
  assert.ok(outside > 20 && outside < 200, `3px outside the edge is partly covered, got ${outside}`);
});

test("shadow draws the group's shape offset in its colour, beneath it", () => {
  const { v, rgba } = teaView({ width: 60, height: 40 });
  v.background("#ffffff");
  v.group({ effects: { shadow: { x: 6, y: 6, color: "#0000ff" } } }, () => v.rect(10, 10, 20, 20, { fill: "#ff0000" }));
  assert.deepEqual(rgba(20, 20), [255, 0, 0, 255], "the shape stays on top");
  assert.deepEqual(rgba(33, 33), [0, 0, 255, 255], "the shadow shows past its corner");
});

test("glow is a halo in its colour around the shape", () => {
  const { v, rgba } = teaView({ width: 60, height: 40 });
  v.background("#000000");
  v.group({ effects: { glow: { blur: 6, color: "#ffff00" } } }, () => v.rect(20, 10, 20, 20, { fill: "#ffffff" }));
  const [r, g, b] = rgba(17, 20);
  assert.ok(r !== undefined && g !== undefined && b !== undefined && r > 30 && g > 30 && b < 10, `yellow halo outside the edge, got ${String([r, g, b])}`);
});

test("colour adjustments: grayscale makes red grey; hue rotates it", () => {
  const grey = teaView({ width: 20, height: 20 });
  grey.v.group({ effects: { grayscale: 1 } }, () => grey.v.rect(0, 0, 20, 20, { fill: "#ff0000" }));
  const [r, g, b] = grey.rgba(5, 5);
  assert.ok(r === g && g === b, `grey, got ${String([r, g, b])}`);
  const hue = teaView({ width: 20, height: 20 });
  hue.v.group({ effects: { hue: 120 } }, () => hue.v.rect(0, 0, 20, 20, { fill: "#ff0000" }));
  const [hr, hg] = hue.rgba(5, 5);
  assert.ok(hr !== undefined && hg !== undefined && hg > hr, `red turned green, got ${String(hue.rgba(5, 5))}`);
});

test("bad effects name the valid shape before anything is drawn", () => {
  const { v, alpha } = teaView({ width: 20, height: 20 });
  // @ts-expect-error -- unknown key
  assert.throws(() => v.group({ effects: { dropShadow: 2 } }, () => v.rect(0, 0, 20, 20, { fill: "#000" })), /unknown effect "dropShadow" \(hue, saturation/);
  // @ts-expect-error -- a CSS string where an object belongs
  assert.throws(() => v.group({ effects: { shadow: "2px 2px black" } }, () => {}), /shadow must be { x\?, y\?, blur\?, color }/);
  assert.throws(() => v.group({ effects: { blur: -1 } }, () => {}), /blur must be a number ≥ 0, got -1/);
  assert.throws(() => v.group({ effects: { grayscale: 2 } }, () => {}), /grayscale must be a number in 0\.\.1, got 2/);
  assert.equal(alpha(5, 5), 0, "the failed group drew nothing");
});

test("mask keeps the body in proportion to the mask's alpha", () => {
  const { v, alpha } = teaView({ width: 100, height: 20 });
  const fade = v.linearGradient(0, 0, 100, 0, [
    [0, "rgba(0,0,0,0)"],
    [1, "rgba(0,0,0,1)"],
  ]);
  v.mask(
    () => v.rect(0, 0, 100, 20, { fill: fade }),
    () => v.rect(0, 0, 100, 20, { fill: "#ff0000" }),
  );
  assert.ok(alpha(2, 10) < 15, `faded out at the left, got ${alpha(2, 10)}`);
  assert.ok(Math.abs(alpha(50, 10) - 128) < 12, `half at the middle, got ${alpha(50, 10)}`);
  assert.ok(alpha(97, 10) > 240, `full at the right, got ${alpha(97, 10)}`);
});

test("tween interpolates between keyframes, holds outside them, and eases within a span", () => {
  const { v } = teaView({ width: 10, height: 10 });
  const keys = [
    [0, 10],
    [10, 30],
    [20, 30],
    [30, 0],
  ] as const;
  assert.deepEqual([-5, 0, 5, 10, 15, 25, 30, 99].map((t) => v.tween(keys, t)), [10, 10, 20, 30, 30, 15, 0, 0]);
  assert.equal(v.tween([[0, 0], [10, 100]], 5, "in"), 12.5);
  assert.equal(v.tween([[0, 0], [10, 100]], 5, "out"), 87.5);
  assert.ok(v.tween([[0, 0], [10, 100]], 8, "out-back") > 100, "out-back overshoots before settling");
  assert.deepEqual(v.tweenPoint([[0, [0, 100]], [10, [50, 0]]], 5), [25, 50]);
  assert.equal(v.ease("in-out", 0.5), 0.5);
  assert.equal(v.ease("in", 2), 1, "u is clamped");
});

test("tween refuses keyframes out of order or of mixed shapes", () => {
  const { v } = teaView({ width: 10, height: 10 });
  assert.throws(() => v.tween([[10, 0], [0, 1]], 5), /keyframe times must be in order/);
  assert.throws(() => v.tweenPoint([[0, [0, 0]], [10, [1]]], 5), /keyframe 1's value has a different shape/);
  // @ts-expect-error -- not an ease name
  assert.throws(() => v.tween([[0, 0], [1, 1]], 0.5, "bounce"), /ease "bounce" is not one of: linear, step, in, out, in-out, out-back/);
});

test("step holds then jumps; a keyframe's own ease applies to the span it starts", () => {
  const { v } = teaView({ width: 10, height: 10 });
  assert.deepEqual([0, 5, 9.9, 10].map((t) => v.tween([[0, 0], [10, 100]], t, "step")), [0, 0, 0, 100]);
  const keys = [
    [0, 0, "in"],
    [10, 100],
    [20, 0],
  ] as const;
  assert.deepEqual([5, 15].map((t) => v.tween(keys, t)), [12.5, 50], "first span eased in, second linear");
  // @ts-expect-error -- not an ease name
  assert.throws(() => v.tween([[0, 0, "wobble"], [1, 1]], 0.5), /ease "wobble" is not one of/);
});

test("shadow and glow refuse keys they don't have", () => {
  const { v } = teaView({ width: 20, height: 20 });
  // @ts-expect-error -- `offset` is CSS habit; the shadow takes x and y
  assert.throws(() => v.group({ effects: { shadow: { offset: 2, color: "#000" } } }, () => {}), /shadow has no "offset" \(x, y, blur, color\)/);
});

test("a group or mask whose body throws leaves the pool and the canvas usable", () => {
  const { v, alpha } = teaView({ width: 20, height: 20 });
  assert.throws(() => v.mask(() => {}, () => { throw new Error("boom"); }), /boom/);
  assert.throws(() => v.group({}, () => { throw new Error("bang"); }), /bang/);
  v.group({}, () => v.rect(0, 0, 10, 10, { fill: "#000000" }));
  assert.deepEqual([alpha(5, 5), alpha(15, 15)], [255, 0], "later groups draw only their own pixels");
});

test("erase inside a mask removes only the mask body's pixels, as in a group", () => {
  const { v, rgba } = teaView({ width: 20, height: 20 });
  v.background("#00ff00");
  v.mask(
    () => v.rect(0, 0, 20, 20, { fill: "#000000" }),
    () => {
      v.rect(0, 0, 20, 20, { fill: "#ff0000" });
      v.rect(0, 0, 10, 20, { fill: "#000000", erase: true });
    },
  );
  assert.deepEqual([rgba(5, 5), rgba(15, 5)], [[0, 255, 0, 255], [255, 0, 0, 255]]);
});

test("glow and group opacity apply once, together", () => {
  const { v, alpha } = teaView({ width: 40, height: 20 });
  v.group({ opacity: 0.5, effects: { glow: { blur: 0, color: "#ffffff", strength: 1 } } }, () => v.rect(10, 5, 10, 10, { fill: "#000000" }));
  assert.equal(alpha(15, 10), 128, "where halo and shape overlap, still one 0.5");
});

test("a bad blend is refused on erase paths and before a cache stores anything", () => {
  const { v, alpha } = teaView({ width: 20, height: 20 });
  // @ts-expect-error -- not a blend
  assert.throws(() => v.rect(0, 0, 5, 5, { fill: "#000", erase: true, blend: "plus-lighter" }), /blend "plus-lighter"/);
  // @ts-expect-error -- not a blend
  assert.throws(() => v.cache("k", () => v.rect(0, 0, 20, 20, { fill: "#000000" }), { blend: "nope" }), /blend "nope"/);
  v.cache("k", () => v.rect(0, 0, 5, 5, { fill: "#000000" }));
  assert.deepEqual([alpha(2, 2), alpha(10, 10)], [255, 0], "the second call's body was drawn, not the refused one");
});

test("a jump between two keyframes at one time lands on that time", () => {
  const { v } = teaView({ width: 10, height: 10 });
  const keys = [
    [0, 0],
    [10, 0],
    [10, 100],
    [20, 100],
  ] as const;
  assert.deepEqual([9, 10, 11].map((t) => v.tween(keys, t)), [0, 100, 100]);
  assert.equal(v.tween([[5, 42]], 0), 42, "one keyframe holds its value");
});
