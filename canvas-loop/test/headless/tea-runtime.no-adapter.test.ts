// No GPU adapter: a scene run writes its transcript (the header and the
// failure line), then throws `NoGpuAdapterError` naming that transcript; no
// frame is written. The GPU entry here is a stand-in whose `requestAdapter`
// finds none, so this file opens no real device.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { openOn } from "../../src/device/browser.js";
import { NoGpuAdapterError } from "../../src/scene/errors.js";
import { teaRun } from "../../src/headless/tea-runtime/runner.js";
import { toTeaModule } from "../../src/headless/tea-load.js";
import { readTranscript, teaRunOptions, tmpDir } from "../helpers.js";

/** A GPU entry with no adapter, as Dawn is on a machine with no usable Vulkan driver. */
const noAdapters = { requestAdapter: (): Promise<null> => Promise.resolve(null) };

test("no GPU adapter: the transcript is written, then NoGpuAdapterError names it; no frame is written", async () => {
  const module = toTeaModule({ canvas: { width: 40, height: 30 }, init: () => ({}), update: (m: object) => m, draw: () => null });
  const outDir = tmpDir();
  const unusedColors = (): never => assert.fail("colours are not parsed without an adapter");
  const unusedRaster = (): never => assert.fail("glyphs are not drawn without an adapter");
  // eslint-disable-next-line no-restricted-syntax -- test stand-in: openOn calls only requestAdapter before it finds none
  const openGpu = () => openOn(noAdapters as unknown as GPU, { colors: unusedColors, raster: unusedRaster, timestamps: false });
  const error: unknown = await teaRun(teaRunOptions(module, { outDir, frames: 3, openGpu })).then(
    () => assert.fail("the run should throw"),
    (e: unknown) => e,
  );
  assert.ok(error instanceof NoGpuAdapterError, `the class (got ${String(error)})`);
  assert.equal(error.transcriptPath, join(outDir, "transcript.md"));
  assert.match(error.message, /possible causes: .*Vulkan driver/iu);
  assert.deepEqual(readdirSync(outDir), ["transcript.md"], "no frame is written");
  const transcript = readTranscript(outDir);
  assert.match(transcript, /^# canvas-loop transcript\n/u);
  assert.match(transcript, /^- canvas: 40x30$/mu);
  assert.match(transcript, /^error in setup: NoGpuAdapterError: no GPU adapter: /mu);
});
