import assert from "node:assert/strict";
import { test } from "node:test";
import { teaRun } from "../../src/headless/tea-runtime.js";
import { toTeaModule } from "../../src/headless/tea-load.js";
import type { LoadedTeaModule } from "../../src/headless/tea-load.js";
import type { View } from "../../src/core/tea.js";
import { readTranscript, teaRunOptions, tmpDir } from "../helpers.js";

function guardModule(offend: () => void): LoadedTeaModule {
  return toTeaModule({
    canvas: { width: 20, height: 20 },
    init: () => ({}),
    update: (model: object) => model,
    draw: (v: View) => {
      v.background("#000000");
      offend();
    },
  });
}

test("Math.random() inside a sketch is a determinism error pointing at s.random()", () => {
  const dir = tmpDir();
  const result = teaRun(teaRunOptions(guardModule(() => void Math.random()), { outDir: dir, frames: 3 }));
  assert.equal(result.errors.length, 1, "run reported one error");
  const [message] = result.errors;
  assert.ok(message !== undefined && message.includes("Math.random"), "names the offending API");
  assert.ok(message.includes("s.random()"), "points at the seeded replacement");
  const transcript = readTranscript(dir);
  assert.ok(transcript.includes("ERROR DeterminismError"), "transcript records the error");
});

test("Date.now() inside a sketch is a determinism error pointing at s.millis()", () => {
  const dir = tmpDir();
  const result = teaRun(teaRunOptions(guardModule(() => void Date.now()), { outDir: dir, frames: 3 }));
  assert.equal(result.errors.length, 1);
  const [message] = result.errors;
  assert.ok(message !== undefined && message.includes("Date.now"), "names Date.now");
  assert.ok(message.includes("s.millis()"), "points at s.millis()");
});

test("nondeterministic globals are restored after a run", () => {
  const dir = tmpDir();
  teaRun(teaRunOptions(guardModule(() => {}), { outDir: dir, frames: 2 }));
  assert.equal(typeof Math.random(), "number", "Math.random works again");
  assert.equal(typeof Date.now(), "number", "Date.now works again");
});
