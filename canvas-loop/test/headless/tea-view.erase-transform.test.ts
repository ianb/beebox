// @napi-rs/canvas 1.0.2 limits destination-out and source-in fills under a
// transform to the quadrant past the translation origin. These pin the
// workarounds (erase via a layer; gradient marks painted on a second layer).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Vec2 } from "../../src/core/paint.js";
import { teaView } from "../helpers.js";

const BLOB: Vec2[] = [
  [-50, -20],
  [0, -35],
  [50, -20],
  [55, 15],
  [0, 30],
  [-55, 15],
];
const shifted = BLOB.map(([x, y]): Vec2 => [x - 10, y - 8]);
const BLOB_FILL = { fill: "#333355" };

test("erase under a translate removes the whole shape, not one quadrant", () => {
  const { v, alpha } = teaView({ width: 200, height: 100 });
  v.background("#ffffff");
  v.at({ translate: [100, 50] }, () => {
    v.curve(BLOB, true, BLOB_FILL);
    v.curve(shifted, true, { ...BLOB_FILL, erase: true });
  });
  assert.equal(alpha(70, 45), 0, "up-left of the translation origin is erased too");
  assert.equal(alpha(148, 60), 255, "the crescent outside the erased shape remains");
});

test("erase inside a group under rotation and a clip (the gull drawer's case)", () => {
  const { v, rgba } = teaView({ width: 200, height: 100 });
  v.background("#ffffff");
  v.at({ translate: [100, 50], rotate: -0.12 }, () => {
    v.clip(v.curvePath(BLOB, true), () => {
      v.group({}, () => {
        v.curve(BLOB, true, BLOB_FILL);
        v.curve(shifted, true, { ...BLOB_FILL, erase: true });
      });
    });
  });
  // Erasing in a group removes only the group's pixels: the white background shows where it erased.
  assert.deepEqual(rgba(75, 45).slice(0, 3), [255, 255, 255], "erased up-left of the translation origin");
  assert.deepEqual(rgba(146, 58).slice(0, 3), [51, 51, 85], "the crescent remains");
});

test("erasing with a sprite under a translate removes its whole area", () => {
  const { v, alpha } = teaView({ width: 200, height: 100 });
  v.background("#ffffff");
  const square = v.sprite({ key: "sq", width: 40, height: 40 }, () => {
    v.rect(0, 0, 40, 40, { fill: "#000000" });
  });
  v.at({ translate: [100, 50] }, () => v.image(square, -30, -30, { erase: true }));
  assert.equal(alpha(75, 25), 0);
});

test("a gradient brushed mark under a translate is coloured along its whole length", () => {
  const { v, alpha } = teaView({ width: 200, height: 100 });
  v.at({ translate: [100, 50] }, () => {
    const ramp = v.linearGradient(-80, 0, 80, 0, [
      [0, "#ff0000"],
      [1, "#0000ff"],
    ]);
    v.line(-70, 0, 70, 0, { stroke: ramp, weight: 12, brush: "ink", gesture: { pressure: "even" } });
  });
  assert.equal(alpha(40, 50), 255, "left of the translation origin");
  assert.equal(alpha(160, 50), 255);
});
