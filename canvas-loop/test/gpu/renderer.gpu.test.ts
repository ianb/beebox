// The scene renderer against the Skia painter's renders (frozen in
// test/fixtures/scene-parity/ before the painter was deleted), judged by
// beebox/docs/plans/canvas-loop-scene/parity-criteria.md section 2, and the
// headless runner on the scene surface. One Dawn device for the file: the
// runner's own (`sharedGpu`). Skipped, with a message, where Dawn finds no
// adapter.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { before, test } from "node:test";
import type { TestContext } from "node:test";
import type { TextMeasurer } from "../../src/core/text/measure.js";
import type { GpuHandle } from "../../src/device/open.js";
import { openTextMeasurer } from "../../src/device/open.js";
import { GpuRenderer } from "../../src/gpu/renderer.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";
import { sharedGpu } from "../../src/headless/scene/surface.js";
import { toTeaModule } from "../../src/headless/tea-load.js";
import { teaRun } from "../../src/headless/tea-runtime/runner.js";
import type { Scene } from "../../src/scene/nodes.js";
import type { Drawing, Picture, View } from "../../src/core/tea.js";
import type { Model } from "./dev-loop/cases.js";
import { readDirBytes, readTranscript, teaRunOptions, tmpDir } from "../helpers.js";
import { parity } from "./compare.js";
import { CASE_NAMES, drawDraft, fixtures } from "./fixtures.js";
import { brushBlends, brushParity, frozen, brushStability, expansionCache, paperScopes } from "./brush-cases.js";
import { pictureBackground, pixelImages, placeOptions, placementReplays } from "./picture-cases.js";
import { anisotropicEffects, clipUnions, failedFrames, offscreenShapes } from "./renderer-cases.js";
import { rotatedText, textParity } from "./text-cases.js";
import { hatchingAmount, hatchingTones, painterlyBounds, painterlyRepeats, pigmentMoves, washCanvasEdge } from "./paint-cases.js";
import { casterHeights, casterOnCaster, casterOutlineFringe, lightPeaks, smoothPenumbra, castingAmount, featheredCoverage, fullCone, hardEdges, litRepeats, lightsInPictures, materialScopes, nestedLighting, scaledTallCaster, stableShadowGrain, thinTallCaster, toneCurve, touchingCasters, translucentMaterial, zeroHeightFloor } from "./light-cases.js";
import { halfOverReceiver, materialLayerCount, nonReceivingCaster, placedNonReceiver, skyKeepsLight, translucentNonReceiver } from "./receives-shadow-cases.js";
import { SHAPE_CELLS, drawShapesDraft } from "./shapes.js";
import { cacheEquivalence, portFrames, sameWarmColdOff } from "./cache-cases.js";
import { everyPlacementSnaps, overlappingContourClip, rasterMemory, smudgeAcrossTiles, tilePlacedTwice, wideReadingPicture } from "./raster-cases.js";
import { keptPictureFaint, peakVariantSameBytes, peaksMeasured } from "./peak-cases.js";
import { CASES } from "./dev-loop/cases.js";
import { runCase } from "./dev-loop/run-case.js";
import * as sceneSketchModule from "./scene-sketch.js";
import * as walkerSheet from "../../src/gallery/intra-walk-styles/sketch-tea.js";
import * as hallwayPort from "../../src/gallery/intra-rooms/sketch-tea.js";
import * as chemistryPort from "../../src/gallery/balance-reaction-2/sketch-tea.js";

let gpu: GpuHandle | undefined;
let text: TextMeasurer | undefined;
before(async () => {
  gpu = await sharedGpu();
  text = await openTextMeasurer();
});

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
  const scene = new SceneRecorder(size).record((v) => drawDraft(v, nodes)).scene;
  const gpuPx = await renderTwice(scene, handle);
  const refPx = await frozen("compositing", size);
  const rows = list.map((f) => ({ name: f.name, ...parity({ ref: refPx, gpu: gpuPx }, { ...size, rect: f.rect }) }));
  for (const r of rows) t.diagnostic(`${r.pass ? "pass" : "FAIL"} ${r.name.padEnd(18)} flat ${r.flat}% edge ${r.edgeMean} max ${r.maxFlat}`);
  assert.deepEqual(rows.filter((r) => !r.pass).map((r) => r.name), []);
});

