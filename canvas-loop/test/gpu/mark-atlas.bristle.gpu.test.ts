// Bristle on the GPU (canvas-loop-gpu-brushes.subplan.md, chunk 7): the
// `bristles` entry's strips against the CPU runs, bristle by bristle (golden
// numbers recorded before chunk 9 deleted the CPU expansion: kinds.ts
// `paintBristle`'s runs and mark-atlas.ts `runStrip`'s mitred sides), with hue
// and light jitter; one-sample bristle contours as dabs; every strip
// inside the mark's box; with the buffer limit forced small, batches cut only
// between bristles, the same bytes and pixels as one batch; a bristle over the
// limit fails naming its call. `brushStability` (renderer.gpu.test.ts) moves a
// bristle stroke. One Dawn device for the file; skipped, with a message, where
// Dawn finds no adapter.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { TestContext } from "node:test";
import type { BristleBrush } from "../../src/core/brush/types.js";
import type { GpuHandle } from "../../src/device/open.js";
import { bristleBytes } from "../../src/gpu/brush-pack.js";
import type { BrushJob } from "../../src/gpu/brush-pass.js";
import type { R } from "../../src/gpu/jobs.js";
import { bristleDots } from "../../src/gpu/mark-atlas.js";
import { gpuBox } from "../../src/gpu/marks.js";
import { GpuRenderer } from "../../src/gpu/renderer.js";
import { RUN_FLOATS, RUN_VERTICES } from "../../src/gpu/shader-bristle.js";
import { DAB_FLOATS } from "../../src/gpu/shader-brush.js";
import { sharedGpu } from "../../src/headless/scene/surface.js";
import type { ExpandRequest } from "../../src/scene/brush/expand.js";
import { BrushExpander } from "../../src/scene/brush/expand.js";
import { GpuRenderError } from "../../src/scene/errors.js";
import type { Mat, Scene } from "../../src/scene/nodes.js";
import type { Drawing } from "../../src/core/tea.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";
import { brushRequests } from "../brushes/requests.js";
import type { GoldenBristleContour, GoldenRun } from "../brushes/golden.js";
import { goldenBristles } from "../brushes/golden.js";
import { drawSheet } from "./brush-sheet.js";
import { BRISTLES_SIZE, drawBristleJitter, drawBristles } from "./bristles.js";

let gpu: GpuHandle | undefined;
before(async () => {
  gpu = await sharedGpu();
});

function needGpu(t: TestContext): GpuHandle | undefined {
  if (gpu === undefined) t.skip("Dawn found no GPU adapter on this machine; the bristle pass not checked");
  return gpu;
}

interface Placed {
  readonly brush: BristleBrush;
  readonly job: BrushJob;
  readonly box: R;
  readonly e: Mat;
}

/** Bristle strokes placed as the lowering places them (brush-space q times the ratio, a fractional translation). */
function placeBristles(reqs: readonly ExpandRequest[], ratio: number): Placed[] {
  const expander = new BrushExpander({ enabled: false });
  return reqs.flatMap((req, i) => {
    const ex = expander.expand(req);
    if (ex?.set.kind !== "bristle") return [];
    const { q } = ex;
    const e: Mat = [ratio * q[0], ratio * q[1], ratio * q[2], ratio * q[3], 13.25 + i * 0.37, 7.5 + i * 0.11];
    const box = gpuBox(ex.set, e);
    if (box === undefined) return [];
    const job: BrushJob = { prepared: ex.set.prepared, brush: ex.set.brush, lin: [e[0], e[1], e[2], e[3]], ratio, offset: [e[4] - box.x0, e[5] - box.y0], slot: [3, 5, 3 + box.x1 - box.x0, 5 + box.y1 - box.y0] };
    return [{ brush: ex.set.brush, job, box, e }];
  });
}

interface StripWorst {
  vertices: number;
  bristles: number;
  excused: number;
  /** Excused bristles whose strips differ from the CPU's. */
  differ: number;
  runs: number;
  dots: number;
  pos: number;
  hw: number;
  alpha: number;
  rgb: number;
  inside: number;
  failures: string[];
}

/** A strip quad's two triangles, as offsets into a run's per-point [left x, left y, right x, right y] sides: (L_i, R_i, L_i+1), (L_i+1, R_i, R_i+1). */
const TRIS = [[0, 2, 4], [4, 2, 6]] as const;

