// Everything that needs a GPU, in one file so one process holds one Dawn
// device: the spike renderer against today's Skia renderer, judged by
// beebox/docs/plans/canvas-loop-scene/parity-criteria.md section 2, and the
// headless runner. Skipped, with a message, where Dawn finds no adapter.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { TestContext } from "node:test";
import type { TextMeasurer } from "../../src/core/painter/text/measure.js";
import type { GpuHandle } from "../../src/scene-spike/device.js";
import { openGpu, openTextMeasurer } from "../../src/scene-spike/device.js";
import { GpuRenderer } from "../../src/scene-spike/gpu/renderer.js";
import { SceneRecorder } from "../../src/scene-spike/recorder/view.js";
import { runSpike } from "../../src/scene-spike/run/runner.js";
import type { Scene } from "../../src/scene-spike/scene.js";
import { readDirBytes, teaView, tmpDir } from "../helpers.js";
import { parity, premultiplied } from "./compare.js";
import { CASE_NAMES, drawDraft, drawToday, fixtures } from "./fixtures.js";
import { brushBlends, brushParity, brushStability, expansionCache, paperScopes } from "./brush-cases.js";
import { pictureBackground, pixelImages, placeOptions, placementReplays } from "./picture-cases.js";
import { anisotropicEffects, clipUnions, failedFrames, offscreenShapes } from "./renderer-cases.js";
import { rotatedText, textParity } from "./text-cases.js";
import { hatchingAmount, hatchingTones, painterlyBounds, painterlyRepeats, pigmentMoves } from "./paint-cases.js";
import { castingAmount, featheredCoverage, fullCone, lightsInPictures, materialScopes, nestedLighting, translucentMaterial } from "./light-cases.js";
import { SHAPE_CELLS, drawShapesDraft, drawShapesToday } from "./shapes.js";

let gpu: GpuHandle | undefined;
let text: TextMeasurer | undefined;
before(async () => {
  gpu = await openGpu();
  text = await openTextMeasurer();
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
  const options = { sketchPath, frames: 7, every: 3, seed: 1, ratio: 1, scene: true, events: [{ frame: 4, type: "snapshot" as const }] };
  const a = tmpDir();
  const b = tmpDir();
  // Every 3rd (0, 3, 6), the logged frame (1) and the snapshot (4); frames 2 and 5 are skipped.
  assert.deepEqual(await runSpike({ ...options, outDir: a }, handle), [0, 1, 3, 4, 6]);
  await runSpike({ ...options, outDir: b }, handle);
  assert.deepEqual(readdirSync(a).toSorted(), ["frame-0000.png", "frame-0001.png", "frame-0003.png", "frame-0004.png", "frame-0006.png", "transcript.md"]);
  const transcript = readFileSync(join(a, "transcript.md"), "utf8");
  assert.match(transcript, /frame 1: t 2/);
  assert.match(transcript, /!\[frame 4]\(frame-0004\.png\)/);
  assert.match(transcript, /group opacity 1 blend normal effects glow\n {4}circle/);
  assert.match(transcript, /## frame 0\n.*\n.*\nbrushed strokes 1: expanded 1, expansion cache hits 0/);
  assert.match(transcript, /## frame 1\n.*\n.*\nbrushed strokes 1: expanded 0, expansion cache hits 1/);
  assert.match(transcript, /text "t 4" 12px sans-serif/);
  assert.match(transcript, /picture "badge" 30×16\n {2}rect/);
  assert.doesNotMatch(transcript, /warning/);
  const bytesA = readDirBytes(a);
  const bytesB = readDirBytes(b);
  for (const name of ["frame-0000.png", "frame-0004.png"]) assert.ok(bytesA.get(name)?.equals(bytesB.get(name) ?? Buffer.alloc(0)), `${name} is byte-identical across runs`);
  assert.ok(!existsSync(join(a, "frame-0002.png")), "frame 2 is not captured");
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

/** Run a case that needs the device. */
function onGpu(name: string, run: (handle: GpuHandle, t: TestContext) => Promise<void>): void {
  test(name, async (t) => {
    const handle = needGpu(t);
    if (handle !== undefined) await run(handle, t);
  });
}

onGpu("brushed strokes match today's Skia marks by crop: luminance within 3%, contrast within 15%", brushParity);
onGpu("a brushed stroke takes the brush's blend unless the style sets one; a brush erases by its mark", brushBlends);
onGpu("unchanged strokes reuse their expansion, byte-identically; a new scale expands again", expansionCache);
onGpu("a brushed picture moved by whole pixels moves its texture with it", brushStability);
onGpu("paper is scoped to its group; a picture keeps the paper where it was recorded", paperScopes);
onGpu("placing a picture replays it under the placement transform (R7)", placementReplays);
onGpu("placement opacity, erase and blend apply to the picture's layer", placeOptions);
onGpu("background inside a picture fills the picture's box, not the canvas", pictureBackground);
onGpu("pixels images are sampled bilinearly at their own resolution", pixelImages);
onGpu("text sits where today's does, at today's size, through the glyph atlas", async (handle, t) => {
  if (text !== undefined) await textParity(handle, { t, text });
});
onGpu("text under a rotation draws through the glyph atlas", async (handle) => {
  if (text !== undefined) await rotatedText(handle, text);
});
onGpu("wash, hatching and paper repeat byte for byte, at ratio 1 and 2", painterlyRepeats);
onGpu("a wash's bleed grows the group's layer; hatching and paper never change alpha (R5)", painterlyBounds);
onGpu("pigment, hatching lines and paper texture move and turn with the group (section 4)", pigmentMoves);
onGpu("hatching follows tone relative to the group: light bare, mid hatched, dark cross-hatched", hatchingTones);
onGpu("R8: a caster blocks by its casting amount; half alpha blocks half; an erased part casts nothing", castingAmount);
onGpu("R8: a nested lit group is lit only by its own lights, and not lit again", nestedLighting);
onGpu("R8: a light in a placed picture lights the room wherever it is placed", lightsInPictures);
onGpu("R8: a placement supplies a material; materials are ignored outside a lit group", materialScopes);
onGpu("R8: shading takes material per unit of coverage, so a translucent emissive shape is not dimmed twice", translucentMaterial);
onGpu("R8: a feathered mask and a blurred nested lit group cut colour and material alike", featheredCoverage);
onGpu("R8: a spot with a full-angle cone lights as a point light", fullCone);
onGpu("hatching amount sets how many lines show at a tone, not only how dark", hatchingAmount);
