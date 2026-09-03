/**
 * Whether this run's verdicts can be believed at all.
 *
 * The 2026-08-30..09-01 false reds (issues/bugs/2026-08-31-full-suite-red-*)
 * were contention: the batch AND the isolated re-run happened on the same
 * thrashed host, so "failed twice" was one observation of the environment, not
 * two observations of the code. A slowed run therefore yields no verdicts —
 * its failures wait in a pending set until a run whose own durations look
 * healthy confirms or clears them. The slowdown is measured against the
 * ledger's per-file duration history, which this schedule already writes.
 *
 * Also here: the repeat-suppression arithmetic for alerts, because the same
 * load events saturated the alert store (42 open alerts, the identical
 * baseline-red raised eight hourly runs in a row).
 */

import type { LedgerRecord } from "../../bin/test-ledger-lib.js";
import { LEDGER_SOURCE } from "./lib.js";

/**
 * A run whose batch slowdown factor is at least this yields NO verdicts: its
 * failures are deferred to a later run on a healthy host rather than triaged.
 *
 * The evidence for the number: during the load event,
 * `test/core/box/file-watcher.doctest.md` ran at 16–195× its healthy median
 * (28s–332s against 1.7s) while failing its 5s `fs.watch` delivery budget, and
 * `test/frontend/trpc-directory-resolution.test.ts` ran at 13× while blowing
 * its own 15s per-child timeout. Healthy runs cluster well under 2×; 3 keeps a
 * merely busy machine trusted and a thrashed one out of the verdict business.
 */
export const SLOWDOWN_UNTRUSTED = 3;

/** Files with usable history required before the factor is a judgment at all. */
export const SLOWDOWN_MIN_SAMPLES = 8;

/**
 * A file whose healthy median is under this says nothing about contention —
 * a 40ms test that takes 120ms is scheduler noise, not a thrashed host.
 */
export const SLOWDOWN_FLOOR_MS = 1000;

/** Recent full-suite runs of a file its duration median is taken over. */
export const SLOWDOWN_WINDOW = 20;

/**
 * Per-file durations of this schedule's own recent tier runs, newest last.
 * Marker records carry no durations and other sources run different
 * concurrency, so only this schedule's tier records are comparable.
 *
 * Self-consistent: each run (consecutive tier records at one commit, so the
 * careful tier's five files are judged with the ordinary tier beside them) is
 * judged against the history built so far, and a run the gate would distrust
 * contributes nothing. Without this, a multi-day load event trains the
 * baseline until 40s file-watcher runs read as normal and the gate goes blind
 * — the ledger keeps recording durations for deferred runs.
 */
export function durationHistories(input: {
  records: LedgerRecord[];
  window?: number;
}): Map<string, number[]> {
  const window = input.window ?? SLOWDOWN_WINDOW;
  const histories = new Map<string, number[]>();
  const fold = (group: LedgerRecord[]): void => {
    if (group.length === 0) return;
    const current: Record<string, number> = {};
    for (const record of group) {
      for (const [file, ms] of Object.entries(record.durations)) {
        current[file] = Math.max(current[file] ?? 0, ms);
      }
    }
    if (runIsUntrusted(batchSlowdown({ current, histories }))) return;
    for (const [file, ms] of Object.entries(current)) {
      const history = histories.get(file) ?? [];
      history.push(ms);
      if (history.length > window) history.shift();
      histories.set(file, history);
    }
  };
  let group: LedgerRecord[] = [];
  for (const record of input.records) {
    if (record.source !== LEDGER_SOURCE || record.marker === true) continue;
    if (group[0] !== undefined && group[0].commit !== record.commit) {
      fold(group);
      group = [];
    }
    group.push(record);
  }
  fold(group);
  return histories;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const lower = sorted[mid - 1];
  const upper = sorted[mid];
  if (upper === undefined) return null;
  return sorted.length % 2 === 0 && lower !== undefined ? (lower + upper) / 2 : upper;
}

/**
 * How much slower this run was than the ledger says it usually is: the median,
 * over files with enough history and a non-trivial healthy duration, of
 * this-run-duration / healthy-median. The median of ratios rather than a ratio
 * of totals, so one legitimately slow new test cannot move the answer.
 *
 * `factor: null` means the ledger cannot judge this run (too few comparable
 * files — the schedule's first runs). An unjudgeable run is treated as
 * trusted: with no history there is nothing better to defer to.
 */
export function batchSlowdown(input: {
  current: Record<string, number>;
  histories: Map<string, number[]>;
  minSamples?: number;
  floorMs?: number;
}): { factor: number | null; samples: number } {
  const minSamples = input.minSamples ?? SLOWDOWN_MIN_SAMPLES;
  const floorMs = input.floorMs ?? SLOWDOWN_FLOOR_MS;
  const ratios: number[] = [];
  for (const [file, ms] of Object.entries(input.current)) {
    if (ms <= 0) continue;
    const history = input.histories.get(file) ?? [];
    if (history.length < 3) continue;
    const healthy = median(history);
    if (healthy === null || healthy < floorMs) continue;
    ratios.push(ms / healthy);
  }
  if (ratios.length < minSamples) return { factor: null, samples: ratios.length };
  const factor = median(ratios);
  return { factor, samples: ratios.length };
}

/** True when the factor is known and at/above the bar: verdicts are withheld. */
export function runIsUntrusted(slowdown: { factor: number | null }): boolean {
  return slowdown.factor !== null && slowdown.factor >= SLOWDOWN_UNTRUSTED;
}

// ─── repeating alerts ─────────────────────────────────────────────────────

/**
 * The same condition re-raised inside this window is suppressed. One alert a
 * day per unchanged condition is the record; the run log has the rest.
 */
export const ALERT_REPEAT_MS = 24 * 60 * 60 * 1000;

/** What makes two alerts "the same condition": the kind and the file set. */
export function alertFingerprint(input: { kind: string; files: readonly string[] }): string {
  return `${input.kind}:${[...input.files].toSorted().join(",")}`;
}

export function shouldSuppressAlert(input: {
  previous: { fingerprint: string; raisedAt: string } | null;
  fingerprint: string;
  now: Date;
  repeatMs?: number;
}): boolean {
  if (input.previous === null || input.previous.fingerprint !== input.fingerprint) return false;
  const elapsed = input.now.getTime() - Date.parse(input.previous.raisedAt);
  return elapsed >= 0 && elapsed < (input.repeatMs ?? ALERT_REPEAT_MS);
}

/** The alert body for a run too slowed to yield verdicts. */
export function renderDeferredAlert(input: {
  testedCommit: string;
  factor: number;
  samples: number;
  failures: string[];
  pendingSince: string | null;
}): string {
  return [
    `The batched full-suite run at \`${input.testedCommit.slice(0, 8)}\` ran at ` +
      `${input.factor.toFixed(1)}× its usual per-file durations (median over ` +
      `${String(input.samples)} files), so its ${String(input.failures.length)} failure(s) got no verdict.`,
    "A failure observed on a thrashed host says nothing about the code; these files are",
    "pending until a run at normal speed confirms or clears them.",
    "",
    `Pending: ${input.failures.join(", ")}`,
    ...(input.pendingSince === null ? [] : ["", `Oldest pending entry: ${input.pendingSince}.`]),
    "",
  ].join("\n");
}
