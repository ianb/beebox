// Kept picture rasters and clips, run by renderer.gpu.test.ts: memory stays
// inside the raster budget, a walk cycle's poses are drawn once, a picture
// that reads its surroundings draws as one layer, a tile placed twice in a
// frame is drawn once, and a clip to a path whose contours overlap keeps
// winding coverage.
import assert from "node:assert/strict";
import type { PathCommand, Vec2 } from "../../src/core/paint.js";
import type { Drawing, View } from "../../src/core/tea.js";
import type { GpuHandle } from "../../src/device/open.js";
import { GpuRenderer } from "../../src/gpu/renderer.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";
import { renderOnce } from "./render.js";

function maxDiff(a: Uint8Array, b: Uint8Array): number {
  let most = 0;
  for (const [i, x] of a.entries()) most = Math.max(most, Math.abs(x - (b[i] ?? 0)));
  return most;
}

/** A picture whose size grows every frame: idle versions' textures stay within the 32 MB idle budget, the oldest destroyed first. */
export async function rasterMemory(handle: GpuHandle): Promise<void> {
  const size = { width: 1000, height: 1000 };
  const rec = new SceneRecorder(size);
  const renderer = new GpuRenderer(handle);
  try {
    let most = 0;
    for (let f = 0; f < 8; f++) {
      const scene = rec.record((v) => v.place(v.picture({ key: "grow", width: 800 + f * 10, height: 800 }, () => v.rect(0, 0, 800 + f * 10, 800, { fill: "#3a6a9a" })), 10, 10)).scene;
      await renderer.render(scene, 2);
      most = Math.max(most, renderer.held.tileBytes);
    }
    const tile = (800 + 7 * 10) * 2 * 800 * 2 * 4;
    assert.ok(most <= 32 * 1024 * 1024 + 2 * tile, `kept raster bytes (most ${most}) stay within the idle budget and two live tiles`);
    assert.ok(renderer.held.tiles < 8, `old versions' tiles are destroyed (${renderer.held.tiles} kept)`);
  } finally {
    renderer.destroy();
  }
}

/** A walk cycle: four poses, each shown three frames in turn, are drawn once each; when a pose comes back its tile is reused. */
export async function poseCycleReuse(handle: GpuHandle): Promise<void> {
  const rec = new SceneRecorder({ width: 200, height: 100 });
  const renderer = new GpuRenderer(handle);
  try {
    let drawn = 0;
    for (let f = 0; f < 36; f++) {
      const pose = Math.floor(f / 3) % 4;
      const scene = rec.record((v) => v.place(v.picture({ key: "walker", width: 40, height: 60, deps: [pose] }, () => v.rect(pose * 5, 0, 20, 60, { fill: "#8a4f9a" })), 20 + f, 20)).scene;
      await renderer.render(scene, 1);
      drawn += renderer.stats.tilesDrawn;
    }
    assert.equal(drawn, 4, "one tile per pose, over three cycles");
  } finally {
    renderer.destroy();
  }
}

/** A smudge crossing the tile edge (x = 2048) carries paint across it: the picture draws as one layer, as the group does. */
export async function smudgeAcrossTiles(handle: GpuHandle): Promise<void> {
  const size = { width: 2200, height: 80 };
  const body = (v: View): Drawing => {
    const out: Drawing[] = [];
    for (let x = 1900; x < 2200; x += 40) out.push(v.rect(x, 0, 20, 80, { fill: x % 80 === 20 ? "#c84a3a" : "#3a6a9a" }));
    out.push(v.curve([[1960, 40], [2050, 44], [2150, 38]], false, { stroke: "#000", weight: 18, brush: "smudge", gesture: { pressure: "even", wobble: 0 } }));
    return out;
  };
  const placed = await renderOnce(handle, { size, draw: (v) => v.place(v.picture({ key: "smudged", width: 2200, height: 80 }, () => body(v)), 0, 0) });
  const group = await renderOnce(handle, { size, draw: (v) => v.group({}, body(v)) });
  const most = maxDiff(placed.data, group.data);
  assert.ok(most <= 1, `a placed picture smudged across the tile edge matches the group (largest difference ${most})`);
}

