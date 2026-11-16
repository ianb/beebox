// Pictures on the GPU, run by renderer.gpu.test.ts: placement replays the recording
// under the placement transform (R7), placement options, and `pixels` images.
import assert from "node:assert/strict";
import type { Drawing, View } from "../../src/core/tea.js";
import type { GpuHandle } from "../../src/device/open.js";
import { alphaAt, renderOnce, rgbaAt } from "./render.js";
import { matrixOf, mul } from "../../src/scene/mat.js";

function body(v: View): Drawing {
  return [
    v.rect(0, 0, 60, 40, { fill: "#cfe0ea", stroke: "#1d3557", weight: 2 }),
    v.circle(30, 20, 12, { fill: "rgba(230,57,70,0.8)" }),
    // Ink has no grain: a grainy brush would differ, its paper being the picture's coordinates (R9).
    v.curve([[5, 35], [30, 8], [55, 35]], false, { stroke: "#2b2b2b", weight: 4, brush: "ink" }),
    v.group({ effects: { blur: 2 } }, v.rect(40, 5, 10, 10, { fill: "#000" })),
  ];
}

/**
 * Draft 2.6: a placement's device translation snaps to whole device pixels
 * (rotation and scale unchanged); a group does not snap. So a placement draws
 * what the body draws in a group moved by the snap, within one level (the same
 * numbers summed in raster space), and at a sub-pixel position it is not the
 * unsnapped group.
 */
export async function placementReplays(handle: GpuHandle): Promise<void> {
  const size = { width: 200, height: 120 };
  const cases = [
    { at: { translate: [30, 20] as const, scale: [2, 1] as const }, within: 0 },
    { at: { translate: [80, 10] as const, rotate: 0.4 }, within: 1 },
    { at: { translate: [80.3, 10.7] as const }, within: 1 },
  ];
  for (const { at, within } of cases) {
    const m = mul(matrixOf(at), matrixOf({ translate: [5, 7] }));
    const snap: [number, number] = [Math.round(m[4]) - m[4], Math.round(m[5]) - m[5]];
    const placed = await renderOnce(handle, { size, draw: (v) => v.at(at, v.place(v.picture({ key: "p", width: 60, height: 40 }, () => body(v)), 5, 7)) });
    const group = (shift: readonly [number, number]) => (v: View): Drawing => v.at({ translate: shift }, v.at(at, v.at({ translate: [5, 7] }, v.group({}, body(v)))));
    const snapped = await renderOnce(handle, { size, draw: group(snap) });
    const most = maxDiff(placed.data, snapped.data);
    assert.ok(most <= within, `placing under ${JSON.stringify(at)} draws what the body draws in a group at the snapped position, within ${within} (largest difference ${most})`);
    if (snap[0] !== 0 || snap[1] !== 0) {
      const unsnapped = await renderOnce(handle, { size, draw: group([0, 0]) });
      assert.ok(maxDiff(placed.data, unsnapped.data) > 8, `under ${JSON.stringify(at)} the placement snaps and the group does not`);
    }
  }
}

function maxDiff(a: Uint8Array, b: Uint8Array): number {
  let most = 0;
  for (const [i, x] of a.entries()) most = Math.max(most, Math.abs(x - (b[i] ?? 0)));
  return most;
}

export async function placeOptions(handle: GpuHandle): Promise<void> {
  const size = { width: 100, height: 40 };
  const square = (v: View): ReturnType<View["picture"]> => v.picture({ key: "sq", width: 20, height: 20 }, () => v.rect(0, 0, 20, 20, { fill: "#ff0000" }));
  const faded = await renderOnce(handle, { size, draw: (v) => v.place(square(v), 10, 10, { opacity: 0.5 }) });
  assert.ok(Math.abs(alphaAt(faded, [20, 20]) - 128) <= 1, "opacity applies to the placed layer");
  const erased = await renderOnce(handle, { size, draw: (v) => {
    return [
      v.rect(0, 0, 100, 40, { fill: "#0000ff" }),
      v.place(square(v), 40, 10, { erase: true }),
    ];
  } });
  assert.equal(alphaAt(erased, [50, 20]), 0, "erase removes the target under the picture");
  const multiplied = await renderOnce(handle, { size, draw: (v) => {
    return [
      v.rect(0, 0, 100, 40, { fill: "#ffff00" }),
      v.place(square(v), 40, 10, { blend: "multiply" }),
    ];
  } });
  assert.deepEqual(rgbaAt(multiplied, [50, 20]), [255, 0, 0, 255], "yellow × red is red");
}

/** `background` inside a picture fills the picture's box under the placement, not the canvas. */
export async function pictureBackground(handle: GpuHandle): Promise<void> {
  const px = await renderOnce(handle, { size: { width: 100, height: 100 }, draw: (v) => v.at({ rotate: 0 }, v.place(v.picture({ key: "bg", width: 20, height: 20 }, () => v.background("#ff0000")), 40, 0)) });
  assert.deepEqual(rgbaAt(px, [50, 10]), [255, 0, 0, 255]);
  assert.equal(alphaAt(px, [10, 50]), 0, "outside the picture's box nothing is painted");
  assert.equal(alphaAt(px, [61, 10]), 0);
  // A gradient background follows the placement: local x 0..20 runs black to white across canvas x 40..60.
  const ramp = await renderOnce(handle, { size: { width: 100, height: 100 }, draw: (v) => v.place(v.picture({ key: "bg-ramp", width: 20, height: 20 }, () => v.background(v.linearGradient(0, 0, 20, 0, [[0, "#000000"], [1, "#ffffff"]]))), 40, 0) });
  const [left] = rgbaAt(ramp, [42, 10]), [right] = rgbaAt(ramp, [57, 10]);
  assert.ok((left ?? 255) < 60 && (right ?? 0) > 190, `gradient runs across the placed box: ${String(left)} at x=42, ${String(right)} at x=57`);
}

export async function pixelImages(handle: GpuHandle): Promise<void> {
  const size = { width: 60, height: 20 };
  const px = await renderOnce(handle, { size, draw: (v) => {
    const image = v.pixels({ key: "ramp", width: 2, height: 1 }, (im) => {
      im.data.set([0, 0, 0, 255, 255, 255, 255, 255]);
    });
    return v.at({ scale: 20 }, v.place(image, 0, 0));
  } });
  const r = (x: number): number => rgbaAt(px, [x, 10])[0] ?? 0;
  assert.equal(r(2), 0, "the first pixel's own colour near its left edge");
  assert.equal(r(38), 255);
  assert.ok(Math.abs(r(20) - 128) <= 8, `sampled smoothly between pixels (got ${r(20)})`);
  assert.ok(r(15) < r(20) && r(20) < r(25), "bilinear: a ramp between the two pixel centres");
  assert.equal(alphaAt(px, [45, 10]), 0, "nothing outside the image");
}
