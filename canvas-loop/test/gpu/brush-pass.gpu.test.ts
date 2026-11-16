// The GPU brush expansion against the CPU expansion it replaced
// (canvas-loop-gpu-brushes.subplan.md, chunks 2 and 3), read from golden
// numbers recorded before chunk 9 deleted it (test/brushes/golden.ts): sample
// readback for the brush sheet, the walker's first frame and focused contours;
// the WGSL hash against random.ts's, bit for bit; stamp dab readback, with hue
// and light jitter;
// the stamp mark's box at the extremes; the walker frame in a fresh
// process; and (chunk 5) batches: with the buffer limit forced small, so that
// inputs split between contours and batches inside contours, samples,
// instances and pixels equal an unsplit render; a contour over the limit
// fails naming its call; the walker repeats after `release()` and wake; the
// readback splits into buffers no larger than the limit. One
// Dawn device for the file; skipped, with a message, where Dawn finds no
// adapter.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";
import type { TestContext } from "node:test";
import { mix } from "../../src/core/brush/random.js";
import type { TextMeasurer } from "../../src/core/text/measure.js";
import type { GpuHandle } from "../../src/device/open.js";
import { openTextMeasurer } from "../../src/device/open.js";
import { bristleBytes } from "../../src/gpu/brush-pack.js";
import type { BrushJob, BrushOutputs } from "../../src/gpu/brush-pass.js";
import { gpuBox } from "../../src/gpu/marks.js";
import type { R } from "../../src/gpu/jobs.js";
import { MIX_WGSL } from "../../src/gpu/shader-paper.js";
import { DAB_FLOATS, SAMPLE_FLOATS } from "../../src/gpu/shader-brush.js";
import { GpuRenderer } from "../../src/gpu/renderer.js";
import { sharedGpu } from "../../src/headless/scene/surface.js";
import type { ExpandRequest, Prepared } from "../../src/scene/brush/expand.js";
import { BrushExpander, POINT_WORDS, prepare } from "../../src/scene/brush/expand.js";
import type { Mat } from "../../src/scene/nodes.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";
import { GpuRenderError } from "../../src/scene/errors.js";
import * as walkerSheet from "../../src/gallery/intra-walk-styles/sketch-tea.js";
import { FOCUSED_SIZE, drawFocused } from "../brushes/focused.js";
import { brushRequests } from "../brushes/requests.js";
import type { GoldenSample } from "../brushes/golden.js";
import { goldenDabs, goldenSamples } from "../brushes/golden.js";
import { STAMPS_SIZE, drawExtremes, drawJitter } from "./stamps.js";
import { drawSheet, drawSmear } from "./brush-sheet.js";
import { THIN_SIZE, drawThin } from "./ink-sheet.js";
import { portFrames } from "./cache-cases.js";
import { walkerHashes } from "./walker-frame.js";

let gpu: GpuHandle | undefined;
let text: TextMeasurer | undefined;
before(async () => {
  gpu = await sharedGpu();
  text = await openTextMeasurer();
});

function needGpu(t: TestContext): GpuHandle | undefined {
  if (gpu === undefined) t.skip("Dawn found no GPU adapter on this machine; the sample pass not checked");
  return gpu;
}

/** Run the sample pass over `reqs` once (the renderer's verification path); the samples as floats (and words, for the contour index). */
async function gpuSamples(handle: GpuHandle, reqs: readonly ExpandRequest[]): Promise<{ prepared: Prepared[]; out: { count: number; ranges: BrushOutputs["ranges"] }; f: Float32Array; u: Uint32Array }> {
  const prepared = reqs.map((r) => prepare(r)).filter((p) => p !== undefined);
  assert.equal(prepared.length, reqs.length);
  const renderer = new GpuRenderer(handle);
  try {
    const out = await renderer.sampleBrushes(prepared);
    return { prepared, out, f: new Float32Array(out.data), u: new Uint32Array(out.data) };
  } finally {
    renderer.destroy();
  }
}

