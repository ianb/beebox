import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { teaRun } from "../../src/headless/tea-runtime/runner.js";
import { toTeaModule } from "../../src/headless/tea-load.js";
import type { LoadedTeaModule } from "../../src/headless/tea-load.js";
import type { Drawing, View } from "../../src/core/tea.js";
import { readTranscript, teaRunOptions, tmpDir } from "../helpers.js";

const REAL_THEN = Promise.prototype.then;

function guardModule(offend: () => void): LoadedTeaModule {
  return toTeaModule({
    canvas: { width: 20, height: 20 },
    init: () => ({}),
    update: (model: object) => model,
    draw: (v: View) => {
      const out: Drawing[] = [];
      out.push(v.background("#000000"));
      offend();
      return out;
    },
  });
}

test("Math.random() inside a sketch is a determinism error pointing at u.random()", async () => {
  const dir = tmpDir();
  const result = await teaRun(teaRunOptions(guardModule(() => void Math.random()), { outDir: dir, frames: 3 }));
  assert.equal(result.errors.length, 1, "run reported one error");
  const [message] = result.errors;
  assert.ok(message !== undefined && message.includes("Math.random"), "names the offending API");
  assert.ok(message.includes("u.random()"), "points at the seeded replacement");
  assert.match(message, /\(at test\/headless\/tea-runtime\.guards\.gpu\.test\.ts:\d+:\d+\)$/u, "names the sketch's line");
  const transcript = readTranscript(dir);
  assert.ok(transcript.includes("frame 0: error in draw: DeterminismError"), "transcript records the error");
});

test("Date.now() inside a sketch is a determinism error pointing at the tick msg", async () => {
  const dir = tmpDir();
  const result = await teaRun(teaRunOptions(guardModule(() => void Date.now()), { outDir: dir, frames: 3 }));
  assert.equal(result.errors.length, 1);
  const [message] = result.errors;
  assert.ok(message !== undefined && message.includes("Date.now"), "names Date.now");
  assert.ok(message.includes("tick msg"), "points at the tick msg");
});

test("nondeterministic globals are restored after a run", async () => {
  const dir = tmpDir();
  await teaRun(teaRunOptions(guardModule(() => {}), { outDir: dir, frames: 2 }));
  assert.equal(typeof Math.random(), "number", "Math.random works again");
  assert.equal(typeof Date.now(), "number", "Date.now works again");
});

test("scheduling from a sketch call is refused at the call: a microtask, a promise callback, a timer", async () => {
  const schedulers: Record<string, () => void> = {
    queueMicrotask: () => queueMicrotask(() => void Math.random()),
    "Promise.then": () => void Promise.resolve().then(() => Math.random()),
    setTimeout: () => void setTimeout(() => void Math.random(), 10),
  };
  for (const [api, schedule] of Object.entries(schedulers)) {
    const module = toTeaModule({
      canvas: { width: 20, height: 20 },
      init: () => {
        schedule();
        return {};
      },
      update: (model: object) => model,
      draw: (v: View) => v.background("#000000"),
    });
    const dir = tmpDir();
    const result = await teaRun(teaRunOptions(module, { outDir: dir, frames: 2 }));
    assert.equal(result.errors.length, 1, api);
    const message = `error in init: DeterminismError: ${api}() is unavailable inside canvas-loop sketches: sketch code runs synchronously; it cannot schedule work.`;
    assert.ok(result.errors[0]?.startsWith(message), `${api}: ${result.errors[0] ?? ""}`);
    assert.match(result.errors[0] ?? "", /\(at test\/headless\/tea-runtime\.guards\.gpu\.test\.ts:\d+:\d+\)$/u, `${api} names the sketch's line`);
    assert.ok(readTranscript(dir).includes(message), api);
  }
  assert.equal(Promise.prototype.then, REAL_THEN, "Promise.prototype.then is restored");
  assert.equal(typeof setTimeout(() => {}, 0), "object", "setTimeout works again");
});

test("accepted limitation: an async function the sketch starts and does not return runs its continuation unguarded", async () => {
  let after: number | undefined;
  const module = toTeaModule({
    canvas: { width: 20, height: 20 },
    init: () => {
      // Native await does not call Promise.prototype.then, so nothing refuses it; the continuation runs after init returned.
      void (async () => {
        await null;
        after = Math.random();
      })();
      return {};
    },
    update: (model: object) => model,
    draw: (v: View) => v.background("#000000"),
  });
  const result = await teaRun(teaRunOptions(module, { outDir: tmpDir(), frames: 2 }));
  assert.deepEqual(result.errors, []);
  assert.equal(typeof after, "number", "the continuation ran, outside the guards");
});

