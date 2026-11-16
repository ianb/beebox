// Smudge and wet from GPU samples (canvas-loop-gpu-brushes.subplan.md, chunk
// 8): the `smears` entry's dabs against the CPU expansion's (golden numbers
// recorded before chunk 9 deleted it), placed as the lowering placed them; a
// smear is one batch, so a frame with the buffer limit forced small draws the
// same pixels; a smear over the limit fails naming its call. The smear crops of `brushParity` and
// `smudgeAcrossTiles` are in renderer.gpu.test.ts. One Dawn device for the
// file; skipped, with a message, where Dawn finds no adapter.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { TestContext } from "node:test";
import type { SmearBrush } from "../../src/core/brush/types.js";
import type { GpuHandle } from "../../src/device/open.js";
import type { BrushJob } from "../../src/gpu/brush-pass.js";
import { GpuRenderer } from "../../src/gpu/renderer.js";
import { DAB_FLOATS } from "../../src/gpu/shader-brush.js";
import { sharedGpu } from "../../src/headless/scene/surface.js";
import { BrushExpander } from "../../src/scene/brush/expand.js";
import { GpuRenderError } from "../../src/scene/errors.js";
import type { Scene } from "../../src/scene/nodes.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";
import { brushRequests } from "../brushes/requests.js";
import { goldenSmears } from "../brushes/golden.js";
import type { PlacedRequest } from "../brushes/requests.js";
import { SMEARS_SIZE, drawSmears } from "./smears.js";

let gpu: GpuHandle | undefined;
before(async () => {
  gpu = await sharedGpu();
});

function needGpu(t: TestContext): GpuHandle | undefined {
  if (gpu === undefined) t.skip("Dawn found no GPU adapter on this machine; the smear dabs not checked");
  return gpu;
}

/** The smear sheet with a rotated, scaled smudge and a wet stroke of two contours (one a single sample) added. */
function smearScene(): Scene {
  return new SceneRecorder(SMEARS_SIZE).record(drawSmears).scene;
}

interface DabWorst {
  dabs: number;
  pos: number;
  r: number;
  a: number;
  failures: string[];
}

/** Each smear stroke's GPU dabs against the golden CPU dabs (brush space, placed by `e` with the layer's corner `corner`). */
async function compareSmears(handle: GpuHandle, a: { reqs: readonly PlacedRequest[]; ratio: number; corner: readonly [number, number] }): Promise<DabWorst> {
  const expander = new BrushExpander({ enabled: false });
  const renderer = new GpuRenderer(handle);
  const w: DabWorst = { dabs: 0, pos: 0, r: 0, a: 0, failures: [] };
  const fail = (m: string): void => void (w.failures.length < 12 && w.failures.push(m));
  const golden = goldenSmears();
  let si = 0;
  try {
    for (const [i, req] of a.reqs.entries()) {
      const ex = expander.expand(req);
      if (ex?.set.kind !== "smear") continue;
      const gold = golden[si++] ?? [];
      const { q } = ex;
      const e = [a.ratio * q[0], a.ratio * q[1], a.ratio * q[2], a.ratio * q[3], req.translate[0] * a.ratio + 0.37, req.translate[1] * a.ratio + 0.11] as const;
      const brush: SmearBrush = ex.set.brush;
      const job: BrushJob = { prepared: ex.set.prepared, brush, lin: [e[0], e[1], e[2], e[3]], ratio: a.ratio, offset: [e[4] - a.corner[0], e[5] - a.corner[1]], slot: [0, 0, 0, 0] };
      const g = await renderer.smearDabs(job);
      if (g.batches !== 1) fail(`stroke ${i}: ${g.batches} batches`);
      const f = new Float32Array(g.data);
      assert.equal(gold.length, job.prepared.contours.length);
      const want = gold.flatMap((c, ci) => {
        const [cx, cy] = job.prepared.contours[ci]?.origin ?? [NaN, NaN];
        return c.map((d, k) => {
          const [x, y] = [cx + d.x, cy + d.y];
          return { x: e[0] * x + e[2] * y + e[4] - a.corner[0], y: e[1] * x + e[3] * y + e[5] - a.corner[1], r: d.r * a.ratio, a: d.a, first: k === 0 };
        });
      });
      if (g.count !== want.length) fail(`stroke ${i}: ${g.count} dabs on the GPU, ${want.length} on the CPU`);
      for (const [k, d] of want.entries()) {
        const [x = NaN, y = NaN, r = NaN, al = NaN, first = NaN, ...rest] = f.subarray(k * DAB_FLOATS, (k + 1) * DAB_FLOATS);
        const dp = Math.hypot(x - d.x, y - d.y);
        [w.pos, w.r, w.a] = [Math.max(w.pos, dp), Math.max(w.r, Math.abs(r - d.r)), Math.max(w.a, Math.abs(al - d.a))];
        w.dabs++;
        if (!(dp <= 2e-3 && Math.abs(r - d.r) <= 1e-4 && Math.abs(al - d.a) <= 1e-6 && first === (d.first ? 1 : 0) && rest.every((v) => v === 0))) fail(`stroke ${i} dab ${k}: (${x}, ${y}) r ${r} a ${al} first ${first} against (${d.x}, ${d.y}) r ${d.r} a ${d.a} first ${d.first}`);
      }
    }
  } finally {
    renderer.destroy();
  }
  assert.equal(si, golden.length, "the golden numbers have every smear stroke");
  return w;
}

