// # Smoke history across log renames
//
// The smoke log's file name follows the product name. The 2026-08-30 rename
// started a new file, and `bin/smoke --report` read only that one, so it
// printed the tier's later history as its whole record. Readers now fold the
// retired file in with the current one. Runs append only to the current file.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  formatSmokeReport,
  mergeSmokeLogs,
  parseRunRecord,
  smokeLogPath,
  smokeLogReadPaths,
  summarizeSmokeLog,
} from "../smoke-lib.js";

const run = (ts: string, worktree: string) =>
  JSON.stringify({
    ts,
    commit: "abc",
    branch: `worktree-${worktree}`,
    worktree,
    box: "test1",
    verdict: "green",
    ms: 27_000,
    steps: [{ id: "restart", outcome: "ok", ms: 1_000 }],
  });

// Runs are written to the current name only. They are read from the retired
// name as well, retired name first.
void test("Runs are written to the current name and read from every name.", async (t) => {
  t.check(
    {
      write: smokeLogPath("/repo/.git"),
      read: smokeLogReadPaths("/repo/.git"),
    },
    {
      write: "/repo/.git/beebox-smoke-log.jsonl",
      read: [
        "/repo/.git/callback-smoke-log.jsonl",
        "/repo/.git/beebox-smoke-log.jsonl",
      ],
    },
  );
});

// Two files become one log in time order. A run in both files, as after a
// hand copy from the old file to the new one, counts once. A truncated line
// from a killed run is dropped.
void test("Two files become one log in time order, each run once.", async (t) => {
  const old = [
    run("2026-08-26T10:00:00.000Z", "x"),
    run("2026-08-29T10:00:00.000Z", "x"),
  ].join("\n");
  const current = [
    run("2026-08-26T10:00:00.000Z", "x"),
    run("2026-08-31T10:00:00.000Z", "x"),
    run("2026-08-28T10:00:00.000Z", "y"),
    '{"ts":"2026-09-01T',
    "",
  ].join("\n");
  t.check(
    mergeSmokeLogs([old, current]).map((line) => parseRunRecord(line)?.ts),
    [
      "2026-08-26T10:00:00.000Z",
      "2026-08-28T10:00:00.000Z",
      "2026-08-29T10:00:00.000Z",
      "2026-08-31T10:00:00.000Z",
    ],
  );
});

// Two worktrees that start a run in the same millisecond are two runs.
void test("Two worktrees that start in the same millisecond are two runs.", async (t) => {
  t.check(
    mergeSmokeLogs([
      run("2026-08-26T10:00:00.000Z", "x"),
      run("2026-08-26T10:00:00.000Z", "y"),
    ]).length,
    2,
  );
});

// The report's first line gives the dates its runs cover, so a short history
// reads as short.
void test("The report's first line gives the dates its runs cover.", async (t) => {
  const report = formatSmokeReport(
    summarizeSmokeLog(
      mergeSmokeLogs([
        run("2026-08-26T10:00:00.000Z", "x"),
        run("2026-09-02T18:10:00.000Z", "x"),
      ]),
    ),
  );
  t.check(
    report.split("\n")[0],
    "smoke: 2 runs logged, 2026-08-26 → 2026-09-02, 0 red.",
  );
});