test("a getter in the model runs under the guards when the runner freezes it", async () => {
  let cached: number | undefined;
  const module = toTeaModule({
    canvas: { width: 20, height: 20 },
    init: () => ({
      get x(): number {
        cached ??= Math.random();
        return cached;
      },
    }),
    update: (model: object) => model,
    draw: (v: View) => v.background("#000000"),
  });
  const result = await teaRun(teaRunOptions(module, { outDir: tmpDir(), frames: 2 }));
  assert.equal(cached, undefined);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0] ?? "", /^error in init: DeterminismError: Math\.random\(\)/u);
});

test("a second teaRun while one is running is refused, and the first restores the console", async () => {
  const module = toTeaModule({ canvas: { width: 20, height: 20 }, init: () => ({}), update: (m: object) => m, draw: (v: View) => v.background("#000000") });
  const log = console.log;
  const [first, second] = await Promise.allSettled([teaRun(teaRunOptions(module, { outDir: tmpDir(), frames: 3 })), teaRun(teaRunOptions(module, { outDir: tmpDir(), frames: 3 }))]);
  assert.equal(first.status, "fulfilled");
  assert.equal(second.status, "rejected");
  assert.match(second.status === "rejected" ? String(second.reason) : "", /teaRun is already running in this process/u);
  assert.equal(console.log, log, "console.log is restored");
});

test("a throwing init that scheduled nothing leaves the process as it was", async () => {
  const before = { then: Promise.prototype.then, setTimeout, queueMicrotask, nextTick: process.nextTick, random: Math.random, log: console.log };
  const module = toTeaModule({ canvas: { width: 20, height: 20 }, init: () => {
    throw new RangeError("init failed");
  }, update: (m: object) => m, draw: () => null });
  const result = await teaRun(teaRunOptions(module, { outDir: tmpDir(), frames: 2 }));
  assert.match(result.errors[0] ?? "", /^error in init: RangeError: init failed/u);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual({ then: Promise.prototype.then, setTimeout, queueMicrotask, nextTick: process.nextTick, random: Math.random, log: console.log }, before);
});

test("a pre-installed once listener and uncaught-exception capture callback are untouched by a run", async () => {
  const once = (): void => {};
  process.once("unhandledRejection", once);
  const capture = (): void => {};
  process.setUncaughtExceptionCaptureCallback(capture);
  try {
    const raw = process.rawListeners("unhandledRejection");
    const module = toTeaModule({ canvas: { width: 20, height: 20 }, init: () => ({}), update: (m: object) => m, draw: () => null });
    assert.deepEqual((await teaRun(teaRunOptions(module, { outDir: tmpDir(), frames: 2 }))).errors, []);
    assert.deepEqual(process.rawListeners("unhandledRejection"), raw, "the once wrapper is the same, in the same place");
    assert.ok(process.hasUncaughtExceptionCaptureCallback());
  } finally {
    process.setUncaughtExceptionCaptureCallback(null);
    process.removeListener("unhandledRejection", once);
  }
});

test("a host timer that throws while a run is going still fails node:test", () => {
  const dir = tmpDir();
  const file = join(dir, "host-timer.test.ts");
  const src = (name: string): string => pathToFileURL(fileURLToPath(new URL(`../../src/headless/${name}`, import.meta.url))).href;
  writeFileSync(file, `import { test } from "node:test";
import { teaRun } from ${JSON.stringify(src("tea-runtime/runner.ts"))};
import { toTeaModule } from ${JSON.stringify(src("tea-load.ts"))};
test("host", async () => {
  setTimeout(() => { throw new Error("HOST TEST BUG"); }, 0);
  const module = toTeaModule({ canvas: { width: 20, height: 20 }, init: () => ({}), update: (m) => m, draw: () => null });
  await teaRun({ module, sketchPath: "host", outDir: ${JSON.stringify(join(dir, "out"))}, frames: 30, seed: 1, fps: 60, every: 1, events: [], eventsPath: undefined });
  await new Promise((resolve) => setTimeout(resolve, 20));
});
`);
  // Without NODE_TEST_CONTEXT the child reports for itself instead of to this test runner.
  const { NODE_TEST_CONTEXT: _context, ...env } = process.env;
  const child = spawnSync(process.execPath, ["--import", "tsx", "--test", file], { encoding: "utf8", env });
  assert.notEqual(child.status, 0, child.stdout);
  assert.match(child.stdout + child.stderr, /HOST TEST BUG/u);
  assert.match(child.stdout, /ℹ fail 1/u);
});
