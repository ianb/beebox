import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "../src/headless/runtime.js";
import type { Sketch, SketchModule } from "../src/headless/sketch.js";
import { readTranscript, runOptions, tmpDir } from "./helpers.js";

function guardModule(offend: (s: Sketch) => void): SketchModule {
  return {
    setup(s: Sketch) {
      s.createCanvas(20, 20);
    },
    draw(s: Sketch) {
      s.background("#000000");
      offend(s);
    },
  };
}

test("Math.random() inside a sketch is a determinism error pointing at s.random()", () => {
  const dir = tmpDir();
  const result = run(runOptions(guardModule(() => void Math.random()), { outDir: dir, frames: 3 }));
  assert.equal(result.errors.length, 1, "run reported one error");
  const [message] = result.errors;
  assert.ok(message !== undefined && message.includes("Math.random"), "names the offending API");
  assert.ok(message.includes("s.random()"), "points at the seeded replacement");
  const transcript = readTranscript(dir);
  assert.ok(transcript.includes("ERROR DeterminismError"), "transcript records the error");
});

test("Date.now() inside a sketch is a determinism error pointing at s.millis()", () => {
  const dir = tmpDir();
  const result = run(runOptions(guardModule(() => void Date.now()), { outDir: dir, frames: 3 }));
  assert.equal(result.errors.length, 1);
  const [message] = result.errors;
  assert.ok(message !== undefined && message.includes("Date.now"), "names Date.now");
  assert.ok(message.includes("s.millis()"), "points at s.millis()");
});

test("nondeterministic globals are restored after a run", () => {
  const dir = tmpDir();
  run(runOptions(guardModule(() => {}), { outDir: dir, frames: 2 }));
  assert.equal(typeof Math.random(), "number", "Math.random works again");
  assert.equal(typeof Date.now(), "number", "Date.now works again");
});
