// Ink on the GPU as capsules (canvas-loop-gpu-brushes.subplan.md, chunk 4):
// the capsule instances against the CPU samples (golden numbers recorded
// before chunk 9 deleted the CPU expansion) and the ink mark's box; the
// gate's union check against a 16×16 supersampled reference, on its synthetic
// cases and on the walker's ink in the gate's crop windows; capsules in reverse
// order; thin lines against the frozen Skia reference; a self-crossing loop.
// `brushBlends` and the ink and marker crops of `brushParity` are in
// renderer.gpu.test.ts. One Dawn device for the file; skipped, with a message,
// where Dawn finds no adapter.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { TestContext } from "node:test";
import type { TextMeasurer } from "../../src/core/text/measure.js";
import type { GpuHandle } from "../../src/device/open.js";
import { openTextMeasurer } from "../../src/device/open.js";
import type { BrushJob } from "../../src/gpu/brush-pass.js";
import type { R } from "../../src/gpu/jobs.js";
import { gpuBox } from "../../src/gpu/marks.js";
import { GpuRenderer } from "../../src/gpu/renderer.js";
import { DAB_FLOATS } from "../../src/gpu/shader-brush.js";
import { sharedGpu } from "../../src/headless/scene/surface.js";
import { BrushExpander } from "../../src/scene/brush/expand.js";
import type { Mat } from "../../src/scene/nodes.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";
import * as walkerSheet from "../../src/gallery/intra-walk-styles/sketch-tea.js";
import type { PlacedRequest } from "../brushes/requests.js";
import { brushRequests } from "../brushes/requests.js";
import { goldenSamples, goldenThinOutline } from "../brushes/golden.js";
import { frozen } from "./brush-cases.js";
import { drawSheet } from "./brush-sheet.js";
import { portFrames } from "./cache-cases.js";
import type { Capsule, UnionError } from "./capsule-union.js";
import { CELL, UNION_CASES, supersampled, unionError } from "./capsule-union.js";
import { THIN_ROWS, THIN_SIZE, drawThin, rowTone } from "./ink-sheet.js";
import { renderOnce, rgbaAt } from "./render.js";

let gpu: GpuHandle | undefined;
let text: TextMeasurer | undefined;
before(async () => {
  gpu = await sharedGpu();
  text = await openTextMeasurer();
});

function needGpu(t: TestContext): GpuHandle | undefined {
  if (gpu === undefined) t.skip("Dawn found no GPU adapter on this machine; ink not checked");
  return gpu;
}

/** An ink stroke placed as the lowering places it (ratio `ratio`, its call's translation), its slot at `slot`, positions relative to `corner` (its box's, unless given). */
interface PlacedInk {
  readonly req: PlacedRequest;
  /** The request's index in `reqs`. */
  readonly index: number;
  readonly job: BrushJob;
  readonly box: R;
}

function placeInk(reqs: readonly PlacedRequest[], at: { ratio: number; corner?: readonly [number, number]; slot?: (i: number, box: R) => readonly [number, number, number, number] }): PlacedInk[] {
  const expander = new BrushExpander({ enabled: false });
  const { ratio } = at;
  return reqs.flatMap((req, index) => {
    const ex = expander.expand(req);
    if (ex?.set.kind !== "ink") return [];
    const { q } = ex;
    const e: Mat = [ratio * q[0], ratio * q[1], ratio * q[2], ratio * q[3], ratio * req.translate[0], ratio * req.translate[1]];
    const box = gpuBox(ex.set, e);
    if (box === undefined) return [];
    const [cx, cy] = at.corner ?? [box.x0, box.y0];
    return [{ req, index, box, job: { prepared: ex.set.prepared, brush: ex.set.brush, lin: [e[0], e[1], e[2], e[3]], ratio, offset: [e[4] - cx, e[5] - cy], slot: [0, 0, box.x1 - box.x0, box.y1 - box.y0] } }];
  });
}

/** The capsules of instances [first, first + count) of `f`. */
function capsulesIn(f: Float32Array, range: { first: number; count: number }): Capsule[] {
  const out: Capsule[] = [];
  for (let k = range.first; k < range.first + range.count; k++) {
    const [ax = NaN, ay = NaN, ra = NaN, bx = NaN, by = NaN, rb = NaN] = f.subarray(k * DAB_FLOATS, k * DAB_FLOATS + 6);
    out.push([ax, ay, ra, bx, by, rb]);
  }
  return out;
}