/** Copy `size` bytes of `src` back to the CPU after the work encoded on `enc`. */
async function readBack(device: GPUDevice, a: { enc: GPUCommandEncoder; src: GPUBuffer; size: number }): Promise<ArrayBuffer> {
  const read = device.createBuffer({ size: a.size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  a.enc.copyBufferToBuffer(a.src, 0, read, 0, a.size);
  device.queue.submit([a.enc.finish()]);
  await read.mapAsync(GPUMapMode.READ);
  const out = read.getMappedRange().slice(0);
  read.destroy();
  return out;
}

interface Worst {
  samples: number;
  contours: number;
  pos: number;
  pressure: number;
  failures: string[];
}

/**
 * Every GPU sample against its golden CPU sample (both relative to the
 * contour's origin): counts equal, positions within 1e-3 brush px, pressure
 * within 1e-5, the end points exact.
 */
async function compareSamples(handle: GpuHandle, a: { reqs: readonly ExpandRequest[]; golden: readonly GoldenSample[][][] }): Promise<Worst> {
  const { reqs } = a;
  const g = await gpuSamples(handle, reqs);
  const worst: Worst = { samples: g.out.count, contours: 0, pos: 0, pressure: 0, failures: [] };
  const fail = (m: string): void => void (worst.failures.length < 12 && worst.failures.push(m));
  assert.equal(a.golden.length, reqs.length, "the golden numbers have every stroke");
  for (const i of reqs.keys()) {
    const cpu = (a.golden[i] ?? []).map((samples) => ({ samples }));
    const ranges = g.out.ranges[i] ?? [];
    const prep = g.prepared[i];
    assert.equal(ranges.length, cpu.length, `stroke ${i}: contours`);
    for (const [c, contour] of cpu.entries()) {
      const r = ranges[c] ?? { first: 0, count: 0 };
      const index = worst.contours++;
      if (r.count !== contour.samples.length) fail(`stroke ${i} contour ${c}: ${r.count} samples on the GPU, ${contour.samples.length} on the CPU`);
      for (const [k, s] of contour.samples.entries()) {
        const at = (r.first + k) * SAMPLE_FLOATS;
        const [x = NaN, y = NaN] = g.f.subarray(at, at + 2);
        const p = g.f[at + 6] ?? NaN;
        const d = Math.hypot(x - s.x, y - s.y);
        worst.pos = Math.max(worst.pos, d);
        worst.pressure = Math.max(worst.pressure, Math.abs(p - s.p));
        if (!(d <= 1e-3)) fail(`stroke ${i} contour ${c} sample ${k}: (${x}, ${y}) against (${s.x}, ${s.y})`);
        if (!(Math.abs(p - s.p) <= 1e-5)) fail(`stroke ${i} contour ${c} sample ${k}: pressure ${p} against ${s.p}`);
        if (g.u[at + 7] !== index) fail(`stroke ${i} contour ${c} sample ${k}: contour index ${g.u[at + 7]}, expected ${index}`);
      }
      // Without wobble, the last sample is the contour's end point, and a one-sample contour's is its start (f32).
      const geom = prep?.contours[c]?.geom;
      if (prep?.wobble === 0 && geom !== undefined && r.count > 0) {
        const end = r.count === 1 ? 0 : geom.length - POINT_WORDS;
        const at = (r.first + r.count - 1) * SAMPLE_FLOATS;
        if (g.f[at] !== geom[end] || g.f[at + 1] !== geom[end + 1]) fail(`stroke ${i} contour ${c}: last sample (${g.f[at]}, ${g.f[at + 1]}) is not the end point (${geom[end]}, ${geom[end + 1]})`);
      }
    }
  }
  return worst;
}

function report(t: TestContext, a: { w: Worst; what: string }): void {
  const { w, what } = a;
  t.diagnostic(`${what}: ${w.samples} samples over ${w.contours} contours; largest position difference ${w.pos.toExponential(2)} brush px, pressure ${w.pressure.toExponential(2)}`);
  assert.deepEqual(w.failures, []);
}

test("the sample pass places the brush sheet's samples as the CPU sampling did", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const sheet = new SceneRecorder({ width: 640, height: 480 }).record((v) => drawSheet(v)).scene;
  const smear = new SceneRecorder({ width: 320, height: 160 }).record((v) => drawSmear(v)).scene;
  const reqs = [...brushRequests(sheet, handle.colors), ...brushRequests(smear, handle.colors)];
  report(t, { w: await compareSamples(handle, { reqs, golden: [...goldenSamples("sheet"), ...goldenSamples("smear")] }), what: "brush sheet and smear sheet" });
});

test("the sample pass places focused contours as the CPU sampling did", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const scene = new SceneRecorder(FOCUSED_SIZE).record(drawFocused).scene;
  const reqs = brushRequests(scene, handle.colors);
  const w = await compareSamples(handle, { reqs, golden: goldenSamples("focused") });
  report(t, { w, what: "focused contours" });
  const counts = reqs.map((r) => prepare(r)?.contours.map((c) => c.count));
  assert.deepEqual(counts[0], [1], "shorter than one step: one sample");
  assert.deepEqual(counts[5], [11], "2.85 at step 0.3: eleven samples");
  assert.deepEqual(counts.slice(-3), [[17], [0], [1]], "the corner path, the empty contour, the closed dot");
});

