// The GPU sample pass against the CPU sampling it replaces
// (canvas-loop-gpu-brushes.subplan.md, chunk 2): sample readback against
// `shapeSamples` for the brush sheet, the walker's first frame and focused
// contours, and the WGSL hash against random.ts's, bit for bit. One Dawn
// device for the file; skipped, with a message, where Dawn finds no adapter.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { TestContext } from "node:test";
import { mix } from "../../src/core/brush/random.js";
import type { TextMeasurer } from "../../src/core/text/measure.js";
import type { GpuHandle } from "../../src/device/open.js";
import { openTextMeasurer } from "../../src/device/open.js";
import type { BrushOutputs } from "../../src/gpu/brush-pass.js";
import { MIX_WGSL } from "../../src/gpu/shader-paper.js";
import { SAMPLE_FLOATS } from "../../src/gpu/shader-brush.js";
import { GpuRenderer } from "../../src/gpu/renderer.js";
import { sharedGpu } from "../../src/headless/scene/surface.js";
import type { ExpandRequest, Prepared } from "../../src/scene/brush/expand.js";
import { POINT_WORDS, brushSamples, prepare } from "../../src/scene/brush/expand.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";
import * as walkerSheet from "../../src/examples/scene-ports/walker-sheet/sketch-tea.js";
import { FOCUSED_SIZE, drawFocused } from "../brushes/focused.js";
import { brushRequests } from "../brushes/requests.js";
import { drawSheet, drawSmear } from "./brush-sheet.js";
import { portFrames } from "./cache-cases.js";

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

/** Every GPU sample against its CPU sample: counts equal, positions within 1e-3 brush px, pressure within 1e-5, the end points exact. */
async function compareSamples(handle: GpuHandle, reqs: readonly ExpandRequest[]): Promise<Worst> {
  const g = await gpuSamples(handle, reqs);
  const worst: Worst = { samples: g.out.count, contours: 0, pos: 0, pressure: 0, failures: [] };
  const fail = (m: string): void => void (worst.failures.length < 12 && worst.failures.push(m));
  for (const [i, req] of reqs.entries()) {
    const cpu = brushSamples(req) ?? [];
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

test("the sample pass places the brush sheet's samples as shapeSamples does", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const sheet = new SceneRecorder({ width: 640, height: 480 }).record((v) => drawSheet(v)).scene;
  const smear = new SceneRecorder({ width: 320, height: 160 }).record((v) => drawSmear(v)).scene;
  report(t, { w: await compareSamples(handle, [...brushRequests(sheet, handle.colors), ...brushRequests(smear, handle.colors)]), what: "brush sheet and smear sheet" });
});

test("the sample pass places focused contours as shapeSamples does", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const scene = new SceneRecorder(FOCUSED_SIZE).record(drawFocused).scene;
  const reqs = brushRequests(scene, handle.colors);
  const w = await compareSamples(handle, reqs);
  report(t, { w, what: "focused contours" });
  const counts = reqs.map((r) => prepare(r)?.contours.map((c) => c.count));
  assert.deepEqual(counts[0], [1], "shorter than one step: one sample");
  assert.deepEqual(counts[5], [11], "2.85 at step 0.3: eleven samples");
  assert.deepEqual(counts.slice(-3), [[17], [0], [1]], "the corner path, the empty contour, the closed dot");
});

test("the sample pass places the walker's first frame as shapeSamples does, and repeats exactly", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined || text === undefined) return;
  const [scene] = portFrames(walkerSheet, { at: [0], text });
  assert.ok(scene !== undefined);
  const reqs = brushRequests(scene, handle.colors);
  report(t, { w: await compareSamples(handle, reqs), what: `walker frame 0 (${reqs.length} strokes)` });
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