/** Capsule instances with their slots on a page. */
function instances(cells: readonly { capsules: readonly Capsule[]; slot: readonly [number, number, number, number] }[]): Float32Array<ArrayBuffer> {
  const n = cells.reduce((a, c) => a + c.capsules.length, 0);
  const out = new Float32Array(n * DAB_FLOATS);
  let o = 0;
  for (const c of cells) {
    for (const k of c.capsules) {
      out.set([...k, 0, 0, ...c.slot], o);
      o += DAB_FLOATS;
    }
  }
  return out;
}

async function page(handle: GpuHandle, a: { data: Float32Array<ArrayBuffer>; size: { width: number; height: number } }): Promise<Uint8Array> {
  const renderer = new GpuRenderer(handle);
  return renderer.capsulePage(a.data, a.size).finally(() => renderer.destroy());
}

/** Cells of `w` × `h` in rows of `cols`: cell i's slot. */
const grid = (i: number, a: { w: number; h: number; cols: number }): [number, number, number, number] => {
  const x = (i % a.cols) * a.w;
  const y = Math.floor(i / a.cols) * a.h;
  return [x, y, x + a.w, y + a.h];
};

const thinning = (b: BrushJob["brush"]): number => (b.kind === "ink" ? b.thinning : NaN);

test("the capsules entry writes each ink segment from the CPU samples, inside the ink mark's box", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined || text === undefined) return;
  const sheet = new SceneRecorder({ width: 640, height: 480 }).record((v) => drawSheet(v)).scene;
  const [walker] = portFrames(walkerSheet, { at: [0], text });
  assert.ok(walker !== undefined);
  for (const [what, scene, name] of [["brush sheet", sheet, "sheet"], ["walker frame 0", walker, "walker"]] as const) {
    const golden = goldenSamples(name);
    const reqs = brushRequests(scene, handle.colors);
    assert.equal(golden.length, reqs.length, "the golden numbers have every stroke");
    for (const ratio of [1, 2]) {
      const placed = placeInk(reqs, { ratio });
      const renderer = new GpuRenderer(handle);
      const g = await renderer.brushInstances(placed.map((p) => p.job)).finally(() => renderer.destroy());
      const f = new Float32Array(g.data);
      let pos = 0;
      let rad = 0;
      let slack = Infinity;
      const failures: string[] = [];
      for (const [i, p] of placed.entries()) {
        const { prepared, brush, lin } = p.job;
        const size = prepared.width / (1 + thinning(brush));
        const [ox, oy] = p.job.offset;
        // The golden samples are relative to their contour's origin (brush space): mapped by lin and the offset, as the GPU places them.
        const want: Capsule[] = (golden[p.index] ?? []).flatMap((samples, c) => {
          const [cx, cy] = prepared.contours[c]?.origin ?? [NaN, NaN];
          const at = (s: { x: number; y: number; p: number }): [number, number, number] => {
            const [x, y] = [cx + s.x, cy + s.y];
            return [lin[0] * x + lin[2] * y + ox, lin[1] * x + lin[3] * y + oy, size * (0.5 - thinning(brush) * (0.5 - s.p)) * ratio];
          };
          return samples.map((s, k) => {
            const a = at(s);
            const next = samples[k + 1];
            if (next !== undefined) return [...a, ...at(next)] as const;
            return samples.length === 1 ? ([...a, ...a] as const) : ([a[0], a[1], 0, a[0], a[1], 0] as const);
          });
        });
        const range = g.strokes[i] ?? { first: 0, count: 0 };
        const got = capsulesIn(f, range);
        if (got.length !== want.length) failures.push(`stroke ${i}: ${got.length} capsules on the GPU, ${want.length} samples on the CPU`);
        const [w, h] = [p.box.x1 - p.box.x0, p.box.y1 - p.box.y0];
        for (const [k, c] of got.entries()) {
          const o = want[k];
          if (o === undefined) break;
          const dp = Math.max(Math.hypot(c[0] - o[0], c[1] - o[1]), c[2] > 0 ? Math.hypot(c[3] - o[3], c[4] - o[4]) : 0);
          const dr = Math.max(Math.abs(c[2] - o[2]), Math.abs(c[5] - o[5]));
          [pos, rad] = [Math.max(pos, dp), Math.max(rad, dr)];
          if (!(dp <= 2e-3 && dr <= 1e-4) && failures.length < 12) failures.push(`stroke ${i} capsule ${k}: ${c.join(", ")} against ${o.join(", ")}`);
          // A capsule's quad reaches each end's radius plus one pixel.
          if (Math.max(c[2], c[5]) > 0) slack = Math.min(slack, Math.min(c[0] - c[2], c[3] - c[5], c[1] - c[2], c[4] - c[5], w - c[0] - c[2], w - c[3] - c[5], h - c[1] - c[2], h - c[4] - c[5]) - 1);
        }
      }
      t.diagnostic(`${what}, ratio ${ratio}: ${placed.length} ink strokes, ${g.count} capsules; largest end difference ${pos.toExponential(2)} device px, radius ${rad.toExponential(2)}; the nearest quad comes within ${slack.toFixed(2)} px of its box`);
      assert.deepEqual(failures, []);
      assert.ok(slack >= 0, "every capsule's quad lies inside its mark's box");
    }
  }
});