test("the sample pass places the walker's first frame as the CPU sampling did, and repeats exactly", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined || text === undefined) return;
  const [scene] = portFrames(walkerSheet, { at: [0], text });
  assert.ok(scene !== undefined);
  const reqs = brushRequests(scene, handle.colors);
  report(t, { w: await compareSamples(handle, { reqs, golden: goldenSamples("walker") }), what: `walker frame 0 (${reqs.length} strokes)` });
  const [a, b] = [await gpuSamples(handle, reqs), await gpuSamples(handle, reqs)];
  assert.ok(Buffer.from(a.f.buffer).equals(Buffer.from(b.f.buffer)), "a second run writes the same bytes");
});

test("the WGSL hash equals random.ts's on 65,536 inputs, bit for bit", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const { device } = handle;
  const n = 65536;
  // Spread over all 32 bits, with the ends of the range.
  const input = Uint32Array.from({ length: n }, (_, i) => (Math.imul(i, 0x9e3779b1) ^ (i << 16)) >>> 0);
  input.set([0, 1, 0xffffffff, 0x80000000], 0);
  const code = `${MIX_WGSL}
@group(0) @binding(0) var<storage, read> inp: array<u32>;
@group(0) @binding(1) var<storage, read_write> out: array<u32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g: vec3u) {
  let v = inp[g.x];
  out[2u * g.x] = mix32(v);
  out[2u * g.x + 1u] = mix32(0x2545f491u ^ mix32(7u * 0x9e3779b1u + mix32(v)));
}`;
  const pipe = device.createComputePipeline({ layout: "auto", compute: { module: device.createShaderModule({ code }), entryPoint: "main" } });
  const inp = device.createBuffer({ size: n * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const out = device.createBuffer({ size: n * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  try {
    device.queue.writeBuffer(inp, 0, input);
    const enc = device.createCommandEncoder();
    const cp = enc.beginComputePass();
    cp.setPipeline(pipe);
    cp.setBindGroup(0, device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: inp } }, { binding: 1, resource: { buffer: out } }] }));
    cp.dispatchWorkgroups(n / 64);
    cp.end();
    const got = new Uint32Array(await readBack(device, { enc, src: out, size: n * 8 }));
    let differ = 0;
    for (const [i, v] of input.entries()) {
      // random.ts's `rand(0x2545f491, { channel: 7, index: v })` before its division: the GPU's `rand1` keeps its 24 high bits.
      if (got[2 * i] !== mix(v) || got[2 * i + 1] !== mix(0x2545f491 ^ mix(7 * 0x9e3779b1 + mix(v)))) differ++;
    }
    t.diagnostic(`${n} inputs, ${differ} differ`);
    assert.equal(differ, 0);
  } finally {
    inp.destroy();
    out.destroy();
  }
});

/** A golden dab where the lowering places it (the mark's own pixels), or a sample the stamp rule skipped. */
type WantDab = { readonly skip: true } | { readonly skip: false; readonly x: number; readonly y: number; readonly r: number; readonly a: number; readonly soft: boolean; readonly rgb: readonly number[] };

/**
 * Stamp strokes placed as the lowering places them (brush-space q times the
 * ratio, a fractional translation), with golden file `golden`'s dabs (brush
 * space) placed the same way, per sample, for the strokes it recorded (every
 * `stride`-th); none without `golden`.
 */
function placeStamps(reqs: readonly ExpandRequest[], at: { ratio: number; golden?: string; translate?: readonly [number, number] }): { job: BrushJob; box: R; want: WantDab[] | undefined }[] {
  const expander = new BrushExpander({ enabled: false });
  const { ratio } = at;
  const placed = reqs.flatMap((req, i) => {
    const ex = expander.expand(req);
    if (ex?.set.kind !== "stamp") return [];
    const { q } = ex;
    const e: Mat = [ratio * q[0], ratio * q[1], ratio * q[2], ratio * q[3], at.translate?.[0] ?? 13.25 + i * 0.37, at.translate?.[1] ?? 7.5 + i * 0.11];
    const box = gpuBox(ex.set, e);
    if (box === undefined) return [];
    const offset = [e[4] - box.x0, e[5] - box.y0] as const;
    const { brush, prepared } = ex.set;
    const job: BrushJob = { prepared, brush, lin: [e[0], e[1], e[2], e[3]], ratio, offset, slot: [3, 5, 3 + box.x1 - box.x0, 5 + box.y1 - box.y0] };
    return [{ job, box, e }];
  });
  if (at.golden === undefined) return placed.map((p) => ({ ...p, want: undefined }));
  const { stride, strokes } = goldenDabs(at.golden);
  assert.equal(strokes.length, Math.ceil(placed.length / stride), `${at.golden}: the golden numbers have every ${stride === 1 ? "" : `${stride}th `}stamp stroke`);
  return placed.map((p, i) => {
    const gold = i % stride === 0 ? strokes[i / stride] : undefined;
    if (gold === undefined) return { ...p, want: undefined };
    const { e } = p;
    const [ox, oy] = p.job.offset;
    assert.equal(gold.contours.length, p.job.prepared.contours.length);
    const want = gold.contours.flatMap((c, ci) => {
      const [cx, cy] = p.job.prepared.contours[ci]?.origin ?? [NaN, NaN];
      return c.map((d): WantDab => {
        if (d.skip) return d;
        const [x, y] = [cx + d.x, cy + d.y];
        return { ...d, x: e[0] * x + e[2] * y + ox, y: e[1] * x + e[3] * y + oy, r: d.r * ratio, soft: gold.soft };
      });
    });
    return { ...p, want };
  });
}

