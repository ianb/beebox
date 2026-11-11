// Regressions from the cross-model branch review (2026-11-11), one per finding.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SketchUsageError } from "../../src/core/errors.js";
import { Sketch } from "../../src/headless/sketch.js";

const NO_OP_HOST = { recordLog(): void {}, requestSnapshot(): void {} };

function makeSketch(size: { width: number; height: number }): Sketch {
  const s = new Sketch({ host: NO_OP_HOST, seed: 42, fps: 60, onHandled: () => {} });
  s.createCanvas(size.width, size.height);
  return s;
}

function pixel(s: Sketch, at: readonly [number, number]): [number, number, number, number] {
  const { data, width } = s.readPixels();
  const i = (at[1] * width + at[0]) * 4;
  return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, data[i + 3] ?? 0];
}

const SQUARE: [number, number][] = [
  [10, 10],
  [50, 10],
  [50, 50],
  [10, 50],
];

test("a one-shape union clip erases and blends exactly like the single-shape clip", () => {
  const draw = (asList: boolean): Sketch => {
    const s = makeSketch({ width: 60, height: 60 });
    s.background("#ffff00");
    s.noStroke();
    const body = (): void => {
      s.blendMode("multiply");
      s.fill("#00ffff");
      s.rect(10, 10, 20, 40);
      s.erase();
      s.rect(30, 10, 20, 40);
    };
    if (asList) s.clip([SQUARE], body);
    else s.clip(SQUARE, body);
    return s;
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
  const s = makeSketch({ width: 240, height: 100 });
  s.noStroke();
  s.fill("#000000");
  s.path(
    s.tube(
      [
        [20, 50],
        [220, 50],
      ],
      { width: 20 },
    ),
  );
  assert.equal(pixel(s, [13, 50])[3], 255, "start cap reaches past x=20");
  assert.equal(pixel(s, [227, 50])[3], 255, "end cap reaches past x=220");
  assert.equal(pixel(s, [21, 41])[3] > 0, true, "the side is not cut by a crossing cap");
});

test("a brushed arc follows Canvas2D's clockwise sweep when end < start", () => {
  const s = makeSketch({ width: 100, height: 100 });
  s.noFill();
  s.stroke("#000000");
  s.strokeWeight(4);
  s.brush("ink");
  s.gesture({ pressure: "even" });
  s.arc(50, 50, 30, Math.PI / 2, 0);
  assert.ok(pixel(s, [20, 50])[3] > 0, "left (angle π) is on the clockwise three-quarter arc");
  assert.equal(pixel(s, [71, 71])[3], 0, "lower right (angle π/4) is not");
});

test("a path that starts with a line has no brush segment from the origin", () => {
  const s = makeSketch({ width: 120, height: 60 });
  s.noFill();
  s.stroke("#000000");
  s.strokeWeight(4);
  s.brush("ink");
  s.path([
    ["line", 50, 50],
    ["line", 100, 50],
  ]);
  assert.equal(pixel(s, [25, 25])[3], 0);
  assert.ok(pixel(s, [75, 50])[3] > 0);
});

test("pop inside a single-shape clip cannot remove the clip's own scope", () => {
  const s = makeSketch({ width: 20, height: 20 });
  assert.throws(() => s.clip(SQUARE, () => s.pop()), SketchUsageError);
});

test("a bristle mark shorter than one step still paints", () => {
  const s = makeSketch({ width: 60, height: 60 });
  s.stroke("#000000");
  s.strokeWeight(24);
  s.brush("bristle");
  s.gesture({ pressure: 1 });
  s.line(30, 30, 31, 30);
  assert.ok(pixel(s, [30, 30])[3] > 0);
});

test("a thick bristle mark is not cropped by its layer", () => {
  const s = makeSketch({ width: 240, height: 240 });
  s.stroke("#000000");
  s.strokeWeight(40);
  s.brush("bristle", { bristles: 1, spread: 1, grain: 0 });
  s.gesture({ pressure: 1, seed: 2 });
  s.line(40, 120, 200, 120);
  const { data, width } = s.readPixels();
  let lowest = 0;
  for (let y = 0; y < 240; y += 1) for (let x = 0; x < width; x += 1) if ((data[(y * width + x) * 4 + 3] ?? 0) > 0) lowest = y;
  assert.ok(lowest > 162, `paint reaches y=${lowest}`);
});

test("a short tube keeps its two points", () => {
  const s = makeSketch({ width: 20, height: 20 });
  assert.doesNotThrow(() =>
    s.tube(
      [
        [5, 5],
        [6, 5],
      ],
      { width: 20 },
    ),
  );
});
