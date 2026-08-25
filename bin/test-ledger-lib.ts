/**
 * A record of every test run, so that "which tests have ever failed in a way
 * that mattered" becomes answerable. Nothing branches on it — it is an
 * instrument, not a gate.
 *
 * Pure logic only — parsing, classification, aggregation. The I/O shell (git,
 * esbuild, spawning the run) is bin/test-ledger.ts, so everything here is
 * testable without any of that.
 *
 * The ledger lives INSIDE `.git/` (via `git rev-parse --git-common-dir`): never
 * committed, in no diff, and the one directory every worktree on this machine
 * shares. Green runs are recorded too — they are the denominator that turns
 * failure counts into failure rates, and a denominator is free to collect now
 * and impossible to reconstruct later.
 *
 * See callback-box/docs/plans/change-based-test-selection.md, Track 5.
 */

import { createHash } from "node:crypto";
import { join } from "node:path";

/** How a failing file relates to what the graph pointed at. */
export type FailureClass = "attached" | "unimplicated" | "unknown";

export interface LedgerRecord {
  ts: string;
  commit: string;
  branch: string;
  /** Identifies the exact working state: HEAD tree plus uncommitted changes. */
  treeHash: string;
  mode: "full" | "selected";
  /**
   * The wrapped command's exit status (128+signum if it was killed). Recorded
   * because a run that bailed out early reports only the files it reached, and
   * counting that as a completed run would quietly corrupt every denominator.
   *
   * Optional only for records written before this field existed; every record
   * written now has it. See {@link isCompletedRun}.
   */
  exitCode?: number;
  /**
   * Which semaphore tier the run took (bin/test-locks.ts). Absent on records
   * written before the semaphore existed.
   */
  tier?: "ordinary" | "careful";
  /**
   * Other runs holding a slot when this one started — the concurrency figure
   * the plan's table had to estimate. Absent on pre-semaphore records.
   */
  concurrency?: number;
  /** Whether the graph accounted for every changed path; null if uncomputable. */
  accounted: boolean | null;
  changed: string[];
  /** Fileset hashes into the sidecar manifest. */
  ranFiles: string;
  implicated: string;
  durations: Record<string, number>;
  failures: Array<{ file: string; class: FailureClass }>;
}

export interface TapFileResult {
  file: string;
  ok: boolean;
  ms: number;
}

// ── pure parsing and classification ─────────────────────────────────────────

/**
 * Per-file results from raw TAP.
 *
 * tap emits one line per test file: `ok 3 - test/foo.doctest.md # time=1234ms`.
 * Only top-level (unindented) lines are file results; indented ones are
 * subtests within a file and would double-count.
 */
export function parseTapFiles(raw: string): TapFileResult[] {
  const results: TapFileResult[] = [];
  for (const line of raw.split("\n")) {
    const match = /^(ok|not ok) \d+ - (\S+)(?: # time=([\d.]+)ms)?/.exec(line);
    if (match === null) continue;
    const [, status, file, time] = match;
    if (file === undefined || !file.startsWith("test/")) continue;
    results.push({
      file,
      ok: status === "ok",
      ms: time === undefined ? 0 : Math.round(Number(time)),
    });
  }
  return results;
}

/**
 * Entries — status plus path — out of `git status --porcelain -z` output.
 *
 * `-z` is required, not a nicety. Without it git *quotes* any path containing
 * a space, quote, backslash, or non-ASCII byte (`"src/a b.ts"`), and encodes a
 * rename as `R  old -> new` on one line — so a path legitimately containing
 * ` -> ` is unparseable. With `-z` every entry is NUL-terminated and never
 * quoted, and a rename emits the destination followed by the origin as a
 * separate entry.
 *
 * The leading two status characters are significant and one is routinely a
 * space (` M path`, an unstaged modification — the commonest case). Trimming
 * before slicing eats it and shifts the path by one character.
 */
export function parsePorcelainEntries(raw: string): Array<{ status: string; path: string }> {
  const entries = raw.split("\u0000").filter((entry) => entry !== "");
  const parsed: Array<{ status: string; path: string }> = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry === undefined || entry.length < 4) continue;
    const status = entry.slice(0, 2);
    parsed.push({ status, path: entry.slice(3) });
    // A rename or copy emits the ORIGIN path as the following entry. Consume
    // it: the destination is the path that exists now, and treating the origin
    // as another status line would slice three characters off a bare path.
    if (status.startsWith("R") || status.startsWith("C")) i++;
  }
  return parsed;
}

/** The paths alone, for callers that do not care how each one changed. */
export function parsePorcelainPaths(raw: string): string[] {
  return parsePorcelainEntries(raw).map((entry) => entry.path);
}

/**
 * Classify a failing file against what the graph pointed at.
 *
 * Two classes, not three. An earlier draft of the plan had `missed` ("not in
 * the selection") alongside `covered-only-by-policy` ("not implicated but
 * selected anyway"), which overlap: on a full run every unimplicated failure
 * satisfies both. The honest primitive is whether the GRAPH pointed at it;
 * what any given policy would have done with that is a question `report`
 * answers, because policies change and recorded facts should not.
 */
export function classifyFailure(input: { file: string; implicated: Set<string> | null }): FailureClass {
  if (input.implicated === null) return "unknown";
  return input.implicated.has(input.file) ? "attached" : "unimplicated";
}

