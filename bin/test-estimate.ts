/**
 * How long a selected run will take, from the ledger's per-file history.
 *
 * A change to a widely imported module selects about half the suite, and
 * that run outlasts an agent shell's 10-minute foreground limit. Once a
 * foreground run has started, nothing it prints arrives in time, so the
 * estimate is printed first: an agent that runs `test:changed` in the
 * background reads it at once, and the list form gives it in a second.
 *
 * The estimate is the sum of per-file median times divided by the jobs
 * count, and never less than the slowest file. Replayed over 148 selected
 * runs, actual time was 1.06x the estimate at the median and 1.73x at p90. See
 * beebox/docs/plans/change-based-test-selection.md, "Revision 2026-10-12 —
 * broad selections".
 */

import { isMeasuredRun, type LedgerRecord } from "./test-ledger-lib.js";

/** Only recent history: the suite and the machine change. */
const HISTORY_DAYS = 30;

/**
 * At this estimate the run may pass a 10-minute limit under load. The
 * sessions that motivated this ran at up to 1.82x typical per-file time, and
 * 600 s / 1.82 is about 330 s.
 */
export const LONG_RUN_SECONDS = 300;

function median(sorted: number[]): number | undefined {
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Seconds of wall time for `files` (package-relative, the ledger's own
 * `durations` keys) at `jobs` parallel files. Null when fewer than half the
 * files have recent history: a fallback standing in for most of the run would
 * be a number that only looks like a measurement.
 */
export function estimateSeconds(input: {
  files: string[];
  records: LedgerRecord[];
  jobs: number;
  now: Date;
}): number | null {
  const since = new Date(input.now.getTime() - HISTORY_DAYS * 86_400_000).toISOString();
  const times = new Map<string, number[]>();
  for (const record of input.records) {
    if (record.ts < since || !isMeasuredRun(record)) continue;
    // `readRecords` checks only the fields the report needs.
    if (typeof record.durations !== "object" || record.durations === null) continue;
    for (const [file, ms] of Object.entries(record.durations)) {
      // tap omits `time=` on some lines, and the ledger records that as 0.
      if (!(ms > 0)) continue;
      const list = times.get(file) ?? [];
      list.push(ms);
      times.set(file, list);
    }
  }
  const medians = new Map<string, number>();
  for (const [file, list] of times) {
    const m = median(list.toSorted((a, b) => a - b));
    if (m !== undefined) medians.set(file, m);
  }
  // A file with no history (a new test) costs what a typical file costs.
  const known = input.files.filter((file) => medians.has(file)).length;
  const fallback = median([...medians.values()].toSorted((a, b) => a - b));
  if (fallback === undefined || known * 2 < input.files.length) return null;
  const perFile = input.files.map((file) => medians.get(file) ?? fallback);
  const spread = perFile.reduce((sum, ms) => sum + ms, 0) / Math.max(1, input.jobs);
  // No run is shorter than its slowest file, however many jobs share the rest.
  return Math.max(spread, ...perFile) / 1000;
}

/** What `test-select` prints before it lists or runs a non-empty selection. */
export function estimateLines(input: {
  count: number;
  seconds: number | null;
  jobs: number;
}): string[] {
  const files = `${String(input.count)} ${input.count === 1 ? "file" : "files"}`;
  if (input.seconds === null) return [`test-select: ${files}`];
  const minutes = Math.round(input.seconds / 60);
  const time = minutes < 1 ? "under 1 min" : `about ${String(minutes)} min`;
  const lines = [`test-select: ${files}, ${time} at ${String(input.jobs)} jobs`];
  if (input.seconds >= LONG_RUN_SECONDS) {
    lines.push(
      "test-select: likely to pass a 10-minute foreground limit under load; run it in the background",
    );
  }
  return lines;
}
