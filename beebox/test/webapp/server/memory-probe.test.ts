// # Memory probe: samples, threshold profiles, and their caps
//
// `src/webapp/server/memory-probe.ts` samples a serve process's memory to
// `.beebox/memory/` and writes a heap profile the first time the heap passes
// each threshold of its limit. These tests drive `tick()` directly with fixed
// readings, a fixed clock, and a fake profiler; no timer fires.

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMemoryProbe, thresholdsCrossed, type HeapProfiler, type MemoryReading } from "../../../src/webapp/server/memory-probe.js";

const MB = 1024 * 1024;
const LIMIT = 1000 * MB;
const reading = (heapUsedMB: number): MemoryReading => ({
  rss: (heapUsedMB + 100) * MB, heapUsed: heapUsedMB * MB, heapTotal: (heapUsedMB + 10) * MB, heapLimit: LIMIT,
  external: 5 * MB, arrayBuffers: 2 * MB, resources: 12,
});
const fakeProfiler: HeapProfiler = { profile: () => Promise.resolve('{"head":{}}'), stop: () => Promise.resolve() };

async function probeDir(t: Test): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "memory-probe-"));
  t.teardown(() => rm(dir, { recursive: true, force: true }));
  return join(dir, "memory");
}

// ## Each threshold fires once, and only the highest newly passed one writes
void test("Each threshold fires once, and only the highest newly passed one writes", async (t) => {
  t.check(
    {
      healthy: thresholdsCrossed(new Set(), 0.3),
      half: thresholdsCrossed(new Set(), 0.55),
      jumpPastTwo: thresholdsCrossed(new Set([0.5]), 0.9),
      alreadyFired: thresholdsCrossed(new Set([0.5, 0.7, 0.85]), 0.95),
    },
    { healthy: [], half: [0.5], jumpPastTwo: [0.7, 0.85], alreadyFired: [] },
  );
});

// ## A healthy process writes samples and says nothing
//
// The probe's output stays out of the way when healthy: one sample line a
// minute in its own file, nothing on stderr.
void test("A healthy process writes samples and says nothing", async (t) => {
  const dir = await probeDir(t);
  const readings = [reading(300), reading(310), reading(320)];
  let clock = Date.parse("2026-10-25T15:00:00.000Z");
  const warnings: string[] = [];
  const probe = startMemoryProbe({
    dirs: [dir], profiler: fakeProfiler, read: () => readings.shift() ?? reading(0), now: () => clock,
    warn: (message) => warnings.push(message), checkMs: 3_600_000, sampleMs: 60_000,
  });
  t.teardown(() => probe.stop());
  await probe.tick(); // joins the start tick, not a second reading
  clock += 30_000;
  await probe.tick(); // a check with no sample due
  clock += 30_000;
  await probe.tick();
  const lines = (await readFile(join(dir, "samples.jsonl"), "utf8")).trim().split("\n").map((line): unknown => JSON.parse(line));
  t.check({ lines, warnings }, {
    lines: [
      { at: "2026-10-25T15:00:00.000Z", pid: process.pid, rssMB: 400, heapUsedMB: 300, heapTotalMB: 310, heapLimitMB: 1000, externalMB: 5, arrayBuffersMB: 2, resources: 12 },
      { at: "2026-10-25T15:01:00.000Z", pid: process.pid, rssMB: 420, heapUsedMB: 320, heapTotalMB: 330, heapLimitMB: 1000, externalMB: 5, arrayBuffersMB: 2, resources: 12 },
    ],
    warnings: [],
  });
});

// ## Passing a threshold writes a profile and one warning naming it
void test("Passing a threshold writes a profile and one warning naming it", async (t) => {
  const dir = await probeDir(t);
  const readings = [reading(550), reading(900)];
  const warnings: string[] = [];
  const probe = startMemoryProbe({
    dirs: [dir], profiler: fakeProfiler, read: () => readings.shift() ?? reading(0),
    now: () => Date.parse("2026-10-25T15:00:00.000Z"), warn: (message) => warnings.push(message), checkMs: 3_600_000,
  });
  t.teardown(() => probe.stop());
  await probe.tick(); // joins the start tick, which read 550 MB
  await probe.tick(); // 900 MB passes 70% and 85% at once: one profile, at 85%
  const stem = `2026-10-25T15-00-00.000Z-pid${String(process.pid)}`;
  t.check({ files: (await readdir(dir)).toSorted(), warnings }, {
    files: [`${stem}-50.heapprofile`, `${stem}-85.heapprofile`, "samples.jsonl"],
    warnings: [
      `[memory] heap passed 50% of its limit (550 of 1000 MB, rss 650 MB); profile: ${join(dir, `${stem}-50.heapprofile`)}`,
      `[memory] heap passed 85% of its limit (900 of 1000 MB, rss 1000 MB); profile: ${join(dir, `${stem}-85.heapprofile`)}`,
    ],
  });
});

// ## Without a profiler the warning still fires and samples continue
//
// The inspector can be unavailable (another tool holds it). The probe then
// keeps its samples and says that no profile was written.
void test("Without a profiler the warning still fires and samples continue", async (t) => {
  const dir = await probeDir(t);
  const warnings: string[] = [];
  const probe = startMemoryProbe({ dirs: [dir], profiler: null, read: () => reading(720), warn: (message) => warnings.push(message), checkMs: 3_600_000 });
  t.teardown(() => probe.stop());
  await probe.tick();
  t.check({ files: await readdir(dir), warnings }, {
    files: ["samples.jsonl"],
    warnings: ["[memory] heap passed 70% of its limit (720 of 1000 MB, rss 820 MB); no profile written"],
  });
});

// ## Samples rotate, and old profiles are pruned to the newest six
void test("Samples rotate, and old profiles are pruned to the newest six", async (t) => {
  const dir = await probeDir(t);
  const old = Array.from({ length: 7 }, (_, index) => `2026-10-0${String(index + 1)}T00-00-00.000Z-pid1-50.heapprofile`);
  const readings = [reading(100), reading(100), reading(600)];
  let clock = Date.parse("2026-10-25T15:00:00.000Z");
  const probe = startMemoryProbe({
    dirs: [dir], profiler: fakeProfiler, read: () => readings.shift() ?? reading(0), now: () => clock,
    warn: () => {}, checkMs: 3_600_000, sampleMs: 0, samplesMaxBytes: 300,
  });
  t.teardown(() => probe.stop());
  await probe.tick(); // joins the start tick
  for (const name of old) await writeFile(join(dir, name), "{}");
  clock += 1;
  await probe.tick(); // a second line would pass 300 bytes: the first rotates out
  clock += 1;
  await probe.tick();
  t.check((await readdir(dir)).toSorted(), [
    "2026-10-03T00-00-00.000Z-pid1-50.heapprofile",
    "2026-10-04T00-00-00.000Z-pid1-50.heapprofile",
    "2026-10-05T00-00-00.000Z-pid1-50.heapprofile",
    "2026-10-06T00-00-00.000Z-pid1-50.heapprofile",
    "2026-10-07T00-00-00.000Z-pid1-50.heapprofile",
    `2026-10-25T15-00-00.002Z-pid${String(process.pid)}-50.heapprofile`,
    "samples.1.jsonl",
    "samples.jsonl",
  ]);
});
