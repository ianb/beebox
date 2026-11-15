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

  test(`a callback the sketch scheduled is guarded too, and its error ends the run (${surface})`, async () => {
    let seen: number | undefined;
    const module = onSurface(toTeaModule({
      canvas: { width: 20, height: 20 },
      init: () => {
        queueMicrotask(() => {
          seen = Math.random();
        });
        return {};
      },
      update: (model: object) => model,
      draw: (v: View) => v.background("#000000"),
    }), surface);
    const dir = tmpDir();
    const result = await teaRun(teaRunOptions(module, { outDir: dir, frames: 3 }));
    assert.equal(seen, undefined, "the callback did not get a random number");
    assert.equal(result.errors.length, 1, result.errors.join("\n"));
    assert.match(result.errors[0] ?? "", /error in a callback the sketch scheduled: DeterminismError: Math\.random\(\) is unavailable.* \(at test\/headless\/tea-runtime\.guards\.gpu\.test\.ts:\d+:\d+\)$/u);
    assert.ok(readTranscript(dir).includes("error in a callback the sketch scheduled: DeterminismError"));
    assert.equal(typeof Math.random(), "number", "Math.random works again after the run");
  });

  test(`a promise callback the sketch scheduled is guarded, and its rejection ends the run (${surface})`, async () => {
    const module = onSurface(toTeaModule({
      canvas: { width: 20, height: 20 },
      init: () => {
        void Promise.resolve().then(() => Math.random());
        return {};
      },
      update: (model: object) => model,
      draw: (v: View) => v.background("#000000"),
    }), surface);
    const result = await teaRun(teaRunOptions(module, { outDir: tmpDir(), frames: 2 }));
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0] ?? "", /error in a callback the sketch scheduled: DeterminismError: Math\.random\(\)/u);
  });

  test(`a getter in the model runs under the guards when the runner freezes it (${surface})`, async () => {
    let cached: number | undefined;
    const module = onSurface(toTeaModule({
      canvas: { width: 20, height: 20 },
      init: () => ({
        get x(): number {
          cached ??= Math.random();
          return cached;
        },
      }),
      update: (model: object) => model,
      draw: (v: View) => v.background("#000000"),
    }), surface);
    const result = await teaRun(teaRunOptions(module, { outDir: tmpDir(), frames: 2 }));
    assert.equal(cached, undefined);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0] ?? "", /^error in init: DeterminismError: Math\.random\(\)/u);
  });
}

test("a second teaRun while one is running is refused, and the first restores the console", async () => {
  const module = toTeaModule({ canvas: { width: 20, height: 20 }, init: () => ({}), update: (m: object) => m, draw: (v: View) => v.background("#000000") });
  const log = console.log;
  const [first, second] = await Promise.allSettled([teaRun(teaRunOptions(module, { outDir: tmpDir(), frames: 3 })), teaRun(teaRunOptions(module, { outDir: tmpDir(), frames: 3 }))]);
  assert.equal(first.status, "fulfilled");
  assert.equal(second.status, "rejected");
  assert.match(second.status === "rejected" ? String(second.reason) : "", /teaRun is already running in this process/u);
  assert.equal(console.log, log, "console.log is restored");
});
