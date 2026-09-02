/**
 * The load gate and repeat suppression, on the shape of the real incident:
 * the 2026-08-30..09-01 event where `file-watcher.doctest.md` ran at 16–195×
 * its healthy median and eight identical hourly alerts went unacknowledged.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { LedgerRecord } from "../../bin/test-ledger-lib.js";
import { LEDGER_SOURCE, completionMarker, TIERS } from "./lib.js";
import {
  SLOWDOWN_MIN_SAMPLES,
  SLOWDOWN_UNTRUSTED,
  alertFingerprint,
  batchSlowdown,
  durationHistories,
  median,
  renderDeferredAlert,
  runIsUntrusted,
  shouldSuppressAlert,
} from "./trust.js";

function tierRecord(durations: Record<string, number>, overrides?: Partial<LedgerRecord>): LedgerRecord {
  return {
    ts: "2026-08-25T00:00:00.000Z",
    commit: "0".repeat(40),
    branch: "HEAD",
    treeHash: "sha256:0",
    mode: "full",
    source: LEDGER_SOURCE,
    accounted: null,
    changed: [],
    ranFiles: "sha256:r",
    implicated: "sha256:i",
    durations,
    failures: [],
    ...overrides,
  };
}

/** A distinct 40-char commit per run, so each record group is its own run. */
function commitFor(run: number): string {
  return `${String(run)}a`.repeat(20).slice(0, 40);
}

/** N healthy runs of `count` files, each file at ~1.5s, one commit per run. */
function healthyRecords(runs: number, count: number): LedgerRecord[] {
  const durations = Object.fromEntries(
    Array.from({ length: count }, (_unused, i) => [`test/f${String(i)}.test.ts`, 1500 + i]),
  );
  return Array.from({ length: runs }, (_unused, run) => tierRecord(durations, { commit: commitFor(run) }));
}