interface DabWorst {
  dabs: number;
  /** Dabs compared with a golden dab (the walker's golden numbers keep every fourth stamp stroke). */
  compared: number;
  skipped: number;
  pos: number;
  r: number;
  a: number;
  rgb: number;
  failures: string[];
}

/** Every GPU dab against its golden CPU dab: the same count and zero-alpha dabs, centres within 2e-3 device px, radius and alpha within 1e-4, RGB within 1/255. */
async function compareDabs(handle: GpuHandle, a: { reqs: readonly ExpandRequest[]; ratio: number; golden: string }): Promise<DabWorst> {
  const placed = placeStamps(a.reqs, { ratio: a.ratio, golden: a.golden });
  const renderer = new GpuRenderer(handle);
  const g = await renderer.brushInstances(placed.map((p) => p.job)).finally(() => renderer.destroy());
  const f = new Float32Array(g.data);
  const w: DabWorst = { dabs: g.count, compared: 0, skipped: 0, pos: 0, r: 0, a: 0, rgb: 0, failures: [] };
  const fail = (m: string): void => void (w.failures.length < 12 && w.failures.push(m));
  for (const [i, p] of placed.entries()) {
    const range = g.strokes[i] ?? { first: 0, count: 0 };
    if (p.want === undefined) continue;
    if (range.count !== p.want.length) fail(`stroke ${i}: ${range.count} dabs on the GPU, ${p.want.length} samples on the CPU`);
    for (let k = 0; k < range.count; k++) {
      const d = f.subarray((range.first + k) * DAB_FLOATS, (range.first + k + 1) * DAB_FLOATS);
      const [x = NaN, y = NaN, r = NaN, al = NaN, soft = NaN] = d;
      const c = p.want[k];
      if (c?.skip === true) {
        w.skipped++;
        if (al !== 0) fail(`stroke ${i} dab ${k}: skipped on the CPU, alpha ${al} on the GPU`);
        continue;
      }
      if (c === undefined || al === 0) {
        fail(`stroke ${i} dab ${k}: ${c === undefined ? "no CPU dab" : "zero alpha on the GPU"}`);
        continue;
      }
      w.compared++;
      const dp = Math.hypot(x - c.x, y - c.y);
      const dr = Math.abs(r - c.r);
      const da = Math.abs(al - c.a);
      const dc = Math.max(...c.rgb.map((v, n) => Math.abs((d[5 + n] ?? NaN) - v)));
      [w.pos, w.r, w.a, w.rgb] = [Math.max(w.pos, dp), Math.max(w.r, dr), Math.max(w.a, da), Math.max(w.rgb, dc)];
      if (!(dp <= 2e-3 && dr <= 1e-4 && da <= 1e-4 && dc <= 1 / 255 + 1e-6) || soft !== (c.soft ? 1 : 0)) fail(`stroke ${i} dab ${k}: (${x}, ${y}) r ${r} a ${al} rgb ${[...d.subarray(5, 8)].join(",")} soft ${soft} against (${c.x}, ${c.y}) r ${c.r} a ${c.a} rgb ${c.rgb.join(",")} soft ${c.soft}`);
      if ([...d.subarray(8, 12)].join(",") !== p.job.slot.join(",")) fail(`stroke ${i} dab ${k}: slot ${[...d.subarray(8, 12)].join(",")}`);
    }
  }
  return w;
}

function reportDabs(t: TestContext, a: { w: DabWorst; what: string }): void {
  const { w, what } = a;
  t.diagnostic(`${what}: ${w.dabs} dabs, ${w.compared} compared (${w.skipped} skipped); largest centre difference ${w.pos.toExponential(2)} device px, radius ${w.r.toExponential(2)}, alpha ${w.a.toExponential(2)}, RGB ${(w.rgb * 255).toFixed(3)}/255`);
  assert.deepEqual(w.failures, []);
}