/** The union errors the ink gate measured on its f64 prototype (scratch/stage5/brushes/gate/union.json, union-walker.json); the GPU's own are checked near them. */
const MEASURED = { cases: { mean: 0.0218, max: 0.4468 }, walker: { mean: 0.0172, max: 0.399 } } as const;

test("capsule ink against a 16×16 supersampled union: the gate's cases", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const cols = 9;
  const cells = UNION_CASES.map((c, i) => ({ capsules: c.capsules, slot: grid(i, { w: CELL, h: CELL, cols }) }));
  const size = { width: cols * CELL, height: Math.ceil(cells.length / cols) * CELL };
  const alpha = await page(handle, { data: instances(cells), size });
  const all: UnionError = { sum: 0, n: 0, max: 0 };
  const groups = new Map<string, UnionError>();
  for (const [i, c] of UNION_CASES.entries()) {
    const [sx, sy] = grid(i, { w: CELL, h: CELL, cols });
    const ref = supersampled(c.capsules, { w: CELL, h: CELL });
    const g = groups.get(c.group) ?? { sum: 0, n: 0, max: 0 };
    const at = (k: number): number => (alpha[(sy + Math.floor(k / CELL)) * size.width + sx + (k % CELL)] ?? 0) / 255;
    unionError(at, { ref, into: g });
    unionError(at, { ref, into: all });
    groups.set(c.group, g);
  }
  for (const [name, g] of groups) t.diagnostic(`${name}: mean edge error ${(g.sum / g.n).toFixed(4)} over ${g.n} px, worst pixel ${g.max.toFixed(4)}`);
  const mean = all.sum / all.n;
  t.diagnostic(`${UNION_CASES.length} cases: mean edge error ${mean.toFixed(4)} (gate ${MEASURED.cases.mean}), worst pixel ${all.max.toFixed(4)} (gate ${MEASURED.cases.max})`);
  // The plan's pass: a mean edge error under 0.05, and the gate's measured mean, allowing for 8-bit coverage.
  assert.ok(mean < 0.05 && mean <= MEASURED.cases.mean + 0.003, `mean edge error ${mean}`);
  // The plan's worst-pixel limit (0.25) is not met at near-reversing bends and subpixel crossings, where max() of
  // two partial coverages falls short of the union; the boxholder waived it on visual judgement at the gate.
  // This bound holds the worst pixel near the gate's measurement instead.
  assert.ok(all.max <= MEASURED.cases.max + 0.01, `worst pixel ${all.max}`);
});

// The gate's crop windows on the walker's frame 0 at ratio 2 (device px): x0, y0, width, height.
const WINDOWS = { head: [1560, 108, 64, 64], hand: [1656, 196, 48, 48], foot: [1640, 376, 68, 56], limb: [1560, 252, 112, 164], short: [1594, 128, 24, 20] } as const;

