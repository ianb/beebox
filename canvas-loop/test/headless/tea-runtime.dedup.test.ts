import assert from "node:assert/strict";
import { test } from "node:test";
import { teaRun } from "../../src/headless/tea-runtime.js";
import { toTeaModule } from "../../src/headless/tea-load.js";
import type { View } from "../../src/core/tea.js";
import { readDirBytes, readTranscript, teaRunOptions, tmpDir } from "../helpers.js";

// A sketch that renders the exact same frame every time: no motion, no logs.
const staticSketch = toTeaModule({
  canvas: { width: 30, height: 30 },
  init: () => ({}),
  update: (model: object) => model,
  draw: (v: View) => {
    v.background("#000000");
    v.circle(15, 15, 6, { fill: "#ff0000" });
  },
});

test("identical frames are captured once and referenced as unchanged", () => {
  const dir = tmpDir();
  const result = teaRun(teaRunOptions(staticSketch, { outDir: dir, frames: 6, every: 2 }));

  assert.equal(result.imageCount, 1, "only one PNG is written for identical frames");
  const files = [...readDirBytes(dir).keys()];
  assert.deepEqual(files, ["frame-0000.png", "transcript.md"], "no duplicate PNGs on disk");

  const transcript = readTranscript(dir);
  assert.ok(transcript.includes("### frame 2 (unchanged)"), "unchanged frame is noted");
  assert.ok(
    transcript.includes("![frame 2](frame-0000.png)"),
    "unchanged frame references the first PNG",
  );
});