test("the dabs entry lays the brush sheet's, focused and walker stamp dabs as the CPU did, at ratio 1 and 2", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined || text === undefined) return;
  const sheet = new SceneRecorder({ width: 640, height: 480 }).record((v) => drawSheet(v)).scene;
  const focused = new SceneRecorder(FOCUSED_SIZE).record(drawFocused).scene;
  const [walker] = portFrames(walkerSheet, { at: [0], text });
  assert.ok(walker !== undefined);
  for (const [what, scene, golden] of [["brush sheet", sheet, "sheet"], ["focused", focused, "focused"], ["walker frame 0", walker, "walker"]] as const) {
    for (const ratio of [1, 2]) reportDabs(t, { w: await compareDabs(handle, { reqs: brushRequests(scene, handle.colors), ratio, golden }), what: `${what}, ratio ${ratio}` });
  }
});

test("the dabs entry gives each dab its hue and light jitter as the CPU does, RGB within 1/255, and skips the same dabs", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const scene = new SceneRecorder(STAMPS_SIZE).record(drawJitter).scene;
  for (const ratio of [1, 2]) {
    const w = await compareDabs(handle, { reqs: brushRequests(scene, handle.colors), ratio, golden: "jitter" });
    reportDabs(t, { w, what: `jitter, ratio ${ratio}` });
    assert.ok(w.dabs > 500 && w.skipped > 4, "the case lays dabs, and skips some");
  }
});

test("a stamp mark's box holds every dab at the extremes of scatter, sizeJitter and wobble", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const scene = new SceneRecorder(STAMPS_SIZE).record(drawExtremes).scene;
  for (const ratio of [1, 2]) {
    const placed = placeStamps(brushRequests(scene, handle.colors), { ratio });
    assert.equal(placed.length, 3);
    const renderer = new GpuRenderer(handle);
    const g = await renderer.brushInstances(placed.map((p) => p.job)).finally(() => renderer.destroy());
    const f = new Float32Array(g.data);
    let outside = 0;
    let slack = Infinity;
    for (const [i, p] of placed.entries()) {
      const range = g.strokes[i] ?? { first: 0, count: 0 };
      const [w, h] = [p.box.x1 - p.box.x0, p.box.y1 - p.box.y0];
      for (let k = range.first; k < range.first + range.count; k++) {
        const [x = NaN, y = NaN, r = NaN, al = 0] = f.subarray(k * DAB_FLOATS, k * DAB_FLOATS + 4);
        if (al === 0) continue;
        // A dab's quad reaches its radius plus one pixel.
        const room = Math.min(x - r - 1, y - r - 1, w - (x + r + 1), h - (y + r + 1));
        slack = Math.min(slack, room);
        if (!(room >= 0)) outside++;
      }
    }
    t.diagnostic(`ratio ${ratio}: ${g.count} dabs; the nearest comes within ${slack.toFixed(2)} px of its box`);
    assert.equal(outside, 0);
  }
});

test("the walker frame is byte-identical in a fresh process with a new device", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const here = await walkerHashes(handle);
  const script = fileURLToPath(new URL("walker-frame.ts", import.meta.url));
  const child = execFileSync(process.execPath, ["--import", "tsx", script, "--print"], { encoding: "utf8" }).trim().split("\n");
  t.diagnostic(`ratio 1 ${here[0]}, ratio 2 ${here[1]}`);
  assert.deepEqual(child, here);
});

test("a stamp far from the origin, translated back, lands where the CPU puts it (stroke-local f32 coordinates)", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  // At x = 16777217, f32 cannot hold the point: rounded to 16777216, the dab would land one device pixel off.
  const scene = new SceneRecorder({ width: 40, height: 20 }).record((v) => {
    v.at({ translate: [-16777207, 0] }, () => v.line(16777217, 10, 16777217, 10, { stroke: "#000", weight: 4, brush: { preset: "pencil", scatter: 0, sizeJitter: 0 }, gesture: { pressure: 1 } }));
  }).scene;
  const reqs = brushRequests(scene, handle.colors);
  const [p] = placeStamps(reqs, { ratio: 1, golden: "far", translate: [-16777207, 0] });
  assert.ok(p !== undefined);
  const renderer = new GpuRenderer(handle);
  const g = await renderer.brushInstances([p.job]).finally(() => renderer.destroy());
  const f = new Float32Array(g.data);
  assert.equal(g.count, 1);
  const x = (f[0] ?? NaN) + p.box.x0;
  t.diagnostic(`box x0 ${p.box.x0}; dab centre at device x ${x}`);
  assert.ok(Math.abs(x - 10) <= 2e-3, `the dab's centre lands at device x 10 (got ${x})`);
  reportDabs(t, { w: await compareDabs(handle, { reqs, ratio: 1, golden: "far" }), what: "far stamp" });
});

