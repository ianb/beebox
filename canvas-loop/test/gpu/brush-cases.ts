// Brushed strokes on the GPU, run by renderer.gpu.test.ts: parity with today's Skia
// marks by crop (frozen in test/fixtures/scene-parity/), R1 blends and erase, the expansion cache, texture that moves
// with a translated shape, and paper scoped by R9.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Canvas, loadImage } from "@napi-rs/canvas";
import type { TestContext } from "node:test";
import type { View } from "../../src/scene/api.js";
import type { GpuHandle } from "../../src/device/open.js";
import { GpuRenderer } from "../../src/gpu/renderer.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";
import { SHEET_CROPS, SMEAR_CROPS, cropParity, drawSheet, drawSmear } from "./brush-sheet.js";
import type { SheetView } from "./brush-sheet.js";
import { parity, premultiplied } from "./compare.js";
import { alphaAt, renderOnce, rgbaAt, shiftedDiff } from "./render.js";

/** The Skia painter's render of a sheet, frozen as a fixture before the painter was deleted, premultiplied (each fixture decodes within 0 levels of the render it froze). */
export async function frozen(name: string, size: { width: number; height: number }): Promise<Uint8Array> {
  const image = await loadImage(fileURLToPath(new URL(`../fixtures/scene-parity/${name}.png`, import.meta.url)));
  assert.deepEqual([image.width, image.height], [size.width, size.height], `${name}.png is the sheet's size`);
  const ctx = new Canvas(size.width, size.height).getContext("2d");
  ctx.drawImage(image, 0, 0);
  return premultiplied(ctx.getImageData(0, 0, size.width, size.height).data);
}

async function sheetRows(handle: GpuHandle, s: { fixture: string; size: { width: number; height: number }; draw: (v: SheetView) => void; crops: typeof SHEET_CROPS }): Promise<{ rows: ReturnType<typeof cropParity>[]; flat: number }> {
  const gpu = await renderOnce(handle, { size: s.size, draw: (v) => s.draw(v) });
  const refPx = await frozen(s.fixture, s.size);
  const rows = s.crops.map((c) => cropParity({ ref: refPx, gpu: gpu.data }, { width: s.size.width, ...c }));
  return { rows, flat: parity({ ref: refPx, gpu: gpu.data }, { ...s.size, rect: [0, 0, s.size.width, s.size.height] }).flat };
}

export async function brushParity(handle: GpuHandle, t: TestContext): Promise<void> {
  const sheet = await sheetRows(handle, { fixture: "brush-sheet", size: { width: 640, height: 480 }, draw: drawSheet, crops: SHEET_CROPS });
  const smear = await sheetRows(handle, { fixture: "brush-smear", size: { width: 320, height: 160 }, draw: drawSmear, crops: SMEAR_CROPS });
  t.diagnostic(`sheet: flat pixels within 4/255 ${sheet.flat}%; smear: ${smear.flat}%`);
  const rows = [...sheet.rows, ...smear.rows];
  for (const r of rows) t.diagnostic(`${r.pass ? "pass" : "FAIL"} ${r.name.padEnd(18)} luminance ${r.lum}% contrast ${r.contrast}%`);
  assert.deepEqual(rows.filter((r) => !r.pass).map((r) => r.name), []);
}

/** R1: the brush's blend unless the style sets one (decision 8); erase removes by the mark's alpha. */
export async function brushBlends(handle: GpuHandle): Promise<void> {
  const size = { width: 120, height: 60 };
  const line = (v: View, extra: { blend?: "normal"; erase?: boolean }): void => v.line(10, 30, 110, 30, { stroke: "#ff0000", weight: 14, brush: "marker", gesture: { pressure: "even" }, ...extra });
  const base = (v: View): void => v.rect(0, 0, 120, 60, { fill: "#0000ff" });
  const multiplied = await renderOnce(handle, { size, draw: (v) => (base(v), line(v, {})) });
  const normal = await renderOnce(handle, { size, draw: (v) => (base(v), line(v, { blend: "normal" })) });
  const [mr = 0, , mb = 0] = rgbaAt(multiplied, [60, 30]);
  const [nr = 0, , nb = 0] = rgbaAt(normal, [60, 30]);
  assert.ok(mr < 10 && mb < 100, `a marker multiplies red over blue to near black (got ${mr}, ${mb})`);
  assert.ok(nr > 150 && nb > 40, `blend "normal" lays red over blue at the marker's opacity (got ${nr}, ${nb})`);
  const erased = await renderOnce(handle, { size, draw: (v) => (base(v), v.line(10, 30, 110, 30, { stroke: "#000", weight: 14, brush: "ink", erase: true, gesture: { pressure: "even" } })) });
  assert.equal(alphaAt(erased, [60, 30]), 0, "an ink erase removes the target under the mark");
  assert.equal(alphaAt(erased, [60, 5]), 255);
  const half = await renderOnce(handle, { size, draw: (v) => (base(v), v.line(10, 30, 110, 30, { stroke: "rgba(0,0,0,0.5)", weight: 14, brush: "ink", erase: true, gesture: { pressure: "even" } })) });
  assert.ok(Math.abs(alphaAt(half, [60, 30]) - 128) <= 2, `a half-alpha brush erases half (alpha ${alphaAt(half, [60, 30])})`);
}

