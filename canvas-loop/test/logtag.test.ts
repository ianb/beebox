import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "../src/headless/runtime.js";
import type { Sketch, SketchModule } from "../src/headless/sketch.js";
import { readTranscript, runOptions, tmpDir } from "./helpers.js";

const module: SketchModule = {
  setup(s: Sketch) {
    s.createCanvas(20, 20);
  },
  draw(s: Sketch) {
    s.background("#000000");
    if (s.frameCount === 2) console.log("via-console");
    if (s.frameCount === 3) s.log("via-log");
  },
};

test("log lines are tagged with the frame they happened during", () => {
  const dir = tmpDir();
  run(runOptions(module, { outDir: dir, frames: 5 }));
  const transcript = readTranscript(dir);
  assert.ok(transcript.includes("**[frame 2]** log: via-console"), "console.log routed and tagged");
  assert.ok(transcript.includes("**[frame 3]** log: via-log"), "s.log() tagged with its frame");
});
