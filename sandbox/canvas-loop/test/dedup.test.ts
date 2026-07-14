import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "../src/runtime.js";
import type { Sketch } from "../src/sketch.js";
import type { SketchModule } from "../src/types.js";
import { readDirBytes, readTranscript, runOptions, tmpDir } from "./helpers.js";

// A sketch that renders the exact same frame every time: no motion, no logs.
const staticSketch: SketchModule = {
  setup(s: Sketch) {
    s.createCanvas(30, 30);
  },
  draw(s: Sketch) {
    s.background("#000000");
    s.fill("#ff0000");
    s.circle(15, 15, 12);
  },
};

test("identical frames are captured once and referenced as unchanged", () => {
  const dir = tmpDir();
  const result = run(runOptions(staticSketch, { outDir: dir, frames: 6, every: 2 }));

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
