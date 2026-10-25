/**
 * Always-on memory probe for a `bbx engine serve` process, so the next heap
 * leak can be diagnosed from what it leaves behind rather than a native stack.
 *
 * Every minute it appends one sample (RSS, heap, external memory, live handles)
 * to `.beebox/memory/samples.jsonl` in each served box. Every ten seconds it
 * compares the used heap with V8's heap limit; the first time the heap passes
 * 50%, 70%, or 85% of the limit it writes the V8 sampling heap profile beside
 * the samples and logs one warning. A profile names the allocation stacks of
 * the live JavaScript heap, which is what ties growth to a subsystem; Chrome
 * DevTools opens `.heapprofile` files (Memory tab, Load). Growth in RSS or
 * `external` outside the JS heap shows in the samples, but the probe names no
 * cause for it, and subprocesses are not measured.
 *
 * The sampler runs the whole process lifetime at a 512 KiB interval, the
 * interval production heap profilers use. When healthy the probe writes only
 * its own files, both capped: the samples rotate at 1 MiB, and at most six
 * profiles and 64 MiB of them are kept.
 */

import * as fs from "node:fs/promises";
import { Session } from "node:inspector/promises";
import * as path from "node:path";
import * as v8 from "node:v8";
import { errnoCode } from "../../shared/error-guards.js";

/** Fractions of the heap limit that write a profile, each once per process. */
export const HEAP_THRESHOLDS = [0.5, 0.7, 0.85] as const;

const CHECK_MS = 10_000;
const SAMPLE_MS = 60_000;
const SAMPLES_MAX_BYTES = 1024 * 1024;
const PROFILES_KEPT = 6;
const PROFILES_MAX_BYTES = 64 * 1024 * 1024;
const SAMPLING_INTERVAL_BYTES = 512 * 1024;
const MB = 1024 * 1024;

/** One reading of the process's memory, in bytes (`resources` is a count). */
export interface MemoryReading {
  rss: number;
  heapUsed: number;
  heapTotal: number;
  heapLimit: number;
  external: number;
  arrayBuffers: number;
  /** Live handles and requests (`process.getActiveResourcesInfo()`): a leaked timer or socket shows here. */
  resources: number;
}

export function readMemory(): MemoryReading {
  const usage = process.memoryUsage();
  return {
    rss: usage.rss,
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    heapLimit: v8.getHeapStatistics().heap_size_limit,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
    resources: process.getActiveResourcesInfo().length,
  };
}

/** The thresholds `ratio` (used heap / heap limit) has passed that have not fired yet, lowest first. */
export function thresholdsCrossed(fired: ReadonlySet<number>, ratio: number): number[] {
  return HEAP_THRESHOLDS.filter((threshold) => ratio >= threshold && !fired.has(threshold));
}

/** The running sampling heap profiler; `profile()` returns the profile as `.heapprofile` JSON. */
export interface HeapProfiler {
  profile(): Promise<string>;
  stop(): Promise<void>;
}

/** Start V8's sampling heap profiler in this process, or null when the inspector is unavailable. */
export async function startHeapProfiler(): Promise<HeapProfiler | null> {
  const session = new Session();
  try {
    session.connect();
    await session.post("HeapProfiler.startSampling", { samplingInterval: SAMPLING_INTERVAL_BYTES });
  } catch (error) {
    console.warn("[memory] heap profiler unavailable; samples continue without profiles:", error);
    session.disconnect();
    return null;
  }
  return {
    async profile() {
      const { profile } = await session.post("HeapProfiler.getSamplingProfile");
      return JSON.stringify(profile);
    },
    async stop() {
      await session.post("HeapProfiler.stopSampling").catch(() => {});
      session.disconnect();
    },
  };
}

export interface MemoryProbeOptions {
  /** One `.beebox/memory/` directory per served box. */
  dirs: string[];
  /** Null runs without profiles. Tests pass a fake. */
  profiler: HeapProfiler | null;
  read?: () => MemoryReading;
  now?: () => number;
  warn?: (message: string) => void;
  checkMs?: number;
  sampleMs?: number;
  samplesMaxBytes?: number;
}

export interface MemoryProbe {
  /** One check, and a sample when one is due; joins a check already running. The interval calls it; tests call it directly. */
  tick(): Promise<void>;
  stop(): Promise<void>;
}

const toMB = (bytes: number): number => Math.round(bytes / MB);

