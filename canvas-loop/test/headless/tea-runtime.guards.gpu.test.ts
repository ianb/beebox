import assert from "node:assert/strict";
import { test } from "node:test";
import { teaRun } from "../../src/headless/tea-runtime/runner.js";
import { toTeaModule } from "../../src/headless/tea-load.js";
import type { LoadedTeaModule } from "../../src/headless/tea-load.js";
import type { View } from "../../src/core/tea.js";
import { SURFACES, onSurface, readTranscript, teaRunOptions, tmpDir } from "../helpers.js";
import type { SurfaceName } from "../helpers.js";

function guardModule(offend: () => void, surface: SurfaceName): LoadedTeaModule {
  return onSurface(toTeaModule({
    canvas: { width: 20, height: 20 },
    init: () => ({}),
    update: (model: object) => model,
    draw: (v: View) => {
      v.background("#000000");
      offend();
    },
  }), surface);
}

for (const surface of SURFACES) {
  test(`Math.random() inside a sketch is a determinism error pointing at u.random() (${surface})`, async () => {
    const dir = tmpDir();
    const result = await teaRun(teaRunOptions(guardModule(() => void Math.random(), surface), { outDir: dir, frames: 3 }));
    assert.equal(result.errors.length, 1, "run reported one error");
    const [message] = result.errors;
    assert.ok(message !== undefined && message.includes("Math.random"), "names the offending API");
    assert.ok(message.includes("u.random()"), "points at the seeded replacement");
    assert.match(message, /\(at test\/headless\/tea-runtime\.guards\.gpu\.test\.ts:\d+:\d+\)$/u, "names the sketch's line");
    const transcript = readTranscript(dir);
    assert.ok(transcript.includes("frame 0: error in draw: DeterminismError"), "transcript records the error");
  });

  test(`Date.now() inside a sketch is a determinism error pointing at the tick msg (${surface})`, async () => {
    const dir = tmpDir();
    const result = await teaRun(teaRunOptions(guardModule(() => void Date.now(), surface), { outDir: dir, frames: 3 }));
    assert.equal(result.errors.length, 1);
    const [message] = result.errors;
    assert.ok(message !== undefined && message.includes("Date.now"), "names Date.now");
    assert.ok(message.includes("tick msg"), "points at the tick msg");
  });

  test(`nondeterministic globals are restored after a run (${surface})`, async () => {
    const dir = tmpDir();
    await teaRun(teaRunOptions(guardModule(() => {}, surface), { outDir: dir, frames: 2 }));
    assert.equal(typeof Math.random(), "number", "Math.random works again");
    assert.equal(typeof Date.now(), "number", "Date.now works again");
  });
}
