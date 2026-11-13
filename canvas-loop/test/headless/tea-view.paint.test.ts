import assert from "node:assert/strict";
import { test } from "node:test";
import type { Style } from "../../src/core/paint.js";
import { teaView } from "../helpers.js";
import type { TeaViewHarness } from "../helpers.js";

function makeView(size: { width: number; height: number }): TeaViewHarness {
  return teaView(size, { seed: 42 });
}

function pixel(h: TeaViewHarness, at: readonly [number, number]): [number, number, number, number] {
  const [r, g, b, a] = h.rgba(at[0], at[1]);
  return [r ?? 0, g ?? 0, b ?? 0, a ?? 0];
}

/** Distinct colours among the opaque-enough pixels, quantised to 16 levels a channel. */
function colours(h: TeaViewHarness): Set<string> {
  const data = h.pixels();
  const seen = new Set<string>();
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) < 200) continue;
    seen.add([data[i], data[i + 1], data[i + 2]].map((c) => (c ?? 0) >> 4).join(","));
  }
  return seen;
}

function stampMark(brush: NonNullable<Style["brush"]>): Uint8ClampedArray {
  const h = makeView({ width: 120, height: 40 });
  h.v.line(10, 20, 110, 20, { stroke: "#2e6b3a", weight: 16, brush });
  return h.pixels();
}

test("zero colour jitter paints exactly what the plain preset paints", () => {
  assert.deepEqual(stampMark({ preset: "chalk", hueJitter: 0, lightJitter: 0 }), stampMark("chalk"));
});

test("colour jitter gives a mark several colours, the same ones on every render", () => {
  const jittered = { preset: "chalk", hueJitter: 30, lightJitter: 0.2 } as const;
  const h = makeView({ width: 120, height: 40 });
  h.v.line(10, 20, 110, 20, { stroke: "#2e6b3a", weight: 16, brush: jittered });
  const plain = makeView({ width: 120, height: 40 });
  plain.v.line(10, 20, 110, 20, { stroke: "#2e6b3a", weight: 16, brush: "chalk" });
  assert.ok(colours(h).size > colours(plain).size + 3, `jittered ${colours(h).size} vs plain ${colours(plain).size}`);
  assert.deepEqual(stampMark(jittered), h.pixels());
});

test("colour variation and wet paint need a solid colour; smears cannot erase; ink has no jitter", () => {
  const h = makeView({ width: 60, height: 40 });
  const gradient = h.v.linearGradient(0, 0, 60, 0, [
    [0, "#ff0000"],
    [1, "#0000ff"],
  ]);
  assert.throws(() => h.v.line(5, 20, 55, 20, { stroke: gradient, weight: 8, brush: { preset: "bristle", lightJitter: 0.1 } }), /solid stroke colour/);
  assert.throws(() => h.v.line(5, 20, 55, 20, { stroke: gradient, weight: 8, brush: "wet" }), /solid stroke colour/);
  assert.throws(() => h.v.line(5, 20, 55, 20, { stroke: "#000", weight: 8, brush: "smudge", erase: true }), /cannot erase or blend/);
  assert.throws(() => h.v.line(5, 20, 55, 20, { stroke: "#000", weight: 8, brush: { preset: "ink", hueJitter: 10 } }), /does not apply to a ink brush/);
  assert.throws(() => h.v.line(5, 20, 55, 20, { stroke: "not-a-colour", weight: 8, brush: { preset: "pencil", lightJitter: 0.1 } }), /not a colour/);
});

test("a smudge drags red past the square's edge into white, and leaves the rest alone", () => {
  const h = makeView({ width: 120, height: 40 });
  h.v.background("#ffffff");
  h.v.rect(0, 0, 40, 40, { fill: "#cc0000" });
  h.v.line(20, 20, 100, 20, { stroke: "#000000", weight: 16, brush: "smudge" });
  const [r, g, b] = pixel(h, [52, 20]);
  assert.ok(r > g + 30 && r > b + 30, `dragged red at x=52: ${String([r, g, b])}`);
  assert.deepEqual(pixel(h, [60, 3]), [255, 255, 255, 255], "outside the brush's reach");
  assert.deepEqual(pixel(h, [10, 3]), [204, 0, 0, 255], "the square away from the stroke");
});