test("a far contour of the same stamp stroke does not move a near one (per-contour f32 coordinates)", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  // At x = 67108864, f32 steps by 8: a near contour stored relative to it would land up to 4 px off.
  const scene = new SceneRecorder({ width: 40, height: 40 }).record((v) => {
    v.path([["move", 67108864, 20], ["line", 67108864, 20], ["move", 10.25, 20], ["line", 10.25, 20]], { stroke: "#000", weight: 4, brush: { preset: "pencil", scatter: 0, sizeJitter: 0 }, gesture: { pressure: 1 } });
  }).scene;
  const reqs = brushRequests(scene, handle.colors);
  const [p] = placeStamps(reqs, { ratio: 1, translate: [0, 0] });
  assert.ok(p !== undefined);
  const renderer = new GpuRenderer(handle);
  const g = await renderer.brushInstances([p.job]).finally(() => renderer.destroy());
  const f = new Float32Array(g.data);
  assert.equal(g.count, 2, "one dab per contour");
  const near = (f[DAB_FLOATS] ?? NaN) + p.box.x0;
  t.diagnostic(`box x0 ${p.box.x0}; the near dab's centre at device x ${near}`);
  assert.ok(Math.abs(near - 10.25) <= 2e-3, `the near dab lands at x 10.25 (got ${near})`);
});

/** Stamp and ink strokes placed as the lowering places them (as `placeStamps`, without the CPU reference). */
function placeJobs(reqs: readonly ExpandRequest[], ratio: number): BrushJob[] {
  const expander = new BrushExpander({ enabled: false });
  return reqs.flatMap((req, i) => {
    const ex = expander.expand(req);
    if (ex?.set.kind !== "stamp" && ex?.set.kind !== "ink") return [];
    const { q } = ex;
    const e: Mat = [ratio * q[0], ratio * q[1], ratio * q[2], ratio * q[3], 13.25 + i * 0.37, 7.5 + i * 0.11];
    const box = gpuBox(ex.set, e);
    if (box === undefined) return [];
    return [{ prepared: ex.set.prepared, brush: ex.set.brush, lin: [e[0], e[1], e[2], e[3]], ratio, offset: [e[4] - box.x0, e[5] - box.y0], slot: [3, 5, 3 + box.x1 - box.x0, 5 + box.y1 - box.y0] }];
  });
}

/** The smallest buffer limit (a multiple of 256 bytes) that holds every contour of `prepared` on its own: its geometry, and its records with keyframes and a stroke record; and, for a bristle stroke, one bristle's strip, when `strips` (a frame draws them). */
function smallLimit(prepared: readonly Prepared[], strips?: "strips"): number {
  const words = Math.max(...prepared.flatMap((p) => p.contours.map((c) => Math.max(c.geom.length, 4 + 16 + 24 + (Array.isArray(c.pressure) ? 2 * c.pressure.length : 0)))));
  const strip = Math.max(0, ...prepared.flatMap((p) => (strips === "strips" && p.kind === "bristle" ? p.contours.map((c) => bristleBytes(c.count)) : [])));
  return Math.ceil(Math.max(words * 4, strip) / 256) * 256;
}

/** Scenes with stamps and ink, long and short contours: the brush sheet, the thin ink sheet and the focused contours. */
function batchScenes(): { what: string; scene: ReturnType<SceneRecorder["record"]>["scene"] }[] {
  return [
    { what: "brush sheet", scene: new SceneRecorder({ width: 640, height: 480 }).record((v) => drawSheet(v)).scene },
    { what: "thin ink", scene: new SceneRecorder(THIN_SIZE).record((v) => drawThin(v)).scene },
    { what: "focused", scene: new SceneRecorder(FOCUSED_SIZE).record(drawFocused).scene },
  ];
}

test("with the buffer limit forced small, the sample pass splits inputs and batches and writes the same bytes", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const smear = new SceneRecorder({ width: 320, height: 160 }).record((v) => drawSmear(v)).scene;
  const reqs = [...batchScenes().flatMap((s) => brushRequests(s.scene, handle.colors)), ...brushRequests(smear, handle.colors)];
  const prepared = reqs.map((r) => prepare(r)).filter((p) => p !== undefined);
  const limit = smallLimit(prepared);
  const cap = Math.floor(limit / (SAMPLE_FLOATS * 4));
  const whole = new GpuRenderer(handle);
  const split = new GpuRenderer(handle, { brushLimit: limit });
  try {
    const [a, b] = [await whole.sampleBrushes(prepared), await split.sampleBrushes(prepared)];
    t.diagnostic(`${a.count} samples; limit ${limit} bytes (${cap} samples a batch): ${b.inputs} input buffers, ${b.batches} batches (unsplit: ${a.inputs}, ${a.batches})`);
    assert.equal(a.batches, 1);
    assert.ok(b.inputs > 1, "the inputs split");
    assert.ok(b.batches > b.inputs, "an input holds several batches");
    assert.ok(prepared.some((p) => p.contours.some((c) => c.count > cap)), "a contour splits between batches");
    assert.deepEqual(b.ranges, a.ranges);
    assert.ok(Buffer.from(b.data).equals(Buffer.from(a.data)), "the same bytes, split and unsplit");
  } finally {
    whole.destroy();
    split.destroy();
  }
});

