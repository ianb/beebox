// Bristle on the GPU (canvas-loop-gpu-brushes.subplan.md, chunk 7): the
// `bristles` entry's strips against the CPU runs, bristle by bristle (kinds.ts
// `paintBristle`, placed by `linMarks` and laid by mark-atlas.ts `runStrip`),
// with hue and light jitter; one-sample bristle contours as dabs; every strip
// inside the mark's box; with the buffer limit forced small, batches cut only
// between bristles, the same bytes and pixels as one batch; a bristle over the
// limit fails naming its call. `brushStability` (renderer.gpu.test.ts) moves a
// bristle stroke. One Dawn device for the file; skipped, with a message, where
// Dawn finds no adapter.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { TestContext } from "node:test";
import { bristlePoints, makeBristles } from "../../src/core/brush/render/kinds.js";
import { rand } from "../../src/core/brush/random.js";
import type { BristleBrush } from "../../src/core/brush/types.js";
import type { GpuHandle } from "../../src/device/open.js";
import { bristleBytes } from "../../src/gpu/brush-pack.js";
import type { BrushJob } from "../../src/gpu/brush-pass.js";
import type { R } from "../../src/gpu/jobs.js";
import { bristleDots, runStrip } from "../../src/gpu/mark-atlas.js";
import { gpuBox, linMarks } from "../../src/gpu/marks.js";
import { GpuRenderer } from "../../src/gpu/renderer.js";
import { RUN_FLOATS, RUN_VERTICES } from "../../src/gpu/shader-bristle.js";
import { DAB_FLOATS } from "../../src/gpu/shader-brush.js";
import { sharedGpu } from "../../src/headless/scene/surface.js";
import type { ExpandRequest, Run } from "../../src/scene/brush/expand.js";
import { BrushExpander, brushSamples, expandOnCpu } from "../../src/scene/brush/expand.js";
import { GpuRenderError } from "../../src/scene/errors.js";
import type { Mat, Scene } from "../../src/scene/nodes.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";
import { brushRequests } from "../brushes/requests.js";
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
  readonly req: ExpandRequest;
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
    return [{ req, brush: ex.set.brush, job, box, e }];
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

/**
 * A gap index (kinds.ts `Math.floor(c.s / 2.5)`) within 1e-3 of an integer
 * where the bristle is drying, and the cells on either side give different
 * gaps: f32 may take the other cell, and the level there may differ.
 */
function nearGap(s: number, a: { dryAt: number; seed: number; index: number }): boolean {
  const g = s / 2.5;
  const k = Math.round(g);
  const f = Math.min(1, Math.max(0, (s - a.dryAt * 0.7) / (a.dryAt * 0.3)));
  const dry = 1 - f * f * (3 - 2 * f);
  const gap = (cell: number): boolean => rand(a.seed, { channel: 30 + a.index, index: cell }) > dry;
  return dry < 1 && Math.abs(g - k) <= 1e-3 && gap(k) !== gap(k - 1);
}

