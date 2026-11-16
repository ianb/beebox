// Wash, hatching and paper on the GPU (R5 step 2), run by renderer.gpu.test.ts:
// determinism, bounds (bleed grows the layer; nothing else touches alpha),
// pigment that moves and turns with the group's transform (section 4), and
// hatching revealed by tone relative to the group's own range.
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import type { Effects, View } from "../../src/core/tea.js";
import type { GpuHandle } from "../../src/device/open.js";
import { GpuRenderer } from "../../src/gpu/renderer.js";
import type { Pixels } from "../../src/gpu/renderer.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";
import { alphaAt, renderOnce, rgbaAt, shiftedDiff } from "./render.js";

const ALL: Effects = { wash: { granulate: 0.6, edges: 0.7, blotch: 0.5, bleed: 3 }, hatching: { amount: 1 }, paper: 1 };

/** Shapes at several tones with a grainy brush across them. */
function scene(v: View): void {
  v.rect(10, 10, 70, 50, { fill: "#2f4f6f" });
  v.circle(100, 45, 30, { fill: "#d98c4a" });
  v.rect(20, 60, 110, 30, { fill: v.linearGradient(20, 0, 130, 0, [[0, "#f2efe6"], [1, "#3a3226"]]) });
  v.curve([[15, 30], [70, 15], [130, 40]], false, { stroke: "#7a2f2f", weight: 8, brush: "chalk" });
}

const same = (a: Pixels, b: Pixels): boolean => Buffer.from(a.data).equals(Buffer.from(b.data));

export async function painterlyRepeats(handle: GpuHandle): Promise<void> {
  const size = { width: 160, height: 110 };
  const draw = (v: View): void => v.group({ effects: ALL }, () => scene(v));
  const renderer = new GpuRenderer(handle);
  try {
    const rec = new SceneRecorder(size).record(draw).scene;
    for (const ratio of [1, 2]) {
      const a = await renderer.render(rec, ratio);
      const b = await renderer.render(rec, ratio);
      assert.ok(same(a, b), `ratio ${ratio}: a second frame is byte-identical`);
      assert.ok(same(a, await renderOnce(handle, { size, draw, ratio })), `ratio ${ratio}: a fresh renderer gives the same bytes`);
    }
  } finally {
    renderer.destroy();
  }
}

/** R5 bounds: a wash's bleed reaches past the content and no further; hatching and paper keep alpha exactly. */
export async function painterlyBounds(handle: GpuHandle, t: TestContext): Promise<void> {
  const size = { width: 120, height: 120 };
  const square = (effects: Effects) => (v: View): void => v.group({ effects }, () => v.rect(40, 40, 40, 40, { fill: "#3b5d8a" }));
  const bled = await renderOnce(handle, { size, draw: square({ wash: { bleed: 6 } }) });
  let outside = 0;
  let beyond = 0;
  for (let y = 0; y < 120; y++) {
    for (let x = 0; x < 120; x++) {
      const d = Math.max(40 - x, x - 79, 40 - y, y - 79);
      if (d <= 0 || alphaAt(bled, [x, y]) === 0) continue;
      outside++;
      if (d > Math.ceil(6 * Math.SQRT2) + 1) beyond++;
    }
  }
  t.diagnostic(`bleed 6: ${outside} pixels drawn outside the square`);
  assert.ok(outside > 40, "the wash's edges wander past the square");
  assert.equal(beyond, 0, "and no further than the bleed");
  const plain = await renderOnce(handle, { size, draw: (v) => scene(v) });
  for (const effects of [{ hatching: { amount: 1 } }, { paper: 1 }, { wash: { bleed: 0 } }] satisfies Effects[]) {
    const fx = await renderOnce(handle, { size, draw: (v) => v.group({ effects }, () => scene(v)) });
    let alphaChanged = 0;
    let lighter = 0;
    for (let i = 0; i < plain.data.length; i += 4) {
      if (plain.data[i + 3] !== fx.data[i + 3]) alphaChanged++;
      for (let k = 0; k < 3; k++) if ((fx.data[i + k] ?? 0) > (plain.data[i + k] ?? 0) + 1 && "paper" in effects) lighter++;
    }
    assert.equal(alphaChanged, 0, `${Object.keys(effects).join(",")} changes colour only, never alpha`);
    assert.equal(lighter, 0, "paper only darkens");
  }
}