test("with the buffer limit forced small, the stamps' and inks' instances are the same bytes", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  for (const ratio of [1, 2]) {
    const jobs = placeJobs(batchScenes().flatMap((s) => brushRequests(s.scene, handle.colors)), ratio);
    const limit = smallLimit(jobs.map((j) => j.prepared));
    const cap = Math.floor(limit / (DAB_FLOATS * 4));
    const long = (kind: string): boolean => jobs.some((j) => j.brush.kind === kind && j.prepared.contours.some((c) => c.count > cap));
    assert.ok(long("stamp") && long("ink"), "a stamp contour and an ink contour each split between batches");
    const whole = new GpuRenderer(handle);
    const split = new GpuRenderer(handle, { brushLimit: limit });
    try {
      const [a, b] = [await whole.brushInstances(jobs), await split.brushInstances(jobs)];
      t.diagnostic(`ratio ${ratio}: ${jobs.length} strokes, ${a.count} instances; limit ${limit} bytes (${cap} instances a batch): ${b.inputs} input buffers, ${b.batches} batches`);
      assert.equal(a.batches, 1);
      assert.ok(b.inputs > 1 && b.batches > b.inputs);
      assert.deepEqual(b.strokes, a.strokes);
      assert.ok(Buffer.from(b.data).equals(Buffer.from(a.data)), "the same bytes, split and unsplit");
    } finally {
      whole.destroy();
      split.destroy();
    }
  }
});

test("with the buffer limit forced small, frames draw the same pixels over several batches", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined || text === undefined) return;
  const [walker] = portFrames(walkerSheet, { at: [0], text });
  assert.ok(walker !== undefined);
  const cases = [...batchScenes().map((c) => ({ ...c, limit: 1024 })), { what: "walker frame 0", scene: walker, limit: 64 * 1024 }];
  for (const c of cases) {
    const limit = Math.max(c.limit, smallLimit(brushRequests(c.scene, handle.colors).map((r) => prepare(r)).filter((p) => p !== undefined), "strips"));
    const whole = new GpuRenderer(handle);
    const split = new GpuRenderer(handle, { brushLimit: limit });
    try {
      for (const ratio of [1, 2]) {
        const a = await whole.render(c.scene, ratio);
        const batches = whole.stats.brushBatches;
        const b = await split.render(c.scene, ratio);
        t.diagnostic(`${c.what}, ratio ${ratio}: ${batches} batch unsplit; ${split.stats.brushBatches} batches at ${limit} bytes, over ${split.stats.markPages} mark pages`);
        // Dabs and capsules take one batch, and bristle strips (the brush sheet's last row) one more.
        const bristles = brushRequests(c.scene, handle.colors).some((r) => r.stroke.brush.kind === "bristle");
        assert.equal(batches, bristles ? 2 : 1, "at the device's limit, one batch per sequence");
        assert.ok(split.stats.brushBatches > batches);
        assert.ok(Buffer.from(b.data).equals(Buffer.from(a.data)), `${c.what}, ratio ${ratio}: the same pixels, split and unsplit`);
      }
    } finally {
      whole.destroy();
      split.destroy();
    }
  }
});

test("with the buffer limit forced small, the walker's samples and instances read back through several buffers, the same bytes", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined || text === undefined) return;
  const [scene] = portFrames(walkerSheet, { at: [0], text });
  assert.ok(scene !== undefined);
  const reqs = brushRequests(scene, handle.colors);
  const prepared = reqs.map((r) => prepare(r)).filter((p) => p !== undefined);
  const jobs = placeJobs(reqs, 2);
  const limit = 64 * 1024;
  const whole = new GpuRenderer(handle);
  const split = new GpuRenderer(handle, { brushLimit: limit });
  try {
    const [a, b] = [await whole.sampleBrushes(prepared), await split.sampleBrushes(prepared)];
    const [c, d] = [await whole.brushInstances(jobs), await split.brushInstances(jobs)];
    t.diagnostic(`limit ${limit} bytes: ${b.count} samples in ${b.reads} readback buffers (unsplit: ${a.reads}); ${d.count} instances in ${d.reads} (unsplit: ${c.reads})`);
    assert.equal(a.reads, 1);
    assert.equal(c.reads, 1);
    assert.equal(b.reads, Math.ceil(b.count / Math.floor(limit / (SAMPLE_FLOATS * 4))));
    assert.equal(d.reads, Math.ceil(d.count / Math.floor(limit / (DAB_FLOATS * 4))));
    assert.ok(b.reads > 1 && d.reads > 1, "the readback splits");
    assert.equal(b.data.byteLength, a.data.byteLength);
    assert.ok(Buffer.from(b.data).equals(Buffer.from(a.data)), "the same samples, one readback buffer or several");
    assert.ok(Buffer.from(d.data).equals(Buffer.from(c.data)), "the same instances, one readback buffer or several");
  } finally {
    whole.destroy();
    split.destroy();
  }
});

