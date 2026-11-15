// Everything that needs a GPU, in one file so one process holds one Dawn
// device: the spike renderer against today's Skia renderer, judged by
// beebox/docs/plans/canvas-loop-scene/parity-criteria.md section 2, and the
// headless runner. Skipped, with a message, where Dawn finds no adapter.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { TestContext } from "node:test";
import type { GpuHandle } from "../../src/scene-spike/device.js";
import { openGpu } from "../../src/scene-spike/device.js";
import { GpuRenderer } from "../../src/scene-spike/gpu/renderer.js";
import { SceneRecorder } from "../../src/scene-spike/recorder/view.js";
import { runSpike } from "../../src/scene-spike/run/runner.js";
import type { Scene } from "../../src/scene-spike/scene.js";
import { readDirBytes, teaView, tmpDir } from "../helpers.js";
import { parity, premultiplied } from "./compare.js";
import { CASE_NAMES, drawDraft, drawToday, fixtures } from "./fixtures.js";
import { anisotropicEffects, clipUnions, failedFrames, offscreenShapes } from "./renderer-cases.js";
import { SHAPE_CELLS, drawShapesDraft, drawShapesToday } from "./shapes.js";

let gpu: GpuHandle | undefined;
before(async () => {
  gpu = await openGpu();
});
after(() => gpu?.destroy());

async function renderTwice(scene: Scene, handle: GpuHandle): Promise<Uint8Array> {
  const renderer = new GpuRenderer(handle);
  try {
    const first = await renderer.render(scene, 1);
    const second = await renderer.render(scene, 1);
    assert.ok(Buffer.from(first.data).equals(Buffer.from(second.data)), "a second render of the same scene gives the same bytes");
    return first.data;
  } finally {
    renderer.destroy();
  }
}

function needGpu(t: TestContext): GpuHandle | undefined {
  if (gpu === undefined) t.skip("Dawn found no GPU adapter on this machine; parity not checked");
  return gpu;
}

test("compositing fixtures match today's Skia renderer (1280×760)", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const names = [...CASE_NAMES, ...["multiply", "overlay", "add", "difference", "color-burn", "hue", "luminosity"].map((m) => `blend-${m}`)];
  const list = fixtures(names, 6);
  const size = { width: 1280, height: 760 };
  const nodes = list.flatMap((f) => f.nodes);
  const ref = teaView(size);
  drawToday(ref.v, nodes);
  const scene = new SceneRecorder(size).record((v) => drawDraft(v, nodes)).scene;
  const gpuPx = await renderTwice(scene, handle);
  const refPx = premultiplied(ref.pixels());
  const rows = list.map((f) => ({ name: f.name, ...parity({ ref: refPx, gpu: gpuPx }, { ...size, rect: f.rect }) }));
  for (const r of rows) t.diagnostic(`${r.pass ? "pass" : "FAIL"} ${r.name.padEnd(18)} flat ${r.flat}% edge ${r.edgeMean} max ${r.maxFlat}`);
  assert.deepEqual(rows.filter((r) => !r.pass).map((r) => r.name), []);
});

test("shapes, strokes, gradients and transforms match today's Skia renderer (640×480)", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const size = { width: 640, height: 480 };
  const ref = teaView(size);
  drawShapesToday(ref.v);
  const scene = new SceneRecorder(size).record((v) => drawShapesDraft(v));
  const gpuPx = await renderTwice(scene.scene, handle);
  const refPx = premultiplied(ref.pixels());
  const rows = SHAPE_CELLS.map((c) => ({ name: c.name, ...parity({ ref: refPx, gpu: gpuPx }, { ...size, rect: c.rect }) }));
  for (const r of rows) t.diagnostic(`${r.pass ? "pass" : "FAIL"} ${r.name.padEnd(18)} flat ${r.flat}% edge ${r.edgeMean} max ${r.maxFlat}`);
  assert.deepEqual(rows.filter((r) => !r.pass).map((r) => r.name), []);
});

const sketchPath = join(import.meta.dirname, "spike-sketch.ts");

test("runs a draft-View sketch, renders only captured frames, and repeats exactly", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const options = { sketchPath, frames: 5, every: 2, seed: 1, ratio: 1, scene: true, events: [{ frame: 3, type: "snapshot" as const }] };
  const a = tmpDir();
  const b = tmpDir();
  assert.deepEqual(await runSpike({ ...options, outDir: a }, handle), [0, 2, 3, 4]);
  await runSpike({ ...options, outDir: b }, handle);
  assert.deepEqual(readdirSync(a).toSorted(), ["frame-0000.png", "frame-0002.png", "frame-0003.png", "frame-0004.png", "transcript.md"]);
  const transcript = readFileSync(join(a, "transcript.md"), "utf8");
  assert.match(transcript, /frame 1: t 2/);
  assert.match(transcript, /!\[frame 4]\(frame-0004\.png\)/);
  assert.match(transcript, /group opacity 1 blend normal effects glow\n {4}circle/);
  const bytesA = readDirBytes(a);
  const bytesB = readDirBytes(b);
  for (const name of ["frame-0000.png", "frame-0004.png"]) assert.ok(bytesA.get(name)?.equals(bytesB.get(name) ?? Buffer.alloc(0)), `${name} is byte-identical across runs`);
  assert.ok(!existsSync(join(a, "frame-0001.png")));
});

test("a group just above the canvas still casts its shadow onto it (R5 bounds)", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const scene = new SceneRecorder({ width: 120, height: 80 }).record((v) => {
    v.group({ effects: { shadow: { x: 0, y: 50, blur: 4, color: "#000000" } } }, () => v.rect(30, -40, 60, 32, { fill: "#6d597a" }));
  }).scene;
  const renderer = new GpuRenderer(handle);
  try {
    const px = await renderer.render(scene, 1);
    const alphaAt = (x: number, y: number): number => px.data[(y * px.width + x) * 4 + 3] ?? 0;
    assert.ok(alphaAt(60, 20) > 200, `the shadow reaches into the canvas (alpha ${alphaAt(60, 20)})`);
    assert.equal(alphaAt(10, 20), 0);
  } finally {
    renderer.destroy();
  }
});

test("shapes off the canvas are culled or cut, never aborting the frame", async (t) => {
  const handle = needGpu(t);
  if (handle !== undefined) await offscreenShapes(handle);
});

test("a clip union is the geometric union: repeats, shared edges, overlaps, holes", async (t) => {
  const handle = needGpu(t);
  if (handle !== undefined) await clipUnions(handle);
});

test("effects follow an axis-aligned non-uniform scale; rotated non-uniform scales and skews are refused", async (t) => {
  const handle = needGpu(t);
  if (handle !== undefined) await anisotropicEffects(handle);
});

test("a failed frame closes its error scopes and frees its resources", async (t) => {
  const handle = needGpu(t);
  if (handle !== undefined) await failedFrames(handle);
});