/** A picture placed twice in a frame, cold, draws its tile once and keeps one texture. */
export async function tilePlacedTwice(handle: GpuHandle): Promise<void> {
  const renderer = new GpuRenderer(handle);
  try {
    const rec = new SceneRecorder({ width: 200, height: 100 });
    const scene = rec.record((v) => {
      const pic = v.picture({ key: "twice", width: 40, height: 40 }, () => v.circle(20, 20, 18, { fill: "#e0b02a" }));
      return [
        v.place(pic, 10, 10),
        v.place(pic, 120, 30),
      ];
    }).scene;
    await renderer.render(scene, 1);
    assert.equal(renderer.stats.tilesDrawn, 1, "the shared tile is drawn once");
    assert.equal(renderer.held.tiles, 1, "one tile is kept");
  } finally {
    renderer.destroy();
  }
}

/** One path of two identical contours clips by winding (as its outline once), not by summed area. */
export async function overlappingContourClip(handle: GpuHandle): Promise<void> {
  const size = { width: 120, height: 90 };
  const pts: Vec2[] = Array.from({ length: 24 }, (_, i): Vec2 => [60 + 37.3 * Math.cos((i * Math.PI) / 12), 45 + 31.7 * Math.sin((i * Math.PI) / 12)]);
  const contour = (): PathCommand[] => [["move", ...(pts[0] ?? [0, 0])], ...pts.slice(1).map((p): PathCommand => ["line", ...p]), ["close"]];
  const clipped = (path: PathCommand[]) => (v: View): Drawing => {
    return [
      v.background("#ffffff"),
      v.clip(path, v.rect(0, 0, 120, 90, { fill: "#000000" })),
    ];
  };
  const once = await renderOnce(handle, { size, draw: clipped(contour()) });
  const twice = await renderOnce(handle, { size, draw: clipped([...contour(), ...contour()]) });
  const most = maxDiff(once.data, twice.data);
  assert.ok(most <= 2, `a doubled contour clips as the contour once (largest difference ${most})`);
}

/** A wide picture that reads its surroundings, placed far left: its one layer covers what can be seen of it, wherever that lies in the picture. */
export async function wideReadingPicture(handle: GpuHandle): Promise<void> {
  const size = { width: 400, height: 100 };
  const body = (v: View): Drawing => {
    return [
      v.curve([[100, 50], [300, 50]], false, { stroke: "#000", weight: 18, brush: "smudge", gesture: { pressure: "even", wobble: 0 } }),
      v.rect(9000, 20, 100, 60, { fill: "#c84a3a" }),
    ];
  };
  const placed = await renderOnce(handle, { size, draw: (v) => v.place(v.picture({ key: "wide", width: 10000, height: 100 }, () => body(v)), -9000, 0) });
  const group = await renderOnce(handle, { size, draw: (v) => v.at({ translate: [-9000, 0] }, v.group({}, body(v))) });
  assert.equal(placed.data[(50 * 400 + 50) * 4 + 3], 255, "the rect at picture x 9000 shows at canvas x 0..100");
  const most = maxDiff(placed.data, group.data);
  assert.ok(most <= 1, `the placed wide picture matches the group (largest difference ${most})`);
}

/** Draft 2.6 for every placement: `pixels` images and pictures inside a lit group snap to whole device pixels too. */
export async function everyPlacementSnaps(handle: GpuHandle): Promise<void> {
  const size = { width: 120, height: 80 };
  const image = (v: View): ReturnType<View["pixels"]> => v.pixels({ key: "ramp", width: 4, height: 2 }, (im) => {
    for (let i = 0; i < 8; i++) im.data.set([i * 30, 255 - i * 30, 90, 255], i * 4);
  });
  const px = (x: number, y: number) => (v: View): Drawing => v.place(image(v), x, y);
  assert.ok(Buffer.from((await renderOnce(handle, { size, draw: px(10.3, 5.6), ratio: 2 })).data).equals(Buffer.from((await renderOnce(handle, { size, draw: px(10.5, 5.5), ratio: 2 })).data)), "a pixels image at a sub-pixel position draws at the snapped device position");
  const lit = (x: number, y: number) => (v: View): Drawing => v.group({ lighting: { ambient: "#404040" } }, [
    v.light({ kind: "point", at: [60, 40], height: 50, energy: 2 }),
    v.place(v.picture({ key: "lit", width: 40, height: 30 }, () => v.rect(0, 0, 40, 30, { fill: "#d8c890" })), x, y),
  ]);
  assert.ok(Buffer.from((await renderOnce(handle, { size, draw: lit(20.3, 10.6) })).data).equals(Buffer.from((await renderOnce(handle, { size, draw: lit(20, 11) })).data)), "a picture in a lit group at a sub-pixel position draws at the snapped device position");
}