/**
 * A drawn run's strip vertices as mark-atlas.ts `runStrip` wrote them, from
 * its golden sides: per segment two triangles, each vertex its corner placed
 * by the slot, the half width, the colour and alpha, the slot, the
 * triangle's corners and their signed distances across (± the half width
 * plus one pixel).
 */
function stripOf(run: GoldenRun & { drawn: true }, slot: readonly number[]): Float32Array {
  const { sides, hw } = run;
  const e = hw + 1;
  const [sx = 0, sy = 0] = slot;
  const segs = run.z - run.a;
  const out = new Float32Array(segs * RUN_VERTICES * RUN_FLOATS);
  let o = 0;
  for (let i = 0; i < segs; i++) {
    for (const tri of TRIS) {
      const corners = tri.flatMap((t) => [sides[i * 4 + t] ?? NaN, sides[i * 4 + t + 1] ?? NaN]);
      const us = tri.map((t) => (t % 4 === 0 ? e : -e));
      for (const t of tri) {
        out.set([(sides[i * 4 + t] ?? NaN) + sx, (sides[i * 4 + t + 1] ?? NaN) + sy, hw, 0, ...run.rgb, run.alpha, ...slot, ...corners, ...us], o);
        o += RUN_FLOATS;
      }
    }
  }
  return out;
}

/** One run's GPU vertices (`got`, its segments' six each) against `runStrip`'s (`want`), or zeros where the run is not drawn. */
function compareRun(w: StripWorst, a: { got: Float32Array; want: Float32Array | undefined; slot: readonly number[]; where: string; fail: (m: string) => void }): void {
  const { got, want } = a;
  if (want === undefined) {
    if (got.some((v) => v !== 0)) a.fail(`${a.where}: an undrawn run's segments are not zeros`);
    return;
  }
  const [sx0 = 0, sy0 = 0, sx1 = 0, sy1 = 0] = a.slot;
  for (let k = 0; k * RUN_FLOATS < got.length; k++) {
    const o = k * RUN_FLOATS;
    const at = (j: number): number => Math.abs((got[o + j] ?? NaN) - (want[o + j] ?? NaN));
    const dp = Math.max(...[0, 1, 12, 13, 14, 15, 16, 17].map(at));
    const dh = Math.max(...[2, 18, 19, 20].map(at));
    const dc = Math.max(...[4, 5, 6].map(at));
    [w.pos, w.hw, w.alpha, w.rgb] = [Math.max(w.pos, dp), Math.max(w.hw, dh), Math.max(w.alpha, at(7)), Math.max(w.rgb, dc)];
    const [x = NaN, y = NaN] = got.subarray(o, o + 2);
    w.inside = Math.min(w.inside, x - sx0, y - sy0, sx1 - x, sy1 - y);
    const exact = [3, 8, 9, 10, 11, 21, 22, 23].every((j) => got[o + j] === want[o + j]);
    if (!(dp <= 2e-3 && dh <= 1e-4 && at(7) <= 1e-6 && dc <= 1 / 255 + 1e-6 && exact)) {
      const show = (v: Float32Array): string => [...v.subarray(o, o + RUN_FLOATS)].map((n) => n.toFixed(4)).join(",");
      a.fail(`${a.where} vertex ${k}: [${show(got)}] against [${show(want)}]`);
    }
  }
}

/** A stroke's one-sample contours as dabs, golden, placed as the lowering places them (in the mark's own pixels). */
interface Dot {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly a: number;
  readonly rgb: readonly number[];
}

/**
 * Stroke `p`'s GPU strips (vertices from `first` in `f`) against its golden
 * contours, bristle by bristle; returns the vertices it covered and the
 * golden dots, placed.
 */