test("shapes, strokes, dashes, gradients and transforms match today's Skia renderer (640×600)", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const size = { width: 640, height: 600 };
  const scene = new SceneRecorder(size).record((v) => drawShapesDraft(v));
  const gpuPx = await renderTwice(scene.scene, handle);
  const refPx = await frozen("shapes", size);
  const rows = SHAPE_CELLS.map((c) => ({ name: c.name, ...parity({ ref: refPx, gpu: gpuPx }, { ...size, rect: c.rect }) }));
  for (const r of rows) t.diagnostic(`${r.pass ? "pass" : "FAIL"} ${r.name.padEnd(18)} flat ${r.flat}% edge ${r.edgeMean} max ${r.maxFlat}`);
  assert.deepEqual(rows.filter((r) => !r.pass).map((r) => r.name), []);
  // A dash through a closed path's start is joined there, as Skia's: two caps instead differ by 200+ at the corner.
  assert.ok((rows.find((r) => r.name === "dash-closed")?.maxFlat ?? 255) < 20, "closed dashes join at the seam");
});

const sceneSketch = toTeaModule(sceneSketchModule);

test("runs a scene-View sketch, renders only captured frames, and repeats exactly", async (t) => {
  if (needGpu(t) === undefined) return;
  const events = [{ frame: 4, type: "snapshot" as const }, { frame: 4, type: "param" as const, name: "speed", value: 2 }];
  const options = { frames: 7, every: 3, seed: 1, scene: true, timing: true, events };
  const a = tmpDir();
  const b = tmpDir();
  // Every 3rd (0, 3, 6), the logged frame (1) and the snapshot (4); frames 2 and 5 are skipped.
  assert.deepEqual((await teaRun(teaRunOptions(sceneSketch, { ...options, outDir: a }))).errors, []);
  await teaRun(teaRunOptions(sceneSketch, { ...options, outDir: b }));
  assert.deepEqual(readdirSync(a).toSorted(), ["frame-0000.png", "frame-0001.png", "frame-0003.png", "frame-0004.png", "frame-0006.png", "transcript.md"]);
  const transcript = readTranscript(a);
  assert.match(transcript, /^- adapter: ./m);
  assert.match(transcript, /^\*\*\[frame 1]\*\* log: t 2$/m);
  assert.match(transcript, /^\*\*\[frame 4]\*\* param: speed → 2$/m);
  assert.match(transcript, /^### frame 4\n!\[frame 4]\(frame-0004\.png\)/m);
  assert.match(transcript, /group opacity 1 blend normal effects glow\n {4}circle/);
  // `--timing`: the renderer's counts under each captured frame; the cached brush expansion is reused on frame 1.
  assert.match(transcript, /### frame 0\n.*\n\n\*\*\[frame 0]\*\* log: render: passes \d+, .*brushed strokes 1 \(expanded 1, cache hits 0\)/);
  assert.match(transcript, /### frame 1\n.*\n\n\*\*\[frame 1]\*\* log: render: passes \d+, .*brushed strokes 1 \(expanded 0, cache hits 1\)/);
  assert.match(transcript, /text "t 4" 12px sans-serif/);
  assert.match(transcript, /picture "badge" 30×16\n {2}rect/);
  assert.doesNotMatch(transcript, /warn:/);
  const bytesA = readDirBytes(a);
  const bytesB = readDirBytes(b);
  for (const name of ["frame-0000.png", "frame-0004.png"]) assert.ok(bytesA.get(name)?.equals(bytesB.get(name) ?? Buffer.alloc(0)), `${name} is byte-identical across runs`);
  assert.ok(!existsSync(join(a, "frame-0002.png")), "frame 2 is not captured");
});

test("--scene first writes the outline for the first captured frame only", async (t) => {
  if (needGpu(t) === undefined) return;
  const outDir = tmpDir();
  assert.deepEqual((await teaRun(teaRunOptions(sceneSketch, { outDir, frames: 4, every: 2, seed: 1, scene: "first" }))).framesRun, 4);
  const transcript = readTranscript(outDir);
  assert.equal(transcript.match(/^scene 160×120$/gm)?.length, 1);
  assert.match(transcript, /### frame 0\n!\[frame 0]\(frame-0000\.png\)\n\n```\nscene 160×120\n/);
});

test("--outline draws debug boxes, clips and placed pictures over the frame; without it the frame has none", async (t) => {
  if (needGpu(t) === undefined) return;
  const plain = tmpDir();
  const outlined = tmpDir();
  await teaRun(teaRunOptions(sceneSketch, { outDir: plain, frames: 1 }));
  await teaRun(teaRunOptions(sceneSketch, { outDir: outlined, frames: 1, outline: true }));
  const a = readFileSync(join(plain, "frame-0000.png"));
  const b = readFileSync(join(outlined, "frame-0000.png"));
  assert.ok(!a.equals(b), "the placed badge is outlined");
});

test("a group just above the canvas still casts its shadow onto it (R5 bounds)", async (t) => {
  const handle = needGpu(t);
  if (handle === undefined) return;
  const scene = new SceneRecorder({ width: 120, height: 80 }).record((v) => {
    return v.group({ effects: { shadow: { x: 0, y: 50, blur: 4, color: "#000000" } } }, v.rect(30, -40, 60, 32, { fill: "#6d597a" }));
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
onGpu("a wash is continuous past the canvas edge: no rim along the border; edges inside the canvas still dry", washCanvasEdge);
onGpu("hatching follows tone relative to the group: light bare, mid hatched, dark cross-hatched", hatchingTones);
onGpu("R8: a caster blocks by its casting amount; half alpha blocks half; an erased part casts nothing", castingAmount);
onGpu("R8: a nested lit group is lit only by its own lights, and not lit again", nestedLighting);
onGpu("R8: a light in a placed picture lights the room wherever it is placed", lightsInPictures);
onGpu("R8: a placement supplies a material; materials are ignored outside a lit group", materialScopes);
onGpu("R8: shading takes material per unit of coverage, so a translucent emissive shape is not dimmed twice", translucentMaterial);
onGpu("R8: a feathered mask and a blurred nested lit group cut colour and material alike", featheredCoverage);
onGpu("R8: a spot with a full-angle cone lights as a point light", fullCone);
onGpu("R8: caster and light heights set a shadow's length", casterHeights);
onGpu("R8: a pixel on a caster is shadowed only by taller casters", casterOnCaster);
onGpu("R8: heights, exposure and the tone curve repeat byte for byte, at ratio 1 and 2", litRepeats);
onGpu("R8: the tone curve is monotonic; at full strength highlights roll off and darks deepen", toneCurve);
onGpu("R8: a zero-height caster casts nothing, so a floor at height 0 still receives shadows", zeroHeightFloor);
onGpu("R8: a taller caster shadows a shorter one it touches", touchingCasters);
onGpu("R8: a thin, very tall caster under a low directional light is not skipped by the march", thinTallCaster);
onGpu("R8: hard shadows read casters unblurred; soft ones blur them", hardEdges);
onGpu("R8: a caster made taller than 1024 by a transform keeps its height", scaledTallCaster);
onGpu("R8: shadow grain is keyed to canvas pixels, not the layer's bounds", stableShadowGrain);
onGpu("R8: a soft shadow's penumbra is smooth, not speckled by the march", smoothPenumbra);
onGpu("R8: a caster's outline on its shadowed side is not lit like open floor", casterOutlineFringe);
onGpu("R8: --scene reports each light's peak and where it is, as rendered; a spot peaks on its beam", lightPeaks);
onGpu("section 21: a non-receiving sky behind a caster keeps its lit pixels; the floor below still takes the shadow", skyKeepsLight);
onGpu("section 21: a half-transparent non-receiving shape alone receives no shadow, its antialiased edge included", translucentNonReceiver);
onGpu("section 21: a half-transparent non-receiving shape over an opaque receiver receives half the shadow", halfOverReceiver);
onGpu("section 21: a placement's material supplies receivesShadow", placedNonReceiver);
onGpu("section 21: a non-receiving caster still casts", nonReceivingCaster);
onGpu("section 21: a lit group without receivesShadow: false draws two material layers, as before", materialLayerCount);
onGpu("hatching amount sets how many lines show at a tone, not only how dark", hatchingAmount);

onGpu("cached, uncached and cold renders give the same bytes (draft section 6): moving frames, ratio 1 and 2", async (handle, t) => {
  await cacheEquivalence(handle, { t, text });
});
onGpu("cached, uncached and cold renders give the same bytes: the walker sheet, the Hallway and chemistry exercises", async (handle, t) => {
  if (text === undefined) return;
  const ports = [
    { name: "walker sheet", mod: walkerSheet, at: [1, 2, 3] },
    // The Hallway pans from frame 301: still frames, then panning ones.
    { name: "Hallway", mod: hallwayPort, at: [1, 2, 330, 331, 332], params: { room: "hallway" } },
    { name: "chemistry", mod: chemistryPort, at: [1, 2, 3] },
  ];
  for (const p of ports) {
    const scenes = portFrames(p.mod, { at: p.at, text, ...("params" in p ? { params: p.params } : {}) });
    const used = await sameWarmColdOff(handle, { scenes, ratio: 1, what: p.name });
    t.diagnostic(`${p.name}: warm renderer reused ${used.kept} geometry entries, ${used.tiles} picture tiles, ${used.strokes} brush expansions`);
  }
});
onGpu("kept rasters stay inside the budget: dropped versions' textures are destroyed", rasterMemory);
onGpu("a picture with a smudge across the tile edge draws as one layer, as a group does", smudgeAcrossTiles);
onGpu("a tile placed twice in a frame is drawn once and kept once", tilePlacedTwice);
onGpu("a clip to a path whose contours overlap keeps winding coverage", overlappingContourClip);
onGpu("a wide picture that reads its surroundings is one layer over what can be seen of it", wideReadingPicture);
onGpu("pixels images and pictures in a lit group snap to whole device pixels (draft 2.6)", everyPlacementSnaps);

onGpu("testing mode's faint-mark readback leaves the colour output byte-identical", peakVariantSameBytes);
onGpu("a mark's measured peak is its resolved alpha times its groups' opacities; erasing marks are not measured", peaksMeasured);
onGpu("a picture tile reused from an earlier frame keeps its marks' peaks, times the opacity it is placed at now", keptPictureFaint);

// The dev-loop checklist (beebox/docs/plans/canvas-loop-scene/stage4/dev-loop.md): each deliberately bad
// sketch runs through the headless runner, and its message must come out on the expected channel naming
// what the row says. A row with a gap is todo: its proposal needs a decision.
for (const c of CASES) {
  test(`dev loop, ${c.id}: ${c.mistake}`, c.gap === undefined ? {} : { todo: c.gap }, async (t) => {
    const handle = needGpu(t);
    if (handle === undefined) return;
    const out = await runCase(c);
    switch (c.channel) {
      case "error": {
        assert.ok(out.error !== undefined, `the run throws (transcript warnings: ${out.warnings.join("; ") || "none"})`);
        // The transcript's last part: the error line and the sketch's stack lines.
        const at = out.transcript.search(/^(frame \d+: )?error in (init|update|draw|render): /m);
        assert.ok(at >= 0, "the transcript has the error line");
        const tail = out.transcript.slice(at);
        for (const name of c.names) {
          assert.match(out.error, name);
          assert.match(tail, name, "the transcript names it too");
        }
        if (c.noSketchLine === undefined) assert.match(tail, /\n {2}at test\/gpu\/dev-loop\/cases\.ts:\d+:\d+/, "the transcript gives the sketch's line");
        else assert.doesNotMatch(tail, /\n {2}at /, `no sketch line: ${c.noSketchLine}`);
        break;
      }
      case "warning":
        assert.equal(out.error, undefined);
        for (const name of c.names) assert.match(out.warnings.join("\n"), name);
        break;
      case "none":
        assert.equal(out.error, undefined);
        assert.deepEqual(out.warnings, []);
        for (const shown of c.outline ?? []) assert.match(out.transcript, shown);
        break;
    }
  });
}

onGpu("section 10: a picture placed at a new rotation every frame gets one performance hint; fixed scales get none", async () => {
  const out = await runCase({
    id: "turning-picture",
    mistake: "a picture placed under a rotation that changes every frame",
    channel: "none",
    names: [],
    frames: 6,
    draw: (v, m) => {
      const drawn: Drawing[] = [];
      const badge = v.picture({ key: "badge", width: 20, height: 20 }, () => v.rect(0, 0, 20, 20, { fill: "#2a9d8f" }));
      drawn.push(v.at({ translate: [30, 30], rotate: m.t * 0.1 }, v.place(badge, -10, -10)));
      // Two fixed scales of one key, every frame: two kept versions, nothing to hint.
      const dot = v.picture({ key: "dot", width: 6, height: 6 }, () => v.circle(3, 3, 3, { fill: "#e63946" }));
      for (const s of [1, 2]) drawn.push(v.at({ scale: s }, v.place(dot, 2, 2)));
      return drawn;
    },
  });
  const hints = out.transcript.split("\n").filter((l) => l.includes("hint:"));
  assert.equal(hints.length, 1, hints.join("\n"));
  assert.match(hints[0] ?? "", /^\*\*\[frame 3]\*\* hint: picture "badge" was placed at a scale or rotation it has no kept image for in each of the last 3 frames .*\(at test\/gpu\/renderer\.gpu\.test\.ts:\d+:\d+\)$/);
  assert.deepEqual(out.warnings, []);
  // As the raster cache keys them: fixed scales placed in turn reuse their images (kept two frames); a change
  // too small to see in six decimals is still a new key every frame.
  const hintsFor = async (draw: (v: View, m: Model) => Drawing): Promise<string[]> => (await runCase({ id: "scales", mistake: "", channel: "none", names: [], frames: 8, draw })).transcript.split("\n").filter((l) => l.includes("hint:"));
  const tile = (v: View): Picture => v.picture({ key: "tile", width: 6, height: 6 }, () => v.rect(0, 0, 6, 6, { fill: "#2a9d8f" }));
  assert.deepEqual(await hintsFor((v, m) => {
    const drawn: Drawing[] = [];
    const p = tile(v);
    for (const s of [1, m.t % 2 === 0 ? 2 : 3]) drawn.push(v.at({ scale: s }, v.place(p, 2, 2)));
    return drawn;
  }), [], "scales {1, 2} and {1, 3} in turn");
  assert.equal((await hintsFor((v, m) => {
    const p = tile(v);
    return v.at({ scale: 1 + m.t * 1e-9 }, v.place(p, 2, 2));
  })).length, 1, "a scale growing by 1e-9 a frame");
});

onGpu("off the canvas: only what is off on every frame warns, once; unboxed text crossing the edge warns; a glow reaching in does not", async () => {
  const fill = { fill: "#2a9d8f" };
  const out = await runCase({
    id: "off-canvas-rule",
    mistake: "a label past the right edge, beside a ball that leaves the canvas on one frame",
    channel: "warning",
    names: [],
    frames: 3,
    draw: (v, m) => {
      // On the canvas on frames 0 and 1, off it on frame 2: moving, so not reported.
      return [
        v.circle(m.t * 40 - 20, 30, 5, fill),
        // Off the canvas, but its glow reaches 30 px in.
        v.group({ effects: { glow: { blur: 10, color: "#ffd166" } } }, v.rect(-30, 10, 25, 10, fill)),
        // A boxed label wraps inside its box; it is not checked for crossing.
        v.text("a long boxed label", { x: 60, y: 30, w: 15 }, { size: 10 }),
        v.text("Period: 2.00 s", { x: 60, y: 10 }, { size: 12 }),
      ];
    },
  });
  assert.equal(out.error, undefined);
  assert.equal(out.warnings.length, 1, out.warnings.join("\n"));
  assert.match(out.warnings[0] ?? "", /^\*\*\[frame 2]\*\* warn: text "Period: 2\.00 s" crosses the edge of the 80×60 canvas on every frame \(0–2\), .* \(at test\/gpu\/renderer\.gpu\.test\.ts:\d+:\d+\)$/);
});

onGpu("off the canvas: a loop that grows onto the canvas stays quiet; a picture placed off it, and an arc whose circle reaches it but whose sweep does not, warn", async () => {
  const fill = { fill: "#2a9d8f" };
  const out = await runCase({
    id: "off-canvas-more",
    mistake: "a picture placed in the wrong units, and an arc's sweep off the canvas",
    channel: "warning",
    names: [],
    frames: 3,
    draw: (v, m) => {
      const drawn: Drawing[] = [];
      // Frame 0: one rect, off the canvas; then a second one on it, from the same line.
      for (let i = 0; i < m.t; i++) drawn.push(v.rect(i === 0 ? 200 : 10, 10, 10, 10, fill));
      const p = v.picture({ key: "badge", width: 20, height: 10 }, () => v.rect(0, 0, 20, 10, fill));
      drawn.push(v.place(p, 1000, 1000));
      drawn.push(v.arc(150, 30, 100, -0.2, 0.2, { stroke: "#000000", weight: 2 }));
      return drawn;
    },
  });
  assert.equal(out.error, undefined);
  const warnings = out.warnings.join("\n");
  assert.equal(out.warnings.length, 2, warnings);
  assert.match(warnings, /place picture "badge" lands entirely off the 80×60 canvas on every frame \(0–2\), the first at \(1000,1000\)–\(1020,1010\)/);
  assert.match(warnings, /arc lands entirely off the 80×60 canvas/);
});