/**
 * Files that failed and then passed again at the identical commit AND working
 * tree — flaky by definition, since nothing changed between the two runs.
 *
 * Derived here rather than adjudicated by an agent. Delegating it to
 * `/finish`'s tracked-flake protocol would record "flakes a subagent was
 * willing to pass", not flake rate, and would miss every flake that surfaces
 * during ordinary iteration.
 *
 * Returns file -> number of fail-then-pass transitions observed.
 */
export function deriveFlakes(input: {
  records: LedgerRecord[];
  filesets: Record<string, string[]>;
}): Map<string, number> {
  const { records, filesets } = input;
  const flakes = new Map<string, number>();
  const failedAt = new Map<string, Set<string>>(); // "commit\0tree" -> files failing

  for (const record of records) {
    const key = `${record.commit}\u0000${record.treeHash}`;
    const ran = new Set(filesets[record.ranFiles] ?? []);
    const failing = new Set(record.failures.map((f) => f.file));
    const previouslyFailed = failedAt.get(key) ?? new Set<string>();

    for (const file of previouslyFailed) {
      if (ran.has(file) && !failing.has(file)) {
        flakes.set(file, (flakes.get(file) ?? 0) + 1);
        previouslyFailed.delete(file);
      }
    }
    for (const file of failing) previouslyFailed.add(file);
    failedAt.set(key, previouslyFailed);
  }
  return flakes;
}

/**
 * Whether a run finished, so its file set is a legitimate denominator.
 *
 * A run that died partway through (a signal, a bailout, a crashed harness)
 * reports only the files it reached; counting it inflates every denominator
 * with a run that never had the chance to fail. Exit 1 is an ordinary
 * completed-with-failures run and counts.
 *
 * A record written before `exitCode` existed has none. It is treated as
 * completed rather than discarded — silently voiding every pre-existing record
 * on a schema addition is a worse failure than admitting a handful of runs
 * whose status is merely unknown. `report` states how many it excluded either
 * way, so the choice is visible rather than assumed.
 */
export function isCompletedRun(record: LedgerRecord): boolean {
  const exitCode = record.exitCode ?? 0;
  return exitCode === 0 || exitCode === 1;
}

export interface FileStats {
  runs: number;
  failures: number;
  unimplicatedFailures: number;
  flakes: number;
  medianMs: number;
}

export function summarize(input: {
  records: LedgerRecord[];
  filesets: Record<string, string[]>;
}): Map<string, FileStats> {
  const { filesets } = input;
  const records = input.records.filter(isCompletedRun);
  const flakes = deriveFlakes({ records, filesets });
  const runs = new Map<string, number>();
  const failures = new Map<string, number>();
  const unimplicated = new Map<string, number>();
  const times = new Map<string, number[]>();

  for (const record of records) {
    for (const file of filesets[record.ranFiles] ?? []) {
      runs.set(file, (runs.get(file) ?? 0) + 1);
    }
    for (const [file, ms] of Object.entries(record.durations)) {
      const list = times.get(file) ?? [];
      list.push(ms);
      times.set(file, list);
    }
    for (const failure of record.failures) {
      failures.set(failure.file, (failures.get(failure.file) ?? 0) + 1);
      if (failure.class === "unimplicated") {
        unimplicated.set(failure.file, (unimplicated.get(failure.file) ?? 0) + 1);
      }
    }
  }

  const stats = new Map<string, FileStats>();
  for (const [file, count] of runs) {
    const list = (times.get(file) ?? []).sort((a, b) => a - b);
    stats.set(file, {
      runs: count,
      failures: failures.get(file) ?? 0,
      unimplicatedFailures: unimplicated.get(file) ?? 0,
      flakes: flakes.get(file) ?? 0,
      medianMs: list[Math.floor(list.length / 2)] ?? 0,
    });
  }
  return stats;
}

export const ledgerPaths = (gitCommonDir: string): { ledger: string; filesets: string } => ({
  ledger: join(gitCommonDir, "callback-test-ledger.jsonl"),
  // Append-only, like the ledger itself. A single JSON object rewritten per
  // run would be a read-modify-write on a file every worktree on this machine
  // shares, and concurrent suite runs across worktrees are routine here — one
  // would silently drop the other's entries. Appending removes the race rather
  // than guarding it with a lock.
  filesets: join(gitCommonDir, "callback-test-filesets.jsonl"),
});

/** Fold an append-only fileset log into the hash -> files map readers want. */
export function foldFilesets(lines: string[]): Record<string, string[]> {
  const filesets: Record<string, string[]> = {};
  for (const line of lines) {
    if (line.trim() === "") continue;
    const parsed: unknown = JSON.parse(line);
    if (!isFilesetEntry(parsed)) continue;
    filesets[parsed.hash] = parsed.files;
  }
  return filesets;
}

function isFilesetEntry(value: unknown): value is { hash: string; files: string[] } {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as { hash?: unknown; files?: unknown };
  return (
    typeof entry.hash === "string" &&
    Array.isArray(entry.files) &&
    entry.files.every((f) => typeof f === "string")
  );
}

export function hashFileset(files: string[]): string {
  const sorted = [...files].sort();
  return `sha256:${createHash("sha256").update(sorted.join("\n")).digest("hex").slice(0, 16)}`;
}
