// Tests for the selected run's time estimate. A `.test.ts` for the same reason
// as bin/test-select.test.ts: it is part of choosing which doctests run.
//
//   node --import tsx --test bin/test-estimate.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateLines, estimateSeconds } from "./test-estimate.js";
import type { LedgerRecord } from "./test-ledger-lib.js";

const NOW = new Date("2026-10-12T12:00:00Z");

function run(
  at: { ts: string; durations: Record<string, number> } & Partial<LedgerRecord>,
): LedgerRecord {
  return {
    commit: "c",
    branch: "b",
    treeHash: "t",
    mode: "selected",
    exitCode: 0,
    accounted: true,
    changed: [],
    ranFiles: "sha256:x",
    implicated: "sha256:x",
    failures: [],
    ...at,
  };
}

test("per-file medians of recent completed runs, a typical file for one with no history, over jobs", () => {
  const records = [
    run({
      ts: "2026-10-10T00:00:00Z",
      durations: { "test/a.doctest.md": 10_000, "test/b.doctest.md": 2_000 },
    }),
    run({
      ts: "2026-10-11T00:00:00Z",
      durations: { "test/a.doctest.md": 20_000, "test/b.doctest.md": 4_000 },
    }),
    run({
      ts: "2026-10-11T01:00:00Z",
      durations: { "test/a.doctest.md": 30_000 },
    }),
    // Outside the 30 days, killed, or a marker: none of them is a measurement.
    run({
      ts: "2026-08-01T00:00:00Z",
      durations: { "test/a.doctest.md": 900_000 },
    }),
    run({
      ts: "2026-10-11T02:00:00Z",
      durations: { "test/a.doctest.md": 900_000 },
      exitCode: 143,
    }),
    run({
      ts: "2026-10-11T03:00:00Z",
      durations: { "test/a.doctest.md": 900_000 },
      marker: true,
    }),
    // A line tap printed without `time=` is recorded as 0, not as a fast run.
    run({ ts: "2026-10-11T04:00:00Z", durations: { "test/b.doctest.md": 0 } }),
  ];
  // a: median of 10/20/30 s is 20 s. b: median of 2/4 s is 4 s (upper middle).
  // new: the median of those per-file medians, 20 s. (20 + 4 + 20) / 2 jobs.
  const seconds = estimateSeconds({
    files: ["test/a.doctest.md", "test/b.doctest.md", "test/new.doctest.md"],
    records,
    jobs: 2,
    now: NOW,
  });
  assert.equal(seconds, 22);
});

test("a run is never shorter than its slowest file", () => {
  const records = [
    run({
      ts: "2026-10-11T00:00:00Z",
      durations: { "test/slow.doctest.md": 60_000, "test/a.doctest.md": 1_000 },
    }),
  ];
  const seconds = estimateSeconds({
    files: ["test/slow.doctest.md", "test/a.doctest.md"],
    records,
    jobs: 6,
    now: NOW,
  });
  assert.equal(seconds, 60);
});

test("history for under half the files gives no estimate rather than a guess", () => {
  const one = [run({ ts: "2026-10-11T00:00:00Z", durations: { "test/a.doctest.md": 1_000 } })];
  const files = ["test/a.doctest.md", "test/new1.doctest.md", "test/new2.doctest.md"];
  assert.equal(estimateSeconds({ files, records: one, jobs: 6, now: NOW }), null);
});

test("no recent history gives no estimate rather than a guess", () => {
  const old = [
    run({
      ts: "2026-08-01T00:00:00Z",
      durations: { "test/a.doctest.md": 1_000 },
    }),
  ];
  assert.equal(
    estimateSeconds({
      files: ["test/a.doctest.md"],
      records: old,
      jobs: 6,
      now: NOW,
    }),
    null,
  );
});

test("the background hint appears from five minutes, and the count stands alone without history", () => {
  assert.deepEqual(estimateLines({ count: 131, seconds: 299, jobs: 6 }), [
    "test-select: 131 files, about 5 min at 6 jobs",
  ]);
  assert.deepEqual(estimateLines({ count: 524, seconds: 300, jobs: 6 }), [
    "test-select: 524 files, about 5 min at 6 jobs",
    "test-select: likely to pass a 10-minute foreground limit under load; run it in the background",
  ]);
  assert.deepEqual(estimateLines({ count: 1, seconds: 12, jobs: 6 }), [
    "test-select: 1 file, under 1 min at 6 jobs",
  ]);
  assert.deepEqual(estimateLines({ count: 3, seconds: null, jobs: 6 }), [
    "test-select: 3 files",
  ]);
});