/** Section 4: pigment, lines and paper texture move and turn with the group's transform. */
export async function pigmentMoves(handle: GpuHandle, t: TestContext): Promise<void> {
  const size = { width: 200, height: 200 };
  for (const ratio of [1, 2]) {
    const at = (dx: number, dy: number) => (v: View): void => v.at({ translate: [dx, dy] }, () => v.group({ effects: ALL }, () => scene(v)));
    const a = await renderOnce(handle, { size, draw: at(0, 0), ratio });
    const b = await renderOnce(handle, { size, draw: at(7, 3), ratio });
    const d = shiftedDiff({ a, b }, { rect: [0, 0, 180 * ratio, 180 * ratio], dx: 7 * ratio, dy: 3 * ratio });
    t.diagnostic(`ratio ${ratio}: moved 7,3 px, ${d.differ} pixels differ`);
    assert.equal(d.differ, 0, `ratio ${ratio}: wash, hatching and paper move with the group`);
  }
  // A quarter turn: device (x, y) = (200 − y, x) in the group's coordinates. Shapes and brushes
  // themselves rasterise a little differently turned, so the effects must add no more than that.
  const turnDiff = async (effects: Effects | undefined): Promise<{ differ: number; max: number }> => {
    const draw = (v: View): void => v.group(effects === undefined ? {} : { effects }, () => scene(v));
    const plain = await renderOnce(handle, { size, draw });
    const turned = await renderOnce(handle, { size, draw: (v) => v.at({ matrix: [0, 1, -1, 0, 200, 0] }, () => draw(v)) });
    let differ = 0;
    let max = 0;
    for (let y = 0; y < 200; y++) {
      for (let x = 0; x < 200; x++) {
        const i = (y * 200 + x) * 4;
        const j = (x * 200 + (199 - y)) * 4;
        let m = 0;
        for (let k = 0; k < 4; k++) m = Math.max(m, Math.abs((plain.data[i + k] ?? 0) - (turned.data[j + k] ?? 0)));
        if (m > 2) differ++;
        max = Math.max(max, m);
      }
    }
    return { differ, max };
  };
  const base = await turnDiff(undefined);
  const fx = await turnDiff(ALL);
  t.diagnostic(`quarter turn, pixels off by more than 2 levels: ${base.differ} without effects, ${fx.differ} with (largest ${base.max}, ${fx.max})`);
  // The separable blurs run in the other order relative to the pattern, so their 8-bit rounding
  // differs, which can tip a hatch line at its tone threshold; a pattern that did not turn would differ everywhere.
  assert.ok(fx.differ <= base.differ + 0.02 * 200 * 200, "wash, hatching and paper turn with the group");
}

/**
 * The share of a patch's pixels the hatching inked: darker by more than a fifth than the plain
 * colour and than the paper between its lines (the patch's lightest hatched value, which lifts
 * toward paper where lines carry the tone).
 */
function inkShare(pair: { plain: Pixels; hatched: Pixels }, rect: readonly [number, number, number, number]): number {
  const [rx, ry, rw, rh] = rect;
  const at = (px: Pixels, p: readonly [number, number]): number => px.data[(p[1] * px.width + p[0]) * 4 + 1] ?? 0;
  let paper = 0;
  for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) paper = Math.max(paper, at(pair.hatched, [x, y]));
  let inked = 0;
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      const level = Math.max(at(pair.plain, [x, y]), paper);
      if (level - at(pair.hatched, [x, y]) > 0.2 * level) inked++;
    }
  }
  return inked / (rw * rh);
}

/** Praun et al.: light tones bare, mid tones single hatching, dark tones cross-hatched, by tone relative to the group. */
export async function hatchingTones(handle: GpuHandle, t: TestContext): Promise<void> {
  const size = { width: 300, height: 100 };
  const rects = [[10, 10, 80, 80], [110, 10, 80, 80], [210, 10, 80, 80]] as const;
  for (const key of [["#ece8e0", "#8f8a80", "#2e2b26"], ["#5a5650", "#3a3732", "#1a1814"]]) {
    const patches = (v: View): void => {
      for (const [k, [x, y, w, h]] of rects.entries()) v.rect(x, y, w, h, { fill: key[k] ?? "#000" });
    };
    const plain = await renderOnce(handle, { size, draw: patches });
    const hatched = await renderOnce(handle, { size, draw: (v) => v.group({ effects: { hatching: { amount: 1 } } }, () => patches(v)) });
    const [light = 0, mid = 0, dark = 0] = rects.map((r) => inkShare({ plain, hatched }, r));
    t.diagnostic(`${key.join(" ")}: inked share light ${light.toFixed(3)}, mid ${mid.toFixed(3)}, dark ${dark.toFixed(3)}`);
    assert.ok(light < 0.01, "the group's lightest tone stays bare");
    assert.ok(mid > 0.05, "mid tones are hatched");
    assert.ok(dark > 1.5 * mid, "dark tones are cross-hatched, far more densely");
  }
}

