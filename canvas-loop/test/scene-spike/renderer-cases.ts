// Renderer cases from the chunk 1–2 review, run by gpu.test.ts (one Dawn
// device per process): culling and cutting shapes to what can be seen, clip
// unions as geometric unions, effects under non-uniform transforms, and frames
// that fail cleanly.
import assert from "node:assert/strict";
import { SketchUsageError } from "../../src/core/errors.js";
import type { PathCommand, Vec2 } from "../../src/core/paint.js";
import type { View } from "../../src/scene-draft/scene-api.js";
import type { GpuHandle } from "../../src/scene-spike/device.js";
import { GpuRenderError, UnsupportedCallError } from "../../src/scene-spike/errors.js";
import { GpuRenderer } from "../../src/scene-spike/gpu/renderer.js";
import type { Pixels } from "../../src/scene-spike/gpu/renderer.js";
import { SceneRecorder } from "../../src/scene-spike/recorder/view.js";

interface Size {
  width: number;
  height: number;
}

async function render(handle: GpuHandle, s: { size: Size; draw: (v: View) => void }): Promise<Pixels> {
  const renderer = new GpuRenderer(handle);
  try {
    return await renderer.render(new SceneRecorder(s.size).record(s.draw).scene, 1);
  } finally {
    renderer.destroy();
  }
}

const alpha = (px: Pixels, at: Vec2): number => px.data[(at[1] * px.width + at[0]) * 4 + 3] ?? 0;
function maxDiff(a: Pixels, b: Pixels): number {
  let m = 0;
  for (const [i, v] of a.data.entries()) m = Math.max(m, Math.abs(v - (b.data[i] ?? 0)));
  return m;
}

export async function offscreenShapes(handle: GpuHandle): Promise<void> {
  const size = { width: 100, height: 100 };
  const gone = await render(handle, { size, draw: (v) => v.rect(-9000, 10, 9000, 20, { fill: "#f00" }) });
  assert.equal(gone.data.reduce((m, v) => Math.max(m, v), 0), 0, "a shape wholly off the canvas draws nothing and does not abort the frame");
  const huge = await render(handle, { size, draw: (v) => v.rect(-20000, 10, 40000, 20, { fill: "#f00" }) });
  assert.equal(alpha(huge, [0, 20]), 255);
  assert.equal(alpha(huge, [99, 20]), 255, "a shape wider than the atlas is cut to the canvas and drawn");
  const near = await render(handle, { size, draw: (v) => v.group({ effects: { blur: 4 } }, () => v.rect(-12, 10, 10, 80, { fill: "#000" })) });
  assert.ok(alpha(near, [0, 50]) > 0, "a shape just off the canvas still blurs onto it (R5 reach)");
  await assert.rejects(render(handle, { size: { width: 9000, height: 4 }, draw: (v) => v.rect(0, 0, 9000, 4, { fill: "#000" }) }), (e: unknown) => e instanceof GpuRenderError && /larger than the atlas/.test(e.message));
}

export async function clipUnions(handle: GpuHandle): Promise<void> {
  const size = { width: 120, height: 90 };
  const clipped = (shapes: readonly (readonly Vec2[] | readonly PathCommand[])[]) => (v: View): void => {
    v.background("#ffffff");
    v.clip(shapes, () => v.rect(0, 0, 120, 90, { fill: "#000000" }));
  };
  const star: Vec2[] = Array.from({ length: 10 }, (_, i): Vec2 => [60 + (i % 2 === 0 ? 40 : 17) * Math.cos(-Math.PI / 2 + (Math.PI * i) / 5), 45 + (i % 2 === 0 ? 40 : 17) * Math.sin(-Math.PI / 2 + (Math.PI * i) / 5)]);
  const one = await render(handle, { size, draw: clipped([star]) });
  assert.equal(maxDiff(one, await render(handle, { size, draw: clipped([star, star, star]) })), 0, "a repeated shape clips as the shape once");
  const rect = (...[x0, y0, x1, y1]: [number, number, number, number]): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  // A union sums windings in 64 bands down each pixel; one shape takes its exact area from the atlas: within two levels.
  const halves = await render(handle, { size, draw: clipped([rect(10.3, 10.4, 50.5, 70.6), rect(50.5, 10.4, 100.7, 70.6)]) });
  const seam = maxDiff(halves, await render(handle, { size, draw: clipped([rect(10.3, 10.4, 100.7, 70.6)]) }));
  assert.ok(seam <= 2, `two shapes sharing an edge leave no seam (largest difference ${seam})`);
  const ell: Vec2[] = [[10.3, 10.4], [60.6, 10.4], [60.6, 30.2], [90.8, 30.2], [90.8, 70.6], [40.2, 70.6], [40.2, 60.5], [10.3, 60.5]];
  const overlap = await render(handle, { size, draw: clipped([rect(10.3, 10.4, 60.6, 60.5), rect(40.2, 30.2, 90.8, 70.6)]) });
  const outline = maxDiff(overlap, await render(handle, { size, draw: clipped([ell]) }));
  assert.ok(outline <= 2, `overlapping shapes clip as their outline (largest difference ${outline})`);
  // A path with a hole keeps the hole; another shape in the union fills part of it.
  const ring: PathCommand[] = [["move", 10, 10], ["line", 110, 10], ["line", 110, 80], ["line", 10, 80], ["close"], ["move", 30, 25], ["line", 30, 65], ["line", 90, 65], ["line", 90, 25], ["close"]];
  const holed = await render(handle, { size, draw: clipped([ring, rect(35, 30, 55, 60)]) });
  assert.equal(holed.data[(45 * 120 + 45) * 4], 0, "the second shape covers part of the hole");
  assert.equal(holed.data[(45 * 120 + 75) * 4], 255, "the rest of the hole stays open");
  assert.equal(holed.data[(15 * 120 + 60) * 4], 0, "the ring itself clips");
}