test("stats.cpu.brush counts brush work inside lowering and the atlas, and none on a frame without brushes", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined || text === undefined) return;
  const [scene] = portFrames(walkerSheet, { at: [0], text });
  assert.ok(scene !== undefined);
  const plain = new SceneRecorder({ width: 64, height: 64 }).record((v) => v.line(4, 4, 60, 60, { stroke: "#000", weight: 2 })).scene;
  const renderer = new GpuRenderer(handle);
  try {
    await renderer.render(scene, 2);
    const c = renderer.stats.cpu;
    t.diagnostic(`walker frame 0 at ratio 2: brush ${c.brush.toFixed(2)} ms of lower ${c.lower.toFixed(2)} + atlas ${c.atlas.toFixed(2)} ms`);
    assert.ok(c.brush > 0 && c.brush <= c.lower + c.atlas);
    await renderer.render(plain, 2);
    assert.equal(renderer.stats.cpu.brush, 0);
  } finally {
    renderer.destroy();
  }
});

test("a brushed contour larger than one buffer fails, naming its call", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const points = Array.from({ length: 400 }, (_, i) => [10 + i * 0.5, 20 + (i % 2)] as const);
  const scene = new SceneRecorder({ width: 240, height: 40 }).record((v) => {
    v.line(4, 4, 30, 4, { stroke: "#000", weight: 2, brush: "ink" });
    v.curve(points, false, { stroke: "#000", weight: 2, brush: "ink" });
  }).scene;
  const renderer = new GpuRenderer(handle, { brushLimit: 4096 });
  try {
    await assert.rejects(renderer.render(scene, 1), (e: unknown) => {
      assert.ok(e instanceof GpuRenderError);
      t.diagnostic(e.message);
      assert.equal(e.path, "curve #2");
      assert.match(e.message, /brushed contour of \d+ points needs .* of geometry/);
      return true;
    });
  } finally {
    renderer.destroy();
  }
});

test("the walker frame is byte-identical after release() and wake, split and unsplit", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined || text === undefined) return;
  const [scene] = portFrames(walkerSheet, { at: [0], text });
  assert.ok(scene !== undefined);
  const hashes: string[] = [];
  for (const brushLimit of [undefined, 64 * 1024]) {
    const renderer = new GpuRenderer(handle, { brushLimit });
    try {
      for (const ratio of [1, 2]) {
        const asleep: string = createHash("sha256").update((await renderer.render(scene, ratio)).data).digest("hex");
        renderer.release();
        assert.equal(renderer.held.strokes, 0, "release() forgets the prepared strokes");
        const woken: string = createHash("sha256").update((await renderer.render(scene, ratio)).data).digest("hex");
        assert.equal(woken, asleep, `ratio ${ratio}, limit ${brushLimit ?? "the device's"}: the same bytes after release() and wake`);
        hashes.push(`${ratio}:${woken}`);
      }
    } finally {
      renderer.destroy();
    }
  }
  t.diagnostic(hashes.join(" "));
  assert.deepEqual(hashes.slice(2), hashes.slice(0, 2), "split and unsplit give the same bytes");
});

test("with the buffer limit forced small, marks over several atlas pages draw the same pixels", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  // Six marks about 2,900 px square: an 8,192 px page holds few of them, so the batches draw into several pages, later passes loading what an earlier batch drew.
  const scene = new SceneRecorder({ width: 3000, height: 3000 }).record((v) => {
    for (let i = 0; i < 6; i++) {
      const style = { stroke: "#1d2a44", weight: 3 + i, brush: i % 2 === 0 ? "pencil" : "ink" } as const;
      v.line(40 + i * 10, 40, 2950 - i * 10, 2950, style);
    }
  }).scene;
  const whole = new GpuRenderer(handle);
  const split = new GpuRenderer(handle, { brushLimit: 4096 });
  try {
    const a = await whole.render(scene, 1);
    const b = await split.render(scene, 1);
    t.diagnostic(`${split.stats.markPages} mark pages; ${whole.stats.brushBatches} batch unsplit, ${split.stats.brushBatches} split`);
    assert.ok(split.stats.markPages > 1, "more than one page");
    assert.equal(whole.stats.brushBatches, 1);
    assert.ok(split.stats.brushBatches > 1);
    assert.ok(Buffer.from(b.data).equals(Buffer.from(a.data)), "the same pixels, split and unsplit");
  } finally {
    whole.destroy();
    split.destroy();
  }
});