/** Section 6: unchanged strokes reuse their expansion; the frame is byte-identical with and without the cache. */
export async function expansionCache(handle: GpuHandle, t: TestContext): Promise<void> {
  const rec = new SceneRecorder({ width: 640, height: 480 });
  const at = (dx: number, scale: number): ReturnType<SceneRecorder["record"]> => rec.record((v) => v.at({ translate: [dx, 0], scale }, () => drawSheet(v)));
  const warm = new GpuRenderer(handle);
  try {
    const cold = await warm.render(at(0, 1).scene, 1);
    const first = { ...warm.stats };
    const again = await warm.render(at(0, 1).scene, 1);
    assert.equal(first.expanded, first.strokes);
    assert.deepEqual([warm.stats.expanded, warm.stats.cacheHits], [0, first.strokes], "a second frame expands nothing");
    assert.ok(Buffer.from(cold.data).equals(Buffer.from(again.data)), "a frame from the cache is byte-identical");
    await warm.render(at(13, 1).scene, 2);
    assert.equal(warm.stats.expanded, 0, "a translation and another pixel ratio keep the expansion");
    await warm.render(at(0, 1.5).scene, 1);
    assert.equal(warm.stats.cacheHits, 0, "another scale expands again");
    await warm.render(at(0, 1.5 + 1e-12).scene, 1);
    assert.equal(warm.stats.cacheHits, 0, "the key is exact: a scale that differs in the last bits expands again");
    t.diagnostic(`sheet: ${first.strokes} brushed strokes; mark pages ${first.markPages}`);
  } finally {
    warm.destroy();
  }
}

/** Parity section 3: a brushed shape moved by whole pixels moves its texture with it. */
export async function brushStability(handle: GpuHandle, t: TestContext): Promise<void> {
  const figure = (v: View): void => {
    v.curve([[20, 20], [70, 12], [90, 60], [40, 75], [15, 50]], true, { stroke: "#2b2b2b", weight: 4, brush: "pencil", gesture: { wobble: 1 } });
    v.curve([[25, 40], [55, 32], [85, 48]], false, { stroke: "#b0563a", weight: 10, brush: "chalk" });
    v.curve([[20, 62], [50, 55], [88, 66]], false, { stroke: "#3b5d8a", weight: 12, brush: "bristle" });
    v.curve([[30, 30], [70, 34]], false, { stroke: "#3b4a8a", weight: 16, brush: "wash", gesture: { pressure: "swell" } });
  };
  const size = { width: 200, height: 100 };
  for (const ratio of [1, 2]) {
    const place = (dx: number) => (v: View): void => {
      v.background("#f4efe2");
      v.place(v.picture({ key: "figure", width: 100, height: 90 }, () => figure(v)), 10 + dx, 5);
    };
    const a = await renderOnce(handle, { size, draw: place(0), ratio });
    const b = await renderOnce(handle, { size, draw: place(7), ratio });
    const d = shiftedDiff({ a, b }, { rect: [0, 0, 110 * ratio, 95 * ratio], dx: 7 * ratio, dy: 0 });
    t.diagnostic(`ratio ${ratio}: a placed picture moved 7 px differs in ${d.differ} pixels`);
    assert.equal(d.differ, 0, `ratio ${ratio}: the texture moves with the placed picture`);
  }
  const moved = (dx: number) => (v: View): void => {
    v.background("#f4efe2");
    v.at({ translate: [dx, 0] }, () => v.curve([[20, 30], [60, 15], [100, 40]], false, { stroke: "#3b5d8a", weight: 12, brush: "bristle", gesture: { wobble: 1 } }));
  };
  const d = shiftedDiff({ a: await renderOnce(handle, { size, draw: moved(0) }), b: await renderOnce(handle, { size, draw: moved(5) }) }, { rect: [0, 0, 120, 60], dx: 5, dy: 0 });
  t.diagnostic(`a grainy bristle stroke moved 5 px with at differs in ${d.differ} pixels`);
  assert.equal(d.differ, 0, "paper is anchored to the call's coordinates: a stroke moved with at keeps its grain");
}

/** R9: v.paper lasts to the end of its group; a picture keeps the paper where v.picture is called. */
export async function paperScopes(handle: GpuHandle): Promise<void> {
  const size = { width: 120, height: 40 };
  const stroke = (v: View): void => v.line(10, 20, 110, 20, { stroke: "#000", weight: 10, brush: "chalk", gesture: { pressure: "even" } });
  const plain = await renderOnce(handle, { size, draw: stroke });
  const other = await renderOnce(handle, { size, draw: (v) => (v.paper({ seed: 9 }), stroke(v)) });
  const scoped = await renderOnce(handle, { size, draw: (v) => (v.group({}, () => v.paper({ seed: 9 })), stroke(v)) });
  const pictured = await renderOnce(handle, { size, draw: (v) => {
    v.paper({ seed: 9 });
    const p = v.picture({ key: "line", width: 120, height: 40 }, () => stroke(v));
    v.paper({ seed: 1 });
    v.place(p, 0, 0);
  } });
  const same = (a: { data: Uint8Array }, b: { data: Uint8Array }): boolean => Buffer.from(a.data).equals(Buffer.from(b.data));
  const wide = await renderOnce(handle, { size: { width: 200, height: 40 }, draw: stroke });
  assert.equal(shiftedDiff({ a: plain, b: wide }, { rect: [0, 0, 120, 40], dx: 0, dy: 0 }).differ, 0, "grain does not depend on the canvas size");
  assert.ok(!same(plain, other), "another paper seed changes the grain");
  assert.ok(same(plain, scoped), "paper set inside a group ends with the group");
  assert.ok(same(other, pictured), "a picture uses the paper in effect where v.picture is called");
}