test("median of an empty list is null, odd and even lists are exact", () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test("durationHistories reads only this schedule's tier records", () => {
  const records = [
    tierRecord({ "test/a.test.ts": 1000 }),
    // Somebody's own run: a different source, not comparable concurrency.
    tierRecord({ "test/a.test.ts": 9000 }, { source: "iteration" }),
    // The marker carries no durations and must not dilute anything.
    completionMarker({
      commit: "1".repeat(40),
      branch: "HEAD",
      treeHash: "sha256:0",
      exitCode: 0,
      tiers: [...TIERS],
      changed: [],
      emptyFileset: "sha256:empty",
    }),
    // A later run at another commit: a separate group, a separate sample.
    tierRecord({ "test/a.test.ts": 2000 }, { commit: commitFor(1) }),
  ];
  assert.deepEqual(durationHistories({ records }).get("test/a.test.ts"), [1000, 2000]);
});

test("a run at its usual speed is trusted", () => {
  const histories = durationHistories({ records: healthyRecords(5, SLOWDOWN_MIN_SAMPLES) });
  const current = Object.fromEntries(
    Array.from({ length: SLOWDOWN_MIN_SAMPLES }, (_unused, i) => [`test/f${String(i)}.test.ts`, 1800]),
  );
  const slowdown = batchSlowdown({ current, histories });
  assert.ok(slowdown.factor !== null && slowdown.factor < SLOWDOWN_UNTRUSTED);
  assert.equal(runIsUntrusted(slowdown), false);
});

test("a thrashed run is untrusted — the 08-31 file-watcher shape", () => {
  // Healthy median ~1.5s; the loaded run took 20–30× per file.
  const histories = durationHistories({ records: healthyRecords(5, SLOWDOWN_MIN_SAMPLES) });
  const current = Object.fromEntries(
    Array.from({ length: SLOWDOWN_MIN_SAMPLES }, (_unused, i) => [`test/f${String(i)}.test.ts`, 40000]),
  );
  assert.equal(runIsUntrusted(batchSlowdown({ current, histories })), true);
});

test("one slow file cannot condemn the run — the factor is a median of ratios", () => {
  const histories = durationHistories({ records: healthyRecords(5, SLOWDOWN_MIN_SAMPLES + 4) });
  const current = Object.fromEntries(
    Array.from({ length: SLOWDOWN_MIN_SAMPLES + 4 }, (_unused, i) => [
      `test/f${String(i)}.test.ts`,
      i === 0 ? 300000 : 1600,
    ]),
  );
  assert.equal(runIsUntrusted(batchSlowdown({ current, histories })), false);
});

test("too little history is no judgment: the first runs are trusted", () => {
  // Two prior runs: below the three-run floor per file, so zero samples.
  const histories = durationHistories({ records: healthyRecords(2, 30) });
  const current = { "test/f0.test.ts": 90000 };
  const slowdown = batchSlowdown({ current, histories });
  assert.equal(slowdown.factor, null);
  assert.equal(runIsUntrusted(slowdown), false);
});

test("sub-second tests say nothing about contention", () => {
  const fast = Object.fromEntries(
    Array.from({ length: 30 }, (_unused, i) => [`test/f${String(i)}.test.ts`, 40]),
  );
  const histories = durationHistories({ records: [tierRecord(fast), tierRecord(fast), tierRecord(fast)] });
  // Every 40ms file at 400ms: scheduler noise, not a thrashed host.
  const current = Object.fromEntries(Object.keys(fast).map((file) => [file, 400]));
  const slowdown = batchSlowdown({ current, histories });
  assert.equal(slowdown.factor, null);
  assert.equal(slowdown.samples, 0);
});

test("a sustained load event cannot train the baseline — slowed runs contribute no history", () => {
  // Five healthy runs, then eleven thrashed ones (each its own commit, the way
  // hourly batches land). If the thrashed durations entered the history, the
  // 20-run median would drift to 40s and the twelfth slow run would read as
  // 1.0× — the gate goes blind exactly when it matters.
  const slow = Object.fromEntries(
    Array.from({ length: SLOWDOWN_MIN_SAMPLES }, (_unused, i) => [`test/f${String(i)}.test.ts`, 40000]),
  );
  const records = [
    ...healthyRecords(5, SLOWDOWN_MIN_SAMPLES),
    ...Array.from({ length: 11 }, (_unused, i) => tierRecord(slow, { commit: commitFor(100 + i) })),
  ];
  const histories = durationHistories({ records });
  assert.deepEqual(histories.get("test/f0.test.ts")?.length, 5);
  assert.equal(runIsUntrusted(batchSlowdown({ current: slow, histories })), true);
});

test("a run's tiers are judged together, so the careful tier's few files ride the batch verdict", () => {
  // One run writes an ordinary record (many files) and a careful record (two
  // files) at the same commit. Alone, two files are under the sample floor and
  // the careful record would always fold; grouped, the thrashed run's careful
  // durations stay out of the history too.
  const commit = "c".repeat(40);
  const ordinarySlow = Object.fromEntries(
    Array.from({ length: SLOWDOWN_MIN_SAMPLES }, (_unused, i) => [`test/f${String(i)}.test.ts`, 40000]),
  );
  // The careful record shares its run's commit with the ordinary record.
  const healthy = Array.from({ length: 5 }, (_unused, run) => [
    ...healthyRecords(1, SLOWDOWN_MIN_SAMPLES).map((record) => ({ ...record, commit: commitFor(run) })),
    tierRecord({ "test/careful.doctest.md": 1500 }, { commit: commitFor(run) }),
  ]).flat();
  const records = [
    ...healthy,
    tierRecord(ordinarySlow, { commit }),
    tierRecord({ "test/careful.doctest.md": 60000 }, { commit }),
  ];
  const histories = durationHistories({ records });
  assert.deepEqual(histories.get("test/careful.doctest.md"), [1500, 1500, 1500, 1500, 1500]);
});

// ─── repeat suppression ───────────────────────────────────────────────────

test("the fingerprint is the kind and the file set, order-blind", () => {
  assert.equal(
    alertFingerprint({ kind: "deferred", files: ["b", "a"] }),
    alertFingerprint({ kind: "deferred", files: ["a", "b"] }),
  );
  assert.notEqual(
    alertFingerprint({ kind: "deferred", files: ["a"] }),
    alertFingerprint({ kind: "red-blamed", files: ["a"] }),
  );
});

test("an unchanged condition is suppressed inside the window and re-raised after it", () => {
  const fingerprint = alertFingerprint({ kind: "deferred", files: ["test/a.test.ts"] });
  const previous = { fingerprint, raisedAt: "2026-09-01T00:00:00.000Z" };
  assert.equal(shouldSuppressAlert({ previous, fingerprint, now: new Date("2026-09-01T08:00:00Z") }), true);
  assert.equal(shouldSuppressAlert({ previous, fingerprint, now: new Date("2026-09-02T01:00:00Z") }), false);
  // A different condition always alerts.
  const other = alertFingerprint({ kind: "deferred", files: ["test/b.test.ts"] });
  assert.equal(shouldSuppressAlert({ previous, fingerprint: other, now: new Date("2026-09-01T01:00:00Z") }), false);
  assert.equal(shouldSuppressAlert({ previous: null, fingerprint, now: new Date("2026-09-01T01:00:00Z") }), false);
});

test("the deferred alert says why no verdict was reached", () => {
  const message = renderDeferredAlert({
    testedCommit: "1".repeat(40),
    factor: 12.3,
    samples: 200,
    failures: ["test/core/box/file-watcher.doctest.md"],
    pendingSince: "2026-08-31T02:24:44.666Z",
  });
  assert.match(message, /12\.3× its usual per-file durations/u);
  assert.match(message, /no verdict/u);
  assert.match(message, /file-watcher/u);
  assert.match(message, /Oldest pending entry: 2026-08-31/u);
});
