// @napi-rs/canvas 1.0.2 limits destination-out and source-in fills under a
// transform to the quadrant past the translation origin. These pin the
// workarounds (erase via a layer; gradient marks painted on a second layer).
import assert from "node:assert/strict";
import { test } from "node:test";
import { Sketch } from "../../src/headless/sketch.js";
import type { Vec2 } from "../../src/core/paint.js";

function makeSketch(): Sketch {
  const s = new Sketch({ host: { recordLog(): void {}, requestSnapshot(): void {} }, seed: 1, fps: 60, onHandled: () => {} });
  s.createCanvas(200, 100);
  return s;
}

const alpha = (s: Sketch, at: readonly [number, number]): number => s.readPixels().data[(at[1] * 200 + at[0]) * 4 + 3] ?? 0;

const BLOB: Vec2[] = [
  [-50, -20],
  [0, -35],
  [50, -20],
  [55, 15],
  [0, 30],
  [-55, 15],
];
const shifted = BLOB.map(([x, y]): Vec2 => [x - 10, y - 8]);

test("erase under a translate removes the whole shape, not one quadrant", () => {
  const s = makeSketch();
  s.background("#ffffff");
  s.noStroke();
  s.translate(100, 50);
  s.fill("#333355");
  s.curve(BLOB, true);
  s.erase();
  s.curve(shifted, true);
  s.noErase();
  assert.equal(alpha(s, [70, 45]), 0, "up-left of the translation origin is erased too");
  assert.equal(alpha(s, [148, 60]), 255, "the crescent outside the erased shape remains");
});

test("erase inside a group under rotation and a clip (the gull drawer's case)", () => {
  const s = makeSketch();
  s.background("#ffffff");
  s.noStroke();
  s.translate(100, 50);
  s.rotate(-0.12);
  s.clip(s.curvePath(BLOB, true), () => {
    s.group({}, () => {
      s.fill("#333355");
      s.curve(BLOB, true);
      s.erase();
      s.curve(shifted, true);
    });
  });
  // Erasing in a group removes only the group's pixels: the white background shows where it erased.
  const rgb = (at: readonly [number, number]): number[] => [...s.readPixels().data.subarray((at[1] * 200 + at[0]) * 4, (at[1] * 200 + at[0]) * 4 + 3)];
  assert.deepEqual(rgb([75, 45]), [255, 255, 255], "erased up-left of the translation origin");
  assert.deepEqual(rgb([146, 58]), [51, 51, 85], "the crescent remains");
});

test("erasing with a sprite under a translate removes its whole area", () => {
  const s = makeSketch();
  s.background("#ffffff");
  const square = s.sprite({ key: "sq", width: 40, height: 40 }, () => {
    s.noStroke();
    s.fill("#000000");
    s.rect(0, 0, 40, 40);
  });
  s.translate(100, 50);
  s.erase();
  s.image(square, -30, -30);
  s.noErase();
  assert.equal(alpha(s, [75, 25]), 0);
});

test("a gradient brushed mark under a translate is coloured along its whole length", () => {
  const s = makeSketch();
  s.translate(100, 50);
  s.strokeWeight(12);
  s.brush("ink");
  s.gesture({ pressure: "even" });
  s.stroke(
    s.linearGradient(-80, 0, 80, 0, [
      [0, "#ff0000"],
      [1, "#0000ff"],
    ]),
  );
  s.line(-70, 0, 70, 0);
  assert.equal(alpha(s, [40, 50]), 255, "left of the translation origin");
  assert.equal(alpha(s, [160, 50]), 255);
});