/** kinds.ts `paintBristle`'s runs over one bristle's points: [a, z] (z included), each broken where the level changes. */
function bristleRuns(pts: readonly { level: number }[]): { a: number; z: number; level: number }[] {
  const runs: { a: number; z: number; level: number }[] = [];
  let start = 0;
  for (let j = 1; j < pts.length; j++) {
    if (pts[j]?.level !== pts[start]?.level) {
      runs.push({ a: start, z: j, level: pts[start]?.level ?? 0 });
      start = j;
    }
  }
  runs.push({ a: start, z: pts.length - 1, level: pts[start]?.level ?? 0 });
  return runs;
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

/** A stroke's one-sample contours as dabs, from the CPU expansion placed by `linMarks` (in the mark's own pixels). */
interface Dot {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly a: number;
  readonly rgb: readonly number[];
}

/**
 * Stroke `p`'s GPU strips (vertices from `first` in `f`) against the CPU's,
 * bristle by bristle; returns the vertices it covered and the CPU dots.
 */
function compareStroke(w: StripWorst, a: { p: Placed; f: Float32Array; first: number; ratio: number; where: string; fail: (m: string) => void }): { end: number; dots: Dot[] } {
  const { p } = a;
  const cpu = expandOnCpu(p.req);
  assert.ok(cpu?.kind === "marks");
  const l = linMarks(cpu, { e: p.e, ratio: a.ratio });
  assert.ok(l.kind === "tex");
  const dots: Dot[] = [];
  let unit = a.first;
  let ri = 0;
  for (const [ci, c] of (brushSamples(p.req) ?? []).entries()) {
    const n = c.samples.length;
    const d = n === 1 ? l.dabs[dots.length] : undefined;
    if (d !== undefined) dots.push({ ...d, x: d.x + p.job.offset[0], y: d.y + p.job.offset[1] });
    if (n < 2) continue;
    const input = { samples: c.samples, width: p.job.prepared.width, seed: c.seed };
    for (const [b, br] of makeBristles(input, p.brush).entries()) {
      w.bristles++;
      const excused = c.samples.some((s) => nearGap(s.s, { dryAt: br.dryAt, seed: c.seed, index: b }));
      if (excused) w.excused++;
      let differs = false;
      // An excused bristle is compared too; a difference there is counted, not failed.
      const fail = excused ? (): void => void (differs = true) : a.fail;
      for (const run of bristleRuns(bristlePoints(input, { b: br, index: b }))) {
        let want: Float32Array | undefined;
        if (run.z > run.a && run.level !== 0) {
          const rec: Run | undefined = l.runs[ri++];
          if (rec?.pts.length !== (run.z - run.a + 1) * 2) a.fail(`${a.where} contour ${ci} bristle ${b}: the derived run [${run.a}, ${run.z}] is not the CPU's recorded run ${ri - 1}`);
          if (rec === undefined) continue;
          w.runs++;
          want = new Float32Array((run.z - run.a) * RUN_VERTICES * RUN_FLOATS);
          runStrip(want, { o: 0, run: rec, local: [p.e[4], p.e[5], p.box.x0, p.box.y0], slot: p.job.slot });
        }
        const v = (unit + run.a * RUN_VERTICES) * RUN_FLOATS;
        compareRun(excused ? { ...w } : w, { got: a.f.subarray(v, v + (run.z - run.a) * RUN_VERTICES * RUN_FLOATS), want, slot: p.job.slot, where: `${a.where} contour ${ci} bristle ${b} run [${run.a}, ${run.z}]`, fail });
      }
      if (differs) w.differ++;
      unit += (n - 1) * RUN_VERTICES;
    }
  }
  if (ri !== l.runs.length) a.fail(`${a.where}: ${ri} derived runs, ${l.runs.length} recorded`);
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
 * Every GPU strip against the CPU's, bristle by bristle: the runs kinds.ts
 * draws (two or more points, a level above 0) give `runStrip`'s vertices for
 * their segments, within 2e-3 px; the segments of runs it does not draw are
 * zeros. A bristle with a gap index near an integer is excused. The derived
 * runs must be the CPU expansion's recorded runs, in order. One-sample
 * contours are compared as dabs.
 */
async function compareStrips(handle: GpuHandle, a: { reqs: readonly ExpandRequest[]; ratio: number }): Promise<StripWorst> {
  const placed = placeBristles(a.reqs, a.ratio);
  const renderer = new GpuRenderer(handle);
  const w: StripWorst = { vertices: 0, bristles: 0, excused: 0, differ: 0, runs: 0, dots: 0, pos: 0, hw: 0, alpha: 0, rgb: 0, inside: Infinity, failures: [] };
  const fail = (m: string): void => void (w.failures.length < 12 && w.failures.push(m));
  try {
    const g = await renderer.bristleStrips(placed.map((p) => p.job));
    w.vertices = g.count;
    const f = new Float32Array(g.data);
    const jobs: BrushJob[] = [];
    const refs: Dot[] = [];
    for (const [i, p] of placed.entries()) {
      const range = g.strokes[i] ?? { first: 0, count: 0 };
      const out = compareStroke(w, { p, f, first: range.first, ratio: a.ratio, where: `stroke ${i}`, fail });
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

test("the bristles entry writes the brush sheet's and the focused bristle strips as runStrip does, at ratio 1 and 2", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const cases = [["brush sheet", scene({ width: 640, height: 480 }, (v) => drawSheet(v))], ["focused", scene(BRISTLES_SIZE, drawBristles)]] as const;
  for (const [what, s] of cases) {
    for (const ratio of [1, 2]) {
      const w = await compareStrips(handle, { reqs: brushRequests(s, handle.colors), ratio });
      reportStrips(t, { w, what: `${what}, ratio ${ratio}` });
      assert.ok(w.runs > 50 && w.bristles > w.excused, "the case draws runs and compares bristles");
      if (what === "focused") assert.equal(w.dots, 2, "the two one-sample contours are dots");
    }
  }
});

test("the bristles entry gives each bristle its hue and light jitter as the CPU does", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const s = scene(BRISTLES_SIZE, drawBristleJitter);
  for (const ratio of [1, 2]) {
    const w = await compareStrips(handle, { reqs: brushRequests(s, handle.colors), ratio });
    reportStrips(t, { w, what: `jitter, ratio ${ratio}` });
    assert.equal(w.dots, 1);
  }
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
    v.line(4, 10, 12, 10, { stroke: "#000", weight: 4, brush: "bristle" });
    v.line(10, 20, 590, 30, { stroke: "#000", weight: 4, brush: "bristle" });
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