test("a group that contains a smudge still composites (the group layer is read while drawing)", () => {
  const h = makeView({ width: 120, height: 60 });
  h.v.background("#ffffff");
  h.v.at({ translate: [0, 0] }, () => {
    h.v.group({ opacity: 1 }, () => {
      h.v.circle(30, 30, 20, { fill: "#8e44ad" });
      h.v.line(30, 30, 90, 25, { stroke: "#000000", weight: 16, brush: "smudge" });
    });
  });
  const [r, g, b] = pixel(h, [24, 30]);
  assert.ok(Math.abs(r - 142) <= 4 && Math.abs(g - 68) <= 4 && Math.abs(b - 173) <= 4, `the circle is there: ${String([r, g, b])}`);
});

test("wet paint with all colour and no carry lays down the stroke colour", () => {
  const h = makeView({ width: 120, height: 40 });
  h.v.background("#ffffff");
  h.v.line(10, 20, 110, 20, { stroke: "#2c5aa0", weight: 16, brush: { preset: "wet", color: 1, strength: 0, grain: 0, flow: 1, opacityByPressure: 0 }, gesture: { pressure: "even" } });
  const [r, g, b] = pixel(h, [60, 20]);
  assert.ok(Math.abs(r - 0x2c) <= 3 && Math.abs(g - 0x5a) <= 3 && Math.abs(b - 0xa0) <= 3, `got ${String([r, g, b])}`);
});

test("jitter reads any CSS colour: a name, short hex and hsl()", () => {
  for (const stroke of ["tomato", "#c63", "hsl(120 40% 40%)"]) {
    const h = makeView({ width: 60, height: 30 });
    h.v.line(5, 15, 55, 15, { stroke, weight: 10, brush: { preset: "chalk", lightJitter: 0.1 } });
    assert.ok(colours(h).size > 0, stroke);
  }
});

test("a translucent colour with jitter lands about as strong as without it", () => {
  const strength = (brush: NonNullable<Style["brush"]>): number => {
    const h = makeView({ width: 120, height: 40 });
    h.v.line(10, 20, 110, 20, { stroke: "rgba(46, 107, 58, 0.4)", weight: 16, brush, gesture: { pressure: "even" } });
    return pixel(h, [60, 20])[3];
  };
  const plain = strength("airbrush");
  const jittered = strength({ preset: "airbrush", lightJitter: 0.05 });
  assert.ok(Math.abs(plain - jittered) <= 8, `plain ${plain}, jittered ${jittered}`);
});

test("a one-dab wet mark paints; a wet colour the runtime cannot read is an error", () => {
  const h = makeView({ width: 40, height: 40 });
  h.v.background("#ffffff");
  h.v.line(20, 20, 20.1, 20, { stroke: "#2c5aa0", weight: 16, brush: { preset: "wet", color: 1 } });
  assert.notDeepEqual(pixel(h, [20, 20]), [255, 255, 255, 255]);
  assert.throws(() => h.v.line(5, 20, 35, 20, { stroke: "not-a-colour", weight: 8, brush: "wet" }), /not a colour/);
});

test("a smudge with no carry leaves translucent paint as translucent as it was", () => {
  const h = makeView({ width: 120, height: 40 });
  h.v.group({ opacity: 1 }, () => {
    h.v.rect(0, 0, 120, 40, { fill: "rgba(200, 0, 0, 0.2)" });
    h.v.line(10, 20, 110, 20, { stroke: "#000", weight: 16, brush: { preset: "smudge", strength: 0, grain: 0 } });
  });
  const a = pixel(h, [60, 20])[3];
  assert.ok(Math.abs(a - 51) <= 3, `alpha ${a}, was 51`);
});