test("the smears entry writes each smudge and wet dab as the CPU expansion placed it, at ratio 1 and 2", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const reqs = brushRequests(smearScene(), handle.colors);
  for (const ratio of [1, 2]) {
    const w = await compareSmears(handle, { reqs, ratio, corner: [-3, 5] });
    t.diagnostic(`ratio ${ratio}: ${w.dabs} dabs; largest position difference ${w.pos.toExponential(2)} px, radius ${w.r.toExponential(2)}, alpha ${w.a.toExponential(2)}`);
    assert.deepEqual(w.failures, []);
    assert.ok(w.dabs > 200);
  }
});

test("with the buffer limit forced small, a smear stays one batch and the frame draws the same pixels", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const scene = smearScene();
  // The smallest limit that holds the largest smear's dabs (48 bytes each; brush space, so at any ratio) and every contour's geometry: the ink lines split.
  const expander = new BrushExpander({ enabled: false });
  const need = brushRequests(scene, handle.colors).flatMap((r) => {
    const p = expander.expand(r)?.set.prepared;
    if (p === undefined) return [];
    const dabs = p.kind === "smear" ? p.contours.reduce((n, c) => n + c.count, 0) * DAB_FLOATS * 4 : 0;
    return [dabs, ...p.contours.map((c) => c.geom.length * 4)];
  });
  const limit = Math.ceil(Math.max(...need) / 256) * 256;
  const whole = new GpuRenderer(handle);
  const split = new GpuRenderer(handle, { brushLimit: limit });
  try {
    for (const ratio of [1, 2]) {
      const a = await whole.render(scene, ratio);
      const b = await split.render(scene, ratio);
      t.diagnostic(`ratio ${ratio}: ${whole.stats.smears} smears; limit ${limit} bytes: ${split.stats.brushBatches} mark batches (unsplit ${whole.stats.brushBatches})`);
      assert.ok(split.stats.brushBatches > whole.stats.brushBatches, "the ink lines split");
      assert.ok(Buffer.from(b.data).equals(Buffer.from(a.data)), `ratio ${ratio}: the same pixels, split and unsplit`);
    }
  } finally {
    whole.destroy();
    split.destroy();
  }
});

test("a smear larger than one buffer fails, naming its call", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const scene = new SceneRecorder({ width: 600, height: 40 }).record((v) => {
    v.line(4, 10, 12, 10, { stroke: "#000", weight: 6, brush: "smudge" });
    v.line(10, 20, 590, 30, { stroke: "#000", weight: 6, brush: "smudge" });
  }).scene;
  const renderer = new GpuRenderer(handle, { brushLimit: 4096 });
  try {
    await assert.rejects(renderer.render(scene, 1), (e: unknown) => {
      assert.ok(e instanceof GpuRenderError);
      t.diagnostic(e.message);
      assert.equal(e.path, "line #2");
      assert.match(e.message, /a smudge or wet stroke of \d+ dabs needs .* and must stay in one brush buffer/);
      return true;
    });
  } finally {
    renderer.destroy();
  }
});

test("two large smears and bristles share one sample buffer and one output buffer, within two of the limit", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const scene = new SceneRecorder({ width: 400, height: 120 }).record((v) => {
    v.background("#f4efe2");
    v.line(10, 30, 390, 40, { stroke: "#000", weight: 2, brush: "smudge" });
    v.line(10, 70, 390, 60, { stroke: "#f2f2f2", weight: 2, brush: "wet" });
    v.curve([[10, 100], [30, 95], [50, 105]], false, { stroke: "#3b5d8a", weight: 12, brush: "bristle" });
    v.line(70, 100, 70, 100, { stroke: "#3b5d8a", weight: 12, brush: "bristle" });
  }).scene;
  const expander = new BrushExpander({ enabled: false });
  const sets = brushRequests(scene, handle.colors).map((r) => expander.expand(r)?.set);
  const counts = sets.flatMap((s) => (s?.kind === "smear" ? [s.prepared.contours.reduce((n, c) => n + c.count, 0)] : []));
  // The limit holds the larger smear's dabs and one bristle's strip, nothing more.
  const strip = Math.max(...sets.flatMap((s) => (s?.kind === "bristle" ? s.prepared.contours.map((c) => (c.count - 1) * 6 * 24 * 4) : [])));
  const limit = Math.ceil(Math.max(Math.max(...counts) * DAB_FLOATS * 4, strip) / 256) * 256;
  // A pair per smear (samples and dabs) would alone exceed two buffers of the limit.
  const separate = counts.reduce((n, c) => n + c * (8 + DAB_FLOATS) * 4, 0);
  assert.equal(counts.length, 2);
  assert.ok(separate > 2 * limit, `separate smear pairs, ${separate} bytes, exceed ${2 * limit}`);
  const whole = new GpuRenderer(handle);
  const split = new GpuRenderer(handle, { brushLimit: limit });
  try {
    for (const ratio of [1, 2]) {
      const a = await whole.render(scene, ratio);
      const b = await split.render(scene, ratio);
      t.diagnostic(`ratio ${ratio}: limit ${limit} bytes; scratch ${split.stats.brushScratch} bytes, ${split.stats.smears} smears, ${split.stats.brushBatches} mark batches`);
      assert.equal(split.stats.smears, 2);
      assert.ok(split.stats.brushBatches > 1);
      assert.ok(split.stats.brushScratch > 0 && split.stats.brushScratch <= 2 * limit, "one sample buffer and one output buffer, each at most the limit");
      assert.ok(Buffer.from(b.data).equals(Buffer.from(a.data)), `ratio ${ratio}: the same pixels as at the device's limit`);
    }
  } finally {
    whole.destroy();
    split.destroy();
  }
});