function compareStroke(w: StripWorst, a: { p: Placed; golden: readonly GoldenBristleContour[]; f: Float32Array; first: number; ratio: number; where: string; fail: (m: string) => void }): { end: number; dots: Dot[] } {
  const { p } = a;
  const { prepared, offset } = p.job;
  const dots: Dot[] = [];
  let unit = a.first;
  if (a.golden.length !== prepared.contours.length) a.fail(`${a.where}: ${prepared.contours.length} contours, ${a.golden.length} golden`);
  for (const [ci, c] of a.golden.entries()) {
    const pc = prepared.contours[ci];
    if (pc?.count !== c.n) a.fail(`${a.where} contour ${ci}: ${pc?.count} samples prepared, ${c.n} golden`);
    if (c.dot !== undefined) {
      const [x, y] = [(pc?.origin[0] ?? NaN) + c.dot.x, (pc?.origin[1] ?? NaN) + c.dot.y];
      const { e } = p;
      dots.push({ ...c.dot, x: e[0] * x + e[2] * y + offset[0], y: e[1] * x + e[3] * y + offset[1], r: c.dot.r * a.ratio });
      continue;
    }
    if (c.n < 2) continue;
    for (const [b, br] of c.bristles.entries()) {
      w.bristles++;
      if (br.excused) w.excused++;
      let differs = false;
      // An excused bristle is compared too; a difference there is counted, not failed.
      const fail = br.excused ? (): void => void (differs = true) : a.fail;
      for (const run of br.runs) {
        if (run.drawn) w.runs++;
        const v = (unit + run.a * RUN_VERTICES) * RUN_FLOATS;
        compareRun(br.excused ? { ...w } : w, { got: a.f.subarray(v, v + (run.z - run.a) * RUN_VERTICES * RUN_FLOATS), want: run.drawn ? stripOf(run, p.job.slot) : undefined, slot: p.job.slot, where: `${a.where} contour ${ci} bristle ${b} run [${run.a}, ${run.z}]`, fail });
      }
      if (differs) w.differ++;
      unit += (c.n - 1) * RUN_VERTICES;
    }
  }
  return { end: unit, dots };
}

/** The GPU's dots (`dabs` entry, from `bristleDots`) against the CPU's. */
async function compareDots(w: StripWorst, a: { renderer: GpuRenderer; jobs: readonly BrushJob[]; refs: readonly Dot[]; fail: (m: string) => void }): Promise<void> {
  w.dots = a.refs.length;
  if (a.jobs.length === 0) return;
  const d = await a.renderer.brushInstances(a.jobs);
  const df = new Float32Array(d.data);
  if (d.count !== a.refs.length) a.fail(`${d.count} dots on the GPU, ${a.refs.length} on the CPU`);
  for (const [k, ref] of a.refs.entries()) {
    const [x = NaN, y = NaN, r = NaN, al = NaN, soft, cr = NaN, cg = NaN, cb = NaN] = df.subarray(k * DAB_FLOATS, (k + 1) * DAB_FLOATS);
    const dc = Math.max(Math.abs(cr - (ref.rgb[0] ?? NaN)), Math.abs(cg - (ref.rgb[1] ?? NaN)), Math.abs(cb - (ref.rgb[2] ?? NaN)));
    w.rgb = Math.max(w.rgb, dc);
    if (!(Math.hypot(x - ref.x, y - ref.y) <= 2e-3 && Math.abs(r - ref.r) <= 1e-4 && Math.abs(al - ref.a) <= 1e-6 && soft === 0 && dc <= 1 / 255 + 1e-6)) a.fail(`dot ${k}: (${x}, ${y}) r ${r} a ${al} rgb ${cr},${cg},${cb} against (${ref.x}, ${ref.y}) r ${ref.r} a ${ref.a} rgb ${ref.rgb.join(",")}`);
  }
}

/**
 * Every GPU strip against the CPU's (golden file `bristles-<golden>`),
 * bristle by bristle: the runs kinds.ts drew (two or more points, a level
 * above 0) give `runStrip`'s vertices for their segments, within 2e-3 px; the
 * segments of runs it did not draw are zeros. A bristle with a gap index near
 * an integer is excused: kinds.ts `Math.floor(s / 2.5)` within 1e-3 of an
 * integer where the bristle is drying, and the cells on either side give
 * different gaps, so f32 may take the other cell, and the level there may
 * differ. One-sample contours are compared as dabs.
 */
async function compareStrips(handle: GpuHandle, a: { reqs: readonly ExpandRequest[]; ratio: number; golden: string }): Promise<StripWorst> {
  const placed = placeBristles(a.reqs, a.ratio);
  const golden = goldenBristles(a.golden);
  const renderer = new GpuRenderer(handle);
  const w: StripWorst = { vertices: 0, bristles: 0, excused: 0, differ: 0, runs: 0, dots: 0, pos: 0, hw: 0, alpha: 0, rgb: 0, inside: Infinity, failures: [] };
  const fail = (m: string): void => void (w.failures.length < 12 && w.failures.push(m));
  try {
    const g = await renderer.bristleStrips(placed.map((p) => p.job));
    w.vertices = g.count;
    const f = new Float32Array(g.data);
    const jobs: BrushJob[] = [];
    const refs: Dot[] = [];
    assert.equal(golden.length, placed.length, "the golden numbers have every bristle stroke");
    for (const [i, p] of placed.entries()) {
      const range = g.strokes[i] ?? { first: 0, count: 0 };
      const out = compareStroke(w, { p, golden: golden[i] ?? [], f, first: range.first, ratio: a.ratio, where: `stroke ${i}`, fail });
      if (out.end !== range.first + range.count) fail(`stroke ${i}: ${range.count} vertices on the GPU, ${out.end - range.first} derived`);
      refs.push(...out.dots);
      const dots = bristleDots(p.job, p.brush);
      if (dots !== undefined) jobs.push(dots);
    }
    await compareDots(w, { renderer, jobs, refs, fail });
  } finally {
    renderer.destroy();
  }
  return w;
}