test("capsule ink against a 16×16 supersampled union: the walker's ink in the gate's crop windows", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined || text === undefined) return;
  const [walker] = portFrames(walkerSheet, { at: [0], text });
  assert.ok(walker !== undefined);
  const reqs = brushRequests(walker, handle.colors);
  const all: UnionError = { sum: 0, n: 0, max: 0 };
  for (const [name, [x0, y0, w, h]] of Object.entries(WINDOWS)) {
    // Each ink mark that reaches the window, on its own (as the gate measured it), in its own cell.
    const near = placeInk(reqs, { ratio: 2 }).filter((p) => p.box.x1 > x0 && p.box.x0 < x0 + w && p.box.y1 > y0 && p.box.y0 < y0 + h);
    const cols = Math.ceil(Math.sqrt(near.length));
    const placed = placeInk(near.map((p) => p.req), { ratio: 2, corner: [x0, y0] }).map((p, i) => ({ ...p, job: { ...p.job, slot: grid(i, { w, h, cols }) } }));
    const renderer = new GpuRenderer(handle);
    const g = await renderer.brushInstances(placed.map((p) => p.job)).finally(() => renderer.destroy());
    const f = new Float32Array(g.data);
    const size = { width: cols * w, height: Math.ceil(placed.length / cols) * h };
    const alpha = await page(handle, { data: new Float32Array(f), size });
    const e: UnionError = { sum: 0, n: 0, max: 0 };
    for (const [i, p] of placed.entries()) {
      const [sx, sy] = p.job.slot;
      const ref = supersampled(capsulesIn(f, g.strokes[i] ?? { first: 0, count: 0 }), { w, h });
      const at = (k: number): number => (alpha[(sy + Math.floor(k / w)) * size.width + sx + (k % w)] ?? 0) / 255;
      unionError(at, { ref, into: e });
      unionError(at, { ref, into: all });
    }
    t.diagnostic(`${name}: ${placed.length} ink marks, mean edge error ${(e.sum / e.n).toFixed(4)} over ${e.n} px, worst pixel ${e.max.toFixed(4)}`);
  }
  const mean = all.sum / all.n;
  t.diagnostic(`walker crops: mean edge error ${mean.toFixed(4)} (gate ${MEASURED.walker.mean}), worst pixel ${all.max.toFixed(4)} (gate ${MEASURED.walker.max}, with the gate's synthetic dots)`);
  assert.ok(mean < 0.05 && mean <= MEASURED.walker.mean + 0.003, `mean edge error ${mean}`);
  // The worst-pixel limit is waived as above; held near the gate's measurement.
  assert.ok(all.max <= MEASURED.walker.max + 0.01, `worst pixel ${all.max}`);
});

test("the same capsules in reverse order give the same bytes", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  // Every gate case's capsules drawn into one shared cell, so capsules of different cases overlap too.
  const data = instances(UNION_CASES.map((c) => ({ capsules: c.capsules, slot: [0, 0, CELL, CELL] as const })));
  const reversed = new Float32Array(data.length);
  const n = data.length / DAB_FLOATS;
  for (let k = 0; k < n; k++) reversed.set(data.subarray(k * DAB_FLOATS, (k + 1) * DAB_FLOATS), (n - 1 - k) * DAB_FLOATS);
  const size = { width: CELL, height: CELL };
  const a = await page(handle, { data, size });
  const b = await page(handle, { data: reversed, size });
  t.diagnostic(`${n} capsules over one ${CELL}×${CELL} cell; ${a.filter((v) => v > 0).length} pixels covered`);
  assert.ok(Buffer.from(a).equals(Buffer.from(b)));
});

