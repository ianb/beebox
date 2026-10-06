/**
 * Memory pressure, read the same way for the ad-hoc test wrapper
 * (bin/test-ledger.ts) and the scheduled full-suite run
 * (schedules/full-suite/run.ts): a load average measures runnable processes,
 * not a swapping host, and the 2026-09-11 full-suite incident was the latter
 * — load looked quiet at times while 18GB of swap was in use. macOS levels:
 * 1 normal, 2 warn, 4 critical.
 *
 * Parsing is separate from the `sysctl`/`vm_stat` calls so it is testable
 * without a Darwin host.
 */

import { execFileSync } from "node:child_process";
import { availableParallelism, loadavg } from "node:os";

export const MEMORY_PRESSURE_WARN = 2;
export const MEMORY_PRESSURE_CRITICAL = 4;

/**
 * Pages paged out per second, between two polls, at or above which the host is
 * thrashing. The 2026-09-25 log shows 31,361 pageouts between the gate's
 * "host quiet" line and the run's "tier start" line, which are a checkout and
 * a `pnpm install` apart (the log has no timestamps; assuming a few minutes):
 * on the order of 100+ pages/s during a window the gate should have refused. A quiet host pages out near
 * zero between polls, so 100/s separates the two with room on both sides.
 * The lifetime counter (10M by then) says nothing about now.
 */
export const PAGEOUT_RATE_THRASH = 100;

/** Gap between the two pageout samples that make a rate. */
export const PAGEOUT_SAMPLE_MS = 5000;

/** The host signals the quiet gate reads; a null or absent signal never blocks. */
export interface HostSignals {
  load1: number;
  bar: number;
  /** macOS memory-pressure level: 1 normal, 2 warn, 4 critical. */
  level: number | null;
  /** Pageouts per second between two polls. */
  pageoutRate?: number | null;
}

/**
 * Why the host is not quiet enough to start the suite; empty means quiet.
 *
 * Load alone does not see a swapping host (2026-09-11: load1 8 at pressure
 * level 2 on a calm afternoon), and the 2026-09-25 run started at level 2
 * while paging hard, so each memory signal gates independently of load:
 * pressure at warn or above, or a pageout rate at {@link PAGEOUT_RATE_THRASH}.
 * A signal that is null (no `sysctl`/`vm_stat`, e.g. non-Darwin) is "nothing
 * better to go on", not an objection.
 *
 * Free swap is deliberately not a signal: macOS adds 1 GB swap files as it
 * needs them, so `vm.swapusage`'s free figure sits near 1 GB however loaded the
 * host is (2026-10-06: total grew 7 GB to 10 GB in a few hours with 1.0-1.3 GB
 * free throughout). A 2 GB floor refused nearly every run.
 */
export function hostBlockers(input: HostSignals): string[] {
  const blockers: string[] = [];
  if (input.load1 > input.bar) blockers.push(`load1 ${input.load1.toFixed(1)} > ${String(input.bar)}`);
  if (input.level !== null && input.level >= MEMORY_PRESSURE_WARN) {
    blockers.push(`memory pressure level ${String(input.level)}`);
  }
  const rate = input.pageoutRate ?? null;
  if (rate !== null && rate >= PAGEOUT_RATE_THRASH) {
    blockers.push(`pageouts ${rate.toFixed(0)}/s >= ${String(PAGEOUT_RATE_THRASH)}/s`);
  }
  return blockers;
}

export function isHostQuiet(input: HostSignals): boolean {
  return hostBlockers(input).length === 0;
}

export interface MemoryPressure {
  level: number | null;
  pageouts: number | null;
}

export interface PageoutSample {
  pageouts: number | null;
  atMs: number;
}

/**
 * Pageouts per second between two samples; null when either is missing, the
 * clock did not advance, or the counter went backwards (a reboot between
 * samples).
 */
export function pageoutRate(first: PageoutSample, second: PageoutSample): number | null {
  if (first.pageouts === null || second.pageouts === null) return null;
  const seconds = (second.atMs - first.atMs) / 1000;
  if (seconds <= 0 || second.pageouts < first.pageouts) return null;
  return (second.pageouts - first.pageouts) / seconds;
}

/** Pageouts per second over a short window; null when `vm_stat` is unavailable. */
export async function readPageoutRate(windowMs?: number): Promise<number | null> {
  const first = { pageouts: tryRead(["vm_stat"], parsePageouts), atMs: Date.now() };
  await new Promise((resolve) => setTimeout(resolve, windowMs ?? PAGEOUT_SAMPLE_MS));
  return pageoutRate(first, { pageouts: tryRead(["vm_stat"], parsePageouts), atMs: Date.now() });
}

/** `sysctl -n kern.memorystatus_vm_pressure_level` prints a bare integer. */
export function parsePressureLevel(raw: string): number | null {
  const value = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(value) ? value : null;
}

/** `vm_stat`'s `Pageouts:` line, e.g. `Pageouts:                123456.`. */
export function parsePageouts(raw: string): number | null {
  const match = /^Pageouts:\s*(\d+)\.?\s*$/mu.exec(raw);
  if (match?.[1] === undefined) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

/**
 * Absent command, non-Darwin, or unparsable output all read as "no signal"
 * rather than throwing: this feeds a wait loop and a refusal decision, never
 * something that should itself take a run down.
 */
export function readMemoryPressure(): MemoryPressure {
  return {
    level: tryRead(["sysctl", "-n", "kern.memorystatus_vm_pressure_level"], parsePressureLevel),
    pageouts: tryRead(["vm_stat"], parsePageouts),
  };
}

export type PressureDecision = "refuse" | "warn" | "proceed";

/**
 * What `bin/test-ledger.ts` does before spawning tap: a full run under
 * critical pressure is refused outright (tap would kill it at 300s and teach
 * nothing), a full or selected run under warn just says so, and selected
 * never refuses — the cost of a wrong refusal there is a whole iteration
 * loop, against a few files' timeouts if it runs anyway.
 *
 * `ignoreLoad` bypasses only the refusal, not the warning: a caller that
 * already gated on load itself (the full-suite schedule's own
 * `waitForQuietHost`) sets it so a pressure spike between that check and
 * spawning tap can't produce a silent refusal with no TAP output — but it
 * still wants the warning surfaced if pressure is still up when tap runs.
 */
export function pressureDecision(input: { mode: "full" | "selected"; level: number | null; ignoreLoad: boolean }): PressureDecision {
  if (input.level === null) return "proceed";
  if (!input.ignoreLoad && input.mode === "full" && input.level >= MEMORY_PRESSURE_CRITICAL) return "refuse";
  if (input.level >= MEMORY_PRESSURE_WARN) return "warn";
  return "proceed";
}

function tryRead(command: [string, ...string[]], parse: (raw: string) => number | null): number | null {
  try {
    const [executable, ...args] = command;
    return parse(execFileSync(executable, args, { encoding: "utf8" }));
  } catch (_e) {
    return null;
  }
}

/**
 * The quiet-host blockers for a whole-suite run, read now: load against one
 * per core, memory pressure, and a pageout rate (one
 * {@link PAGEOUT_SAMPLE_MS} sample window).
 */
export async function currentHostBlockers(): Promise<string[]> {
  const { level } = readMemoryPressure();
  return hostBlockers({ load1: loadavg()[0] ?? 0, bar: availableParallelism(), level, pageoutRate: await readPageoutRate() });
}
