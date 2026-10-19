// # Context-size history ledger
//
// `appendRun` folds one audit run's context measurements into the history,
// keyed by box → audit id → entries (oldest first). It's pure: the prior
// history object is never mutated, so successive runs accumulate.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunMeasurement } from "../../../src/dev/lib/context-history.js";
import type { ContextStats } from "../../../src/dev/lib/context-usage.js";
import { appendRun, loadHistory, recordRun } from "../../../src/dev/lib/context-history.js";

const stats = ({ initialTokens, peakTokens, turnCount }: { initialTokens: number; peakTokens: number; turnCount: number }): ContextStats => ({
  initialTokens, peakTokens, addedTokens: peakTokens - initialTokens, turnCount,
});
const run = ({ box, date, measurements }: { box: string; date: string; measurements: RunMeasurement[] }) => ({
  box, date, boxCommit: "boxsha", repoCommit: "reposha", measurements,
});

async function captureWarnings<T>(fn: () => Promise<T>) {
  const original = console.warn;
  const warnings: string[] = [];
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    const value = await fn();
    return { value, warnings };
  } finally {
    console.warn = original;
  }
}

const base = { boxCommit: "boxsha", repoCommit: "reposha" };
const ENTRY1 = { ...base, date: "2026-06-20T00:00:00Z", initial: 41000, peak: 41000, added: 0, turns: 1 };
const ENTRY2 = { ...base, date: "2026-06-21T00:00:00Z", initial: 38000, peak: 39000, added: 1000, turns: 3 };
const ENTRY3 = { ...base, date: "2026-06-21T00:00:00Z", initial: 52000, peak: 52000, added: 0, turns: 1 };

// ## A first run seeds the box and audit
void test("A first run seeds the box and audit", async (t) => {
  // doctest:L38
  const h1 = appendRun({}, run({ box: "test1", date: "2026-06-20T00:00:00Z", measurements: [
    { auditId: "box-structure-inbox", stats: stats({ initialTokens: 41000, peakTokens: 41000, turnCount: 1 }) },
  ] }));
  t.check(h1, { test1: { "box-structure-inbox": [ENTRY1] } });

  // ## A later run appends to the same audit's series
  //
  // The earlier entry is preserved; the new one lands after it. Watching `initial`
  // drop across this series is the whole point — trim, re-run, compare.

  // doctest:L51
  const h2 = appendRun(h1, run({ box: "test1", date: "2026-06-21T00:00:00Z", measurements: [
    { auditId: "box-structure-inbox", stats: stats({ initialTokens: 38000, peakTokens: 39000, turnCount: 3 }) },
  ] }));
  t.check(h2, { test1: { "box-structure-inbox": [ENTRY1, ENTRY2] } });

  // ## appendRun does not mutate the input history

  // doctest:L61
  t.check(h1, { test1: { "box-structure-inbox": [ENTRY1] } });

  // ## Different boxes stay isolated

  // doctest:L68
  const h3 = appendRun(h2, run({ box: "ledger", date: "2026-06-21T00:00:00Z", measurements: [
    { auditId: "box-structure-inbox", stats: stats({ initialTokens: 52000, peakTokens: 52000, turnCount: 1 }) },
  ] }));
  t.check(h3, { test1: { "box-structure-inbox": [ENTRY1, ENTRY2] }, ledger: { "box-structure-inbox": [ENTRY3] } });
});

// ## A malformed entry is warned about and skipped, not fatal to the whole ledger
//
// `loadHistory` parses the outer box → audit id → entries shape strictly, but
// validates each entry individually — a single row missing required fields
// (the 2026-08-23 `points-at-ui-path-vs-control` merge-conflict incident, where
// a resolution silently dropped an entry's `added`/`turns` lines) is warned
// about and dropped, while every other entry — in the same audit id or a
// different one — still loads.
void test("loadHistory parses the outer box → audit id → entries shape strictly, but val...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L85
  const dir = await mkdtemp(join(tmpdir(), "context-history-"));
  const historyPath = join(dir, "context-history.yaml");
  await writeFile(
    historyPath,
    [
      "test1:",
      "  broken-audit:",
      "    - date: 2026-08-23T17:03:41.065Z",
      "      boxCommit: boxsha",
      "      repoCommit: reposha",
      "      initial: 52302",
      "      peak: 52302",
      "  fine-audit:",
      "    - date: 2026-08-23T17:03:41.065Z",
      "      boxCommit: boxsha",
      "      repoCommit: reposha",
      "      initial: 41000",
      "      peak: 41000",
      "      added: 0",
      "      turns: 1",
      "",
    ].join("\n"),
    "utf-8",
  );
  const { value: loaded, warnings } = await captureWarnings(() => loadHistory(historyPath));
  t.check(loaded, {
    test1: {
      "broken-audit": [],
      "fine-audit": [{ date: "2026-08-23T17:03:41.065Z", boxCommit: "boxsha", repoCommit: "reposha", initial: 41000, peak: 41000, added: 0, turns: 1 }],
    },
  });
  t.check(warnings, [
    `context-history: malformed entry for audit "broken-audit" (box "test1", index 0) is ignored and will be dropped by the next recorded run; repair it in the ledger to keep it: [
  {
    "expected": "number",
    "code": "invalid_type",
    "path": [
      "added"
    ],
    "message": "Invalid input: expected number, received undefined"
  },
  {
    "expected": "number",
    "code": "invalid_type",
    "path": [
      "turns"
    ],
    "message": "Invalid input: expected number, received undefined"
  }
]`,
  ]);

  // ## `recordRun` still records a new measurement past a malformed neighbor
  //
  // The knowledge-audit harness calls `recordRun` after every run, so the row
  // that blocked recording on 2026-08-23 must not block a later, unrelated
  // audit's measurement from being appended and written back.

  // doctest:L125
  await recordRun({
    historyPath,
    box: "test1",
    date: "2026-08-24T00:00:00Z",
    boxCommit: "boxsha2",
    repoCommit: "reposha2",
    measurements: [{ auditId: "new-audit", stats: stats({ initialTokens: 30000, peakTokens: 31000, turnCount: 2 }) }],
  });
  const after = await loadHistory(historyPath);
  t.check(after, {
    test1: {
      "broken-audit": [],
      "fine-audit": [{ date: "2026-08-23T17:03:41.065Z", boxCommit: "boxsha", repoCommit: "reposha", initial: 41000, peak: 41000, added: 0, turns: 1 }],
      "new-audit": [{ date: "2026-08-24T00:00:00Z", boxCommit: "boxsha2", repoCommit: "reposha2", initial: 30000, peak: 31000, added: 1000, turns: 2 }],
    },
  });
});
