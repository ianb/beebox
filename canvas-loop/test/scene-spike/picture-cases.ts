// Pictures on the GPU, run by gpu.test.ts: placement replays the recording
// under the placement transform (R7), placement options, and `pixels` images.
import assert from "node:assert/strict";
import type { View } from "../../src/scene-draft/scene-api.js";
import type { GpuHandle } from "../../src/scene-spike/device.js";
import { alphaAt, renderOnce, rgbaAt } from "./gpu-render.js";

function body(v: View): void {
  v.rect(0, 0, 60, 40, { fill: "#cfe0ea", stroke: "#1d3557", weight: 2 });
  v.circle(30, 20, 12, { fill: "rgba(230,57,70,0.8)" });
  // Ink has no grain: a grainy brush would differ, its paper being the picture's coordinates (R9).
  v.curve([[5, 35], [30, 8], [55, 35]], false, { stroke: "#2b2b2b", weight: 4, brush: "ink" });
  v.group({ effects: { blur: 2 } }, () => v.rect(40, 5, 10, 10, { fill: "#000" }));
}

export async function placementReplays(handle: GpuHandle): Promise<void> {
  const size = { width: 200, height: 120 };
  for (const at of [{ translate: [30, 20] as const, scale: [2, 1] as const }, { translate: [80, 10] as const, rotate: 0.4 }]) {
    const placed = await renderOnce(handle, { size, draw: (v) => v.at(at, () => v.place(v.picture({ key: "p", width: 60, height: 40 }, () => body(v)), 5, 7)) });
    const direct = await renderOnce(handle, { size, draw: (v) => v.at(at, () => v.at({ translate: [5, 7] }, () => v.group({}, () => body(v)))) });
    assert.ok(Buffer.from(placed.data).equals(Buffer.from(direct.data)), `placing under ${JSON.stringify(at)} draws exactly what the body draws there in a group`);
  }
}

export async function placeOptions(handle: GpuHandle): Promise<void> {
  const size = { width: 100, height: 40 };
  const square = (v: View): ReturnType<View["picture"]> => v.picture({ key: "sq", width: 20, height: 20 }, () => v.rect(0, 0, 20, 20, { fill: "#ff0000" }));
  const faded = await renderOnce(handle, { size, draw: (v) => v.place(square(v), 10, 10, { opacity: 0.5 }) });
  assert.ok(Math.abs(alphaAt(faded, [20, 20]) - 128) <= 1, "opacity applies to the placed layer");
  const erased = await renderOnce(handle, { size, draw: (v) => {
    v.rect(0, 0, 100, 40, { fill: "#0000ff" });
    v.place(square(v), 40, 10, { erase: true });
  } });
  assert.equal(alphaAt(erased, [50, 20]), 0, "erase removes the target under the picture");
  const multiplied = await renderOnce(handle, { size, draw: (v) => {
    v.rect(0, 0, 100, 40, { fill: "#ffff00" });
    v.place(square(v), 40, 10, { blend: "multiply" });
  } });
  assert.deepEqual(rgbaAt(multiplied, [50, 20]), [255, 0, 0, 255], "yellow × red is red");
}

/** `background` inside a picture fills the picture's box under the placement, not the canvas. */
export async function pictureBackground(handle: GpuHandle): Promise<void> {
  const px = await renderOnce(handle, { size: { width: 100, height: 100 }, draw: (v) => v.at({ rotate: 0 }, () => v.place(v.picture({ key: "bg", width: 20, height: 20 }, () => v.background("#ff0000")), 40, 0)) });
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
    v.at({ scale: 20 }, () => v.place(image, 0, 0));
  } });
  const r = (x: number): number => rgbaAt(px, [x, 10])[0] ?? 0;
  assert.equal(r(2), 0, "the first pixel's own colour near its left edge");
  assert.equal(r(38), 255);
  assert.ok(Math.abs(r(20) - 128) <= 8, `sampled smoothly between pixels (got ${r(20)})`);
  assert.ok(r(15) < r(20) && r(20) < r(25), "bilinear: a ramp between the two pixel centres");
  assert.equal(alphaAt(px, [45, 10]), 0, "nothing outside the image");
}