/** Pixels the hatching changed at all inside `rect`. */
function touched(pair: { plain: Pixels; hatched: Pixels }, rect: readonly [number, number, number, number]): number {
  const [rx, ry, rw, rh] = rect;
  let n = 0;
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      const i = (y * pair.plain.width + x) * 4 + 1;
      if ((pair.plain.data[i] ?? 0) - (pair.hatched.data[i] ?? 0) > 2) n++;
    }
  }
  return n;
}

/** Draft 2.5: `amount` scales line density with ink, so less amount leaves fewer lines at a given tone. */
export async function hatchingAmount(handle: GpuHandle, t: TestContext): Promise<void> {
  const size = { width: 200, height: 100 };
  const patches = (v: View): void => {
    v.rect(0, 0, 100, 100, { fill: "#ece8e0" });
    v.rect(100, 0, 100, 100, { fill: "#6f6a60" });
  };
  const plain = await renderOnce(handle, { size, draw: patches });
  const at = async (amount: number): Promise<number> => touched({ plain, hatched: await renderOnce(handle, { size, draw: (v) => v.group({ effects: { hatching: { amount } } }, () => patches(v)) }) }, [110, 10, 80, 80]);
  const full = await at(1);
  const half = await at(0.5);
  t.diagnostic(`mid patch, pixels touched: amount 1 ${full}, amount 0.5 ${half}`);
  assert.ok(half < 0.75 * full, "half the amount shows fewer lines");
}

/**
 * Finding 2 of the drawing round: a wash reads its layer as continuous past the canvas edge, so a background that
 * fills the canvas exactly gets no holes and no drying line along the border, while a region edge inside the
 * canvas still dries. Drying is measured as how much darker the wash is with `edges` than without.
 */
export async function washCanvasEdge(handle: GpuHandle, t: TestContext): Promise<void> {
  const size = { width: 200, height: 150 };
  const washed = (edges: number) => (v: View): void => v.group({ effects: { wash: { edges, blotch: 0, granulate: 0, bleed: 3 } } }, () => {
    v.rect(0, 0, 200, 150, { fill: "#7d8a86" });
    v.rect(70, 50, 60, 50, { fill: "#4f78a8" });
  });
  // Also inside a group whose glow reaches past the canvas: the wash still treats the canvas edge as continuous.
  const inGlow = (edges: number) => (v: View): void => v.group({ effects: { glow: { blur: 4, color: "#000000" } } }, () => washed(edges)(v));
  for (const [ratio, draw] of [[1, washed], [2, washed], [1, inGlow]] as const) {
    const dried = await renderOnce(handle, { size, draw: draw(0.8), ratio });
    const flat = await renderOnce(handle, { size, draw: draw(0), ratio });
    const lum = (px: Pixels, at: readonly [number, number]): number => {
      const [r = 0, g = 0, b = 0] = rgbaAt(px, at);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    /** Mean drying (luminance lost to `edges`) and holes over the device pixels where `inBand` holds. */
    const band = (inBand: (x: number, y: number) => boolean): { dry: number; holes: number } => {
      let sum = 0;
      let n = 0;
      let holes = 0;
      for (let y = 0; y < dried.height; y++) {
        for (let x = 0; x < dried.width; x++) {
          if (!inBand(x / ratio, y / ratio)) continue;
          sum += lum(flat, [x, y]) - lum(dried, [x, y]);
          n++;
          if (alphaAt(dried, [x, y]) < 255) holes++;
        }
      }
      return { dry: sum / n, holes };
    };
    const fromEdge = (x: number, y: number): number => Math.min(x, y, 200 - x, 150 - y);
    const inner = (x: number, y: number): number => Math.max(70 - x, x - 130, 50 - y, y - 100);
    const rim = band((x, y) => fromEdge(x, y) < 4);
    const wall = band((x, y) => fromEdge(x, y) >= 20 && fromEdge(x, y) < 30 && inner(x, y) > 20);
    const blueEdge = band((x, y) => Math.abs(inner(x, y)) <= 3);
    t.diagnostic(`ratio ${ratio}: drying at the canvas rim ${rim.dry.toFixed(1)} (holes ${rim.holes}), on the wall ${wall.dry.toFixed(1)}, at the inner edge ${blueEdge.dry.toFixed(1)}`);
    assert.equal(rim.holes, 0, `ratio ${ratio}: no holes along the canvas edge`);
    assert.ok(Math.abs(rim.dry - wall.dry) < 2, `ratio ${ratio}: the canvas edge dries no more than the wall`);
    assert.ok(blueEdge.dry > wall.dry + 6, `ratio ${ratio}: the inner region's edge dries`);
  }
}
