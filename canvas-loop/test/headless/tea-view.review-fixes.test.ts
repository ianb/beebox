// Regressions from the cross-model branch review (2026-11-11), one per finding.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SketchUsageError } from "../../src/core/errors.js";
import { teaView } from "../helpers.js";

function makeView(size: { width: number; height: number }): ReturnType<typeof teaView> {
  return teaView(size, { seed: 42 });
}

function pixel(h: ReturnType<typeof teaView>, at: readonly [number, number]): [number, number, number, number] {
  const [r, g, b, a] = h.rgba(at[0], at[1]);
  return [r ?? 0, g ?? 0, b ?? 0, a ?? 0];
}

const SQUARE: [number, number][] = [
  [10, 10],
  [50, 10],
  [50, 50],
  [10, 50],
];

test("a one-shape union clip erases and blends exactly like the single-shape clip", () => {
  const draw = (asList: boolean): ReturnType<typeof teaView> => {
    const h = makeView({ width: 60, height: 60 });
    const { v } = h;
    v.background("#ffff00");
    const body = (): void => {
      v.rect(10, 10, 20, 40, { fill: "#00ffff", blend: "multiply" });
      v.rect(30, 10, 20, 40, { fill: "#00ffff", blend: "multiply", erase: true });
    };
    if (asList) v.clip([SQUARE], body);
    else v.clip(SQUARE, body);
    return h;
  };
  const single = draw(false);
  const list = draw(true);
  for (const at of [
    [20, 30],
    [40, 30],
    [55, 55],
  ] as const) {
    assert.deepEqual(pixel(list, at), pixel(single, at), `at ${at.join(",")}`);
  }
  assert.deepEqual(pixel(list, [20, 30]).slice(0, 3), [0, 255, 0], "multiply gave green");
  assert.equal(pixel(list, [40, 30])[3], 0, "erase removed the background");
});

test("a tube has round ends that extend past its end points", () => {
  const h = makeView({ width: 240, height: 100 });
  h.v.path(
    h.v.tube(
      [
        [20, 50],
        [220, 50],
      ],
      { width: 20 },
    ),
    { fill: "#000000" },
  );
  assert.equal(pixel(h, [13, 50])[3], 255, "start cap reaches past x=20");
  assert.equal(pixel(h, [227, 50])[3], 255, "end cap reaches past x=220");
  assert.equal(pixel(h, [21, 41])[3] > 0, true, "the side is not cut by a crossing cap");
});

test("a brushed arc follows Canvas2D's clockwise sweep when end < start", () => {
  const h = makeView({ width: 100, height: 100 });
  h.v.arc(50, 50, 30, Math.PI / 2, 0, { stroke: "#000000", weight: 4, brush: "ink", gesture: { pressure: "even" } });
  assert.ok(pixel(h, [20, 50])[3] > 0, "left (angle π) is on the clockwise three-quarter arc");
  assert.equal(pixel(h, [71, 71])[3], 0, "lower right (angle π/4) is not");
});

test("a path that starts with a line has no brush segment from the origin", () => {
  const h = makeView({ width: 120, height: 60 });
  h.v.path(
    [
      ["line", 50, 50],
      ["line", 100, 50],
    ],
    { stroke: "#000000", weight: 4, brush: "ink" },
  );
  assert.equal(pixel(h, [25, 25])[3], 0);
  assert.ok(pixel(h, [75, 50])[3] > 0);
});

test("a bristle mark shorter than one step still paints", () => {
  const h = makeView({ width: 60, height: 60 });
  h.v.line(30, 30, 31, 30, { stroke: "#000000", weight: 24, brush: "bristle", gesture: { pressure: 1 } });
  assert.ok(pixel(h, [30, 30])[3] > 0);
});

test("a thick bristle mark is not cropped by its layer", () => {
  const h = makeView({ width: 240, height: 240 });
  h.v.line(40, 120, 200, 120, {
    stroke: "#000000",
    weight: 40,
    brush: h.v.brushOf("bristle", { bristles: 1, spread: 1, grain: 0 }),
    gesture: { pressure: 1, seed: 2 },
  });
  const data = h.pixels();
  let lowest = 0;
  for (let y = 0; y < 240; y += 1) for (let x = 0; x < 240; x += 1) if ((data[(y * 240 + x) * 4 + 3] ?? 0) > 0) lowest = y;
  assert.ok(lowest > 162, `paint reaches y=${lowest}`);
});

test("a short tube keeps its two points", () => {
  const { v } = makeView({ width: 20, height: 20 });
  assert.doesNotThrow(() =>
    v.tube(
      [
        [5, 5],
        [6, 5],
      ],
      { width: 20 },
    ),
  );
});

test("an empty union clip leaves antialiased edge pixels alone", () => {
  const h = makeView({ width: 60, height: 60 });
  h.v.background("#ff0000");
  h.v.clip(
    [
      [
        [10.5, 10],
        [50, 10],
        [50, 50],
        [10.5, 50],
      ],
    ],
    () => {},
  );
  assert.deepEqual(pixel(h, [10, 30]), [255, 0, 0, 255]);
});

test("a brushed arc of minus one whole turn is a full circle", () => {
  const h = makeView({ width: 100, height: 100 });
  h.v.arc(50, 50, 30, 0, -2 * Math.PI, { stroke: "#000000", weight: 4, brush: "ink", gesture: { pressure: "even" } });
  assert.ok(pixel(h, [20, 50])[3] > 0, "the left side is drawn");
});

test("a tube shorter than 0.01 units still has an outline", () => {
  const { v } = makeView({ width: 20, height: 20 });
  assert.doesNotThrow(() =>
    v.tube(
      [
        [0, 0],
        [0.009, 0],
      ],
      { width: 0.02 },
    ),
  );
});

test("a group body that throws leaves no state behind", () => {
  const h = makeView({ width: 40, height: 40 });
  assert.throws(() => {
    h.v.group({}, () => {
      h.v.rect(0, 0, 40, 40, { fill: "#000000", erase: true });
      throw new SketchUsageError({ detail: "test" });
    });
  }, SketchUsageError);
  h.v.rect(0, 0, 40, 40, { fill: "#0000ff" });
  assert.deepEqual(pixel(h, [20, 20]), [0, 0, 255, 255], "the rect paints (the group's layer did not leak out)");
});
