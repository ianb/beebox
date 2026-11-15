import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { loadImage, Canvas } from "@napi-rs/canvas";
import { encodeZoomPng, parseZoom } from "../../../src/headless/recorder/zoom.js";
import { toTeaModule } from "../../../src/headless/tea-load.js";
import { teaRun } from "../../../src/headless/tea-runtime/runner.js";
import type { View } from "../../../src/core/tea.js";
import { readTranscript, teaRunOptions, tmpDir } from "../../helpers.js";

test("parseZoom reads x,y,w,h with an optional @scale", () => {
  assert.deepEqual(parseZoom("10,20,30,40"), { x: 10, y: 20, w: 30, h: 40, scale: 3 });
  assert.deepEqual(parseZoom("0,0,8,8@6"), { x: 0, y: 0, w: 8, h: 8, scale: 6 });
  assert.throws(() => parseZoom("10,20,30"), /must be x,y,w,h/);
  assert.throws(() => parseZoom("0,0,0,10"), /positive width/);
  assert.throws(() => parseZoom("0,0,1000,1000@3"), /over 2400px/);
});

test("a run with zooms writes a crop beside each captured frame and lists it in the transcript", async () => {
  const outDir = tmpDir();
  const module = toTeaModule({
    canvas: { width: 40, height: 40 },
    init: () => ({}),
    update: (model: object) => model,
    draw: (v: View): void => v.background("#336699"),
  });
  await teaRun(teaRunOptions(module, { outDir, frames: 1, zooms: [parseZoom("5,5,10,10@4")] }));
  assert.ok(existsSync(join(outDir, "frame-0000-zoom1.png")));
  assert.match(readTranscript(outDir), /zoom 5,5 10×10 ×4\n!\[frame 0 zoom 5,5 10×10 ×4]\(frame-0000-zoom1\.png\)/);
});

test("at --ratio 2 a crop reads the same canvas region from the device pixels, at its logical size", async () => {
  // A 10×10 canvas at ratio 2 is 20×20 device pixels; a red mark covers canvas (4,2)–(6,4), device (8,4)–(12,8).
  const width = 20;
  const data = new Uint8ClampedArray(width * width * 4);
  for (let y = 4; y < 8; y++) for (let x = 8; x < 12; x++) data.set([255, 0, 0, 255], (y * width + x) * 4);
  const png = encodeZoomPng({ width, height: width, data }, { zoom: parseZoom("4,2,2,2@4"), ratio: 2 });
  const image = await loadImage(png);
  assert.deepEqual([image.width, image.height], [8, 8], "the logical size times the scale");
  const ctx = new Canvas(8, 8).getContext("2d");
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, 8, 8).data;
  for (let i = 0; i < pixels.length; i += 4) assert.deepEqual([...pixels.slice(i, i + 4)], [255, 0, 0, 255], `pixel ${i / 4} is the mark`);
});