test("thin ink lines (0.6 and 1.0 px) keep their tone, row by row, within 3%", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const got = await renderOnce(handle, { size: THIN_SIZE, draw: (v) => drawThin(v) });
  const ref = await frozen("ink-thin", THIN_SIZE);
  // perfect-freehand's outlines, filled by exact area (the GPU renderer's ink before chunk 4), each stroke over the last: golden numbers.
  const outlines = goldenThinOutline(THIN_ROWS.length);
  const rows = THIN_ROWS.map((r, i) => {
    const skia = rowTone(ref, r);
    const outline = outlines[i] ?? NaN;
    const gpuTone = rowTone(got.data, r);
    return { name: r.name, skia, outline, gpu: gpuTone, offSkia: (100 * Math.abs(gpuTone - skia)) / skia, offOutline: (100 * Math.abs(gpuTone - outline)) / outline };
  });
  for (const r of rows) t.diagnostic(`${r.name}: tone ${r.gpu.toFixed(3)}; Skia ${r.skia.toFixed(3)} (${r.offSkia.toFixed(2)}% off); perfect-freehand's outline by exact area ${r.outline.toFixed(3)} (${r.offOutline.toFixed(2)}% off)`);
  // Against perfect-freehand's outline by exact area: every row within 3%.
  assert.deepEqual(rows.filter((r) => !(r.offOutline <= 3)).map((r) => r.name), []);
  // Against the frozen Skia render: the 1.0 px rows within 3%. Skia's antialiasing samples a pixel at 4 × 4 points,
  // which loses tone on lines under one pixel wide: perfect-freehand's outline sampled that way gives Skia's tone, by exact area
  // 7% more (scratch/stage5/b4/thin.log). The 0.6 px rows are held within 8% of Skia.
  assert.deepEqual(rows.filter((r) => !(r.offSkia <= (r.name.startsWith("width 1,") ? 3 : 8))).map((r) => r.name), []);
});

test("a self-crossing ink loop is no darker where it crosses itself", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const size = { width: 120, height: 120 };
  for (const [what, style] of [["half-alpha ink", { stroke: "rgba(29,42,68,0.5)", weight: 6, brush: "ink" }], ["marker (no grain)", { stroke: "#2f7bbf", weight: 6, brush: { preset: "marker", grain: 0 } }]] as const) {
    // A closed bowtie: its sides cross at (60, 60).
    const px = await renderOnce(handle, { size, draw: (v) => [v.background("#f4efe2"), v.polygon([[20, 20], [100, 100], [100, 20], [20, 100]], { ...style, gesture: { pressure: "even" } })] });
    const lum = (at: readonly [number, number]): number => {
      const [r = 0, g = 0, b = 0] = rgbaAt(px, at);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const body = lum([40, 40]);
    let darkest = Infinity;
    for (let y = 50; y <= 70; y++) for (let x = 50; x <= 70; x++) darkest = Math.min(darkest, lum([x, y]));
    t.diagnostic(`${what}: luminance ${lum([60, 60]).toFixed(1)} at the crossing, ${body.toFixed(1)} along a side; darkest near the crossing ${darkest.toFixed(1)}`);
    assert.deepEqual(rgbaAt(px, [60, 60]), rgbaAt(px, [40, 40]), `${what}: the crossing takes the side's colour`);
    assert.ok(darkest >= body, `${what}: no pixel near the crossing is darker than the side`);
  }
});

test("a far contour of the same ink stroke does not move a near one (per-contour f32 coordinates)", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  // At x = 67108864, f32 steps by 8: a near contour stored relative to it would land up to 4 px off.
  const scene = new SceneRecorder({ width: 40, height: 40 }).record((v) => {
    return v.path([["move", 67108864, 20], ["line", 67108864, 20], ["move", 10.25, 20], ["line", 10.25, 20]], { stroke: "#000", weight: 2, brush: "ink", gesture: { pressure: "even" } });
  }).scene;
  const [p] = placeInk(brushRequests(scene, handle.colors), { ratio: 1 });
  assert.ok(p !== undefined);
  const renderer = new GpuRenderer(handle);
  const g = await renderer.brushInstances([p.job]).finally(() => renderer.destroy());
  const caps = capsulesIn(new Float32Array(g.data), { first: 0, count: g.count });
  assert.equal(caps.length, 2, "one disc per contour");
  const [far, near] = caps.map((c) => c[0] + p.box.x0);
  t.diagnostic(`box x0 ${p.box.x0}; disc centres at device x ${far} and ${near}`);
  assert.ok(Math.abs((near ?? NaN) - 10.25) <= 2e-3, `the near disc lands at x 10.25 (got ${near})`);
  assert.equal(far, 67108864);
});