export function startMemoryProbe(options: MemoryProbeOptions): MemoryProbe {
  const { dirs, profiler } = options;
  const read = options.read ?? readMemory;
  const now = options.now ?? Date.now;
  const warn = options.warn ?? ((message: string) => { console.warn(message); });
  const sampleMs = options.sampleMs ?? SAMPLE_MS;
  const samplesMaxBytes = options.samplesMaxBytes ?? SAMPLES_MAX_BYTES;
  const fired = new Set<number>();
  let lastSampleAt = -Infinity;
  let inFlight: Promise<void> | null = null;
  let writeFailed = false;

  const reportFailure = (error: unknown): void => {
    if (writeFailed) return;
    writeFailed = true;
    warn(`[memory] probe failed; later failures are not logged: ${String(error)}`);
  };

  const writeProfile = async (pct: number, at: number): Promise<string | undefined> => {
    if (!profiler) return undefined;
    const body = await profiler.profile();
    const name = `${new Date(at).toISOString().replaceAll(":", "-")}-pid${String(process.pid)}-${String(pct)}.heapprofile`;
    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, name), body);
      await pruneProfiles(dir);
    }
    return dirs[0] === undefined ? undefined : path.join(dirs[0], name);
  };

  const check = async (): Promise<void> => {
    const reading = read();
    const at = now();
    const crossed = thresholdsCrossed(fired, reading.heapUsed / reading.heapLimit);
    for (const threshold of crossed) fired.add(threshold);
    const highest = crossed.at(-1);
    if (highest !== undefined) {
      const pct = Math.round(highest * 100);
      let file: string | undefined;
      try { file = await writeProfile(pct, at); } catch (error) { reportFailure(error); }
      warn(
        `[memory] heap passed ${String(pct)}% of its limit (${String(toMB(reading.heapUsed))} of ${String(toMB(reading.heapLimit))} MB, ` +
          `rss ${String(toMB(reading.rss))} MB); ${file === undefined ? "no profile written" : `profile: ${file}`}`,
      );
    }
    if (at - lastSampleAt >= sampleMs) {
      lastSampleAt = at;
      const line = `${JSON.stringify(sampleOf(reading, at))}\n`;
      for (const dir of dirs) await appendSample({ dir, line, maxBytes: samplesMaxBytes }).catch(reportFailure);
    }
  };
  // A check still writing when the next is due is joined, never doubled.
  const tick = (): Promise<void> => (inFlight ??= check().catch(reportFailure).finally(() => { inFlight = null; }));

  void tick();
  const timer = setInterval(() => { void tick(); }, options.checkMs ?? CHECK_MS);
  timer.unref();
  return {
    tick,
    async stop() {
      clearInterval(timer);
      await profiler?.stop();
    },
  };
}

function sampleOf(reading: MemoryReading, at: number): Record<string, number | string> {
  return {
    at: new Date(at).toISOString(),
    pid: process.pid,
    rssMB: toMB(reading.rss),
    heapUsedMB: toMB(reading.heapUsed),
    heapTotalMB: toMB(reading.heapTotal),
    heapLimitMB: toMB(reading.heapLimit),
    externalMB: toMB(reading.external),
    arrayBuffersMB: toMB(reading.arrayBuffers),
    resources: reading.resources,
  };
}

async function appendSample({ dir, line, maxBytes }: { dir: string; line: string; maxBytes: number }): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "samples.jsonl");
  const size = await fs.stat(file).then((info) => info.size, (error: unknown) => {
    if (errnoCode(error) === "ENOENT") return 0;
    throw error;
  });
  if (size > 0 && size + Buffer.byteLength(line) > maxBytes) await fs.rename(file, path.join(dir, "samples.1.jsonl"));
  await fs.appendFile(file, line);
}

/** Keep the newest profiles, by name (an ISO time prefix), within the count and byte caps; the newest always stays. */
async function pruneProfiles(dir: string): Promise<void> {
  const names = (await fs.readdir(dir)).filter((name) => name.endsWith(".heapprofile")).toSorted().toReversed();
  let total = 0;
  for (const [index, name] of names.entries()) {
    const file = path.join(dir, name);
    total += (await fs.stat(file)).size;
    if (index > 0 && (index >= PROFILES_KEPT || total > PROFILES_MAX_BYTES)) await fs.rm(file, { force: true });
  }
}

/** The probe a serve process runs: one `.beebox/memory/` per served box, with the sampling profiler. */
export async function startServeMemoryProbe(boxRoots: string[]): Promise<MemoryProbe> {
  return startMemoryProbe({ dirs: boxRoots.map((root) => path.join(root, ".beebox", "memory")), profiler: await startHeapProfiler() });
}