function reportStrips(t: TestContext, a: { w: StripWorst; what: string }): void {
  const { w, what } = a;
  t.diagnostic(`${what}: ${w.vertices} vertices, ${w.bristles} bristles (${w.excused} excused, of which ${w.differ} differ), ${w.runs} runs, ${w.dots} dots; largest position difference ${w.pos.toExponential(2)} px, half width and across ${w.hw.toExponential(2)}, alpha ${w.alpha.toExponential(2)}, RGB ${(w.rgb * 255).toFixed(3)}/255; nearest vertex ${w.inside.toFixed(2)} px inside its slot`);
  assert.deepEqual(w.failures, []);
  assert.ok(w.inside >= 0, "every strip vertex lies inside its mark's slot");
}

const scene = (size: { width: number; height: number }, draw: Parameters<SceneRecorder["record"]>[0]): Scene => new SceneRecorder(size).record(draw).scene;

test("the bristles entry writes the brush sheet's and the focused bristle strips as the CPU did, at ratio 1 and 2", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const cases = [["brush sheet", scene({ width: 640, height: 480 }, (v) => drawSheet(v)), "sheet"], ["focused", scene(BRISTLES_SIZE, drawBristles), "focused"]] as const;
  for (const [what, s, golden] of cases) {
    for (const ratio of [1, 2]) {
      const w = await compareStrips(handle, { reqs: brushRequests(s, handle.colors), ratio, golden: `${golden}-r${ratio}` });
      reportStrips(t, { w, what: `${what}, ratio ${ratio}` });
      assert.ok(w.runs > 50 && w.bristles > w.excused, "the case draws runs and compares bristles");
      if (what === "focused") assert.equal(w.dots, 2, "the two one-sample contours are dots");
    }
  }
});

test("the bristles entry gives each bristle its hue and light jitter as the CPU did", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  // Recorded at ratio 1 only: the colours do not depend on the ratio.
  const w = await compareStrips(handle, { reqs: brushRequests(scene(BRISTLES_SIZE, drawBristleJitter), handle.colors), ratio: 1, golden: "jitter-r1" });
  reportStrips(t, { w, what: "jitter, ratio 1" });
  assert.equal(w.dots, 1);
});

/** The smallest buffer limit (a multiple of 256 bytes) that holds every bristle's strip and every contour's inputs. */
function bristleLimit(jobs: readonly BrushJob[]): number {
  const bytes = Math.max(...jobs.flatMap((j) => j.prepared.contours.map((c) => Math.max(bristleBytes(c.count), c.geom.length * 4, (4 + 16 + 24) * 4))));
  return Math.ceil(bytes / 256) * 256;
}