export async function anisotropicEffects(handle: GpuHandle): Promise<void> {
  const size = { width: 160, height: 60 };
  const row = (px: Pixels, y: number): number[] => Array.from({ length: px.width }, (_, x) => alpha(px, [x, y]));
  const col = (px: Pixels, x: number): number[] => Array.from({ length: px.height }, (_, y) => alpha(px, [x, y]));
  const close = (a: readonly number[], b: readonly number[]): boolean => a.every((v, i) => Math.abs(v - (b[i] ?? 0)) <= 1);
  const across = await render(handle, { size, draw: (v) => v.at({ scale: [4, 1] }, () => v.group({ effects: { blur: 4 } }, () => v.rect(10, -100, 20, 300, { fill: "#000" }))) });
  const wide = await render(handle, { size, draw: (v) => v.group({ effects: { blur: 16 } }, () => v.rect(40, -100, 80, 300, { fill: "#000" })) });
  assert.ok(close(row(across, 30), row(wide, 30)), "under scale [4, 1], blur 4 spreads 16 device px across");
  const down = await render(handle, { size, draw: (v) => v.at({ scale: [4, 1] }, () => v.group({ effects: { blur: 4 } }, () => v.rect(-100, 20, 300, 20, { fill: "#000" }))) });
  const tall = await render(handle, { size, draw: (v) => v.group({ effects: { blur: 4 } }, () => v.rect(-400, 20, 1200, 20, { fill: "#000" })) });
  assert.ok(close(col(down, 80), col(tall, 80)), "and 4 device px down");
  await render(handle, { size, draw: (v) => v.at({ rotate: 0.5, scale: 2 }, () => v.group({ effects: { blur: 2, shadow: { y: 3, blur: 2, color: "#000" } } }, () => v.rect(0, 0, 10, 10, { fill: "#000" }))) });
  for (const at of [{ rotate: 0.5, scale: [2, 1] as const }, { skew: [0.3, 0] as const }]) {
    await assert.rejects(render(handle, { size, draw: (v) => v.at(at, () => v.group({ effects: { glow: { blur: 3, color: "#ff0" } } }, () => v.rect(0, 0, 10, 10, { fill: "#000" }))) }), (e: unknown) => e instanceof UnsupportedCallError && /effects under a rotated non-uniform scale or a skew/.test(e.message));
  }
}

export async function failedFrames(handle: GpuHandle): Promise<void> {
  const renderer = new GpuRenderer(handle);
  try {
    // Fails during encoding, after the coverage atlas has taken a page and its buffers: a brushed mark wider than the mark atlas.
    const late = new SceneRecorder({ width: 9000, height: 8 }).record((v) => {
      v.rect(0, 0, 10, 8, { fill: "#000" });
      v.line(0, 4, 9000, 4, { stroke: "#000", weight: 3, brush: "pencil" });
    }).scene;
    await assert.rejects(renderer.render(late, 1), (e: unknown) => e instanceof GpuRenderError && /larger than the atlas/.test(e.message));
    assert.ok(renderer.held.textures > 0, "the failed frame had allocated textures");
    assert.equal(renderer.held.inUse, 0, "a frame that fails after allocating holds no textures");
    await assert.rejects(handle.device.popErrorScope(), "no error scope is left open after a late failure");
    const bad = new SceneRecorder({ width: 40, height: 40 }).record((v) => v.rect(0, 0, 10, 10, { fill: "not-a-color" })).scene;
    for (let i = 0; i < 3; i++) await assert.rejects(renderer.render(bad, 1), SketchUsageError);
    await assert.rejects(handle.device.popErrorScope(), "no error scope is left open");
    assert.equal(renderer.held.inUse, 0, "a failed frame holds no textures");
    const good = await renderer.render(new SceneRecorder({ width: 40, height: 40 }).record((v) => v.rect(0, 0, 10, 10, { fill: "#00f" })).scene, 1);
    assert.equal(alpha(good, [5, 5]), 255);
    assert.equal(renderer.held.inUse, 0);
    await assert.rejects(handle.device.popErrorScope());
  } finally {
    renderer.destroy();
  }
}