test("with the buffer limit forced small, bristle batches split only between bristles and write the same bytes", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const reqs = [...brushRequests(scene({ width: 640, height: 480 }, (v) => drawSheet(v)), handle.colors), ...brushRequests(scene(BRISTLES_SIZE, drawBristles), handle.colors)];
  for (const ratio of [1, 2]) {
    const jobs = placeBristles(reqs, ratio).map((p) => p.job);
    const limit = bristleLimit(jobs);
    const whole = new GpuRenderer(handle);
    const split = new GpuRenderer(handle, { brushLimit: limit });
    try {
      const [a, b] = [await whole.bristleStrips(jobs), await split.bristleStrips(jobs)];
      // Each bristle's first vertex: where a batch may begin.
      const starts = new Set<number>();
      let crossed = 0;
      for (const [i, j] of jobs.entries()) {
        let v = b.strokes[i]?.first ?? 0;
        const nb = j.brush.kind === "bristle" ? Math.round(j.brush.bristles) : 0;
        for (const c of j.prepared.contours) {
          if (c.count < 2) continue;
          const per = (c.count - 1) * RUN_VERTICES;
          const batchOf = (x: number): number => b.plan.findIndex((p) => x >= p.first && x < p.first + p.count);
          if (batchOf(v) !== batchOf(v + nb * per - 1)) crossed++;
          for (let k = 0; k < nb; k++, v += per) starts.add(v);
        }
      }
      t.diagnostic(`ratio ${ratio}: ${jobs.length} strokes, ${a.count} vertices; limit ${limit} bytes: ${b.inputs} input buffers, ${b.batches} batches (unsplit ${a.batches}); ${crossed} contours' bristles in more than one batch`);
      assert.equal(a.batches, 1);
      assert.ok(b.batches > 1);
      assert.ok(crossed > 0, "a contour's bristles split between batches");
      assert.deepEqual(b.plan.filter((p) => !starts.has(p.first)), [], "every batch begins at a bristle");
      assert.deepEqual(b.strokes, a.strokes);
      assert.ok(Buffer.from(b.data).equals(Buffer.from(a.data)), "the same bytes, split and unsplit");
    } finally {
      whole.destroy();
      split.destroy();
    }
  }
});

test("with the buffer limit forced small, bristle frames draw the same pixels over several batches", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const cases = [["brush sheet", scene({ width: 640, height: 480 }, (v) => drawSheet(v))], ["focused", scene(BRISTLES_SIZE, drawBristles)], ["jitter", scene(BRISTLES_SIZE, drawBristleJitter)]] as const;
  for (const [what, s] of cases) {
    const reqs = brushRequests(s, handle.colors);
    const limit = Math.max(bristleLimit(placeBristles(reqs, 2).map((p) => p.job)), 1024);
    const whole = new GpuRenderer(handle);
    const split = new GpuRenderer(handle, { brushLimit: limit });
    try {
      for (const ratio of [1, 2]) {
        const a = await whole.render(s, ratio);
        const batches = whole.stats.brushBatches;
        const b = await split.render(s, ratio);
        t.diagnostic(`${what}, ratio ${ratio}: ${batches} batches unsplit; ${split.stats.brushBatches} at ${limit} bytes`);
        assert.ok(split.stats.brushBatches > batches);
        assert.ok(Buffer.from(b.data).equals(Buffer.from(a.data)), `${what}, ratio ${ratio}: the same pixels, split and unsplit`);
      }
    } finally {
      whole.destroy();
      split.destroy();
    }
  }
});

test("a bristle larger than one buffer fails, naming its call", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const s = scene({ width: 600, height: 40 }, (v) => {
    return [
      v.line(4, 10, 12, 10, { stroke: "#000", weight: 4, brush: "bristle" }),
      v.line(10, 20, 590, 30, { stroke: "#000", weight: 4, brush: "bristle" }),
    ];
  });
  const renderer = new GpuRenderer(handle, { brushLimit: 16384 });
  try {
    await assert.rejects(renderer.render(s, 1), (e: unknown) => {
      assert.ok(e instanceof GpuRenderError);
      t.diagnostic(e.message);
      assert.equal(e.path, "line #2");
      assert.match(e.message, /a bristle of \d+ samples needs .* of strip vertices/);
      return true;
    });
  } finally {
    renderer.destroy();
  }
});

test("a one-sample bristle dot far below 0.05 brush px is drawn at a high pixel ratio, as the CPU drew it", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  // Weight 0.1, even pressure: radius 0.05 brush px, 1.6 device px at ratio 32. The stamp rule would skip it.
  const draw = (v: Parameters<Parameters<SceneRecorder["record"]>[0]>[0]): Drawing => v.line(5, 5, 5, 5, { stroke: "#000", weight: 0.1, brush: "bristle", gesture: { pressure: "even" } });
  const s = scene({ width: 10, height: 10 }, draw);
  const w = await compareStrips(handle, { reqs: brushRequests(s, handle.colors), ratio: 32, golden: "dot-r32" });
  reportStrips(t, { w, what: "dot, ratio 32" });
  assert.equal(w.dots, 1);
  const renderer = new GpuRenderer(handle);
  try {
    // The canvas has no background: alpha there is the dot's.
    const px = await renderer.render(s, 32);
    const at = (160 * px.width + 160) * 4 + 3;
    t.diagnostic(`alpha at the dot's centre: ${px.data[at]}`);
    assert.ok((px.data[at] ?? 0) > 0, "the dot is drawn");
  } finally {
    renderer.destroy();
  }
});
