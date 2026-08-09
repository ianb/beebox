// Tests for the test-ledger's pure logic: TAP parsing, failure classification,
// flake derivation, and aggregation. No git, no esbuild, no test run — the
// I/O shell lives in test-ledger.ts. Run with:
//   node --import tsx --test bin/test-ledger.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyFailure,
  deriveFlakes,
  hashFileset,
  parsePorcelainPaths,
  parseTapFiles,
  summarize,
  type LedgerRecord,
} from "./test-ledger-lib.js";

// ── TAP parsing ─────────────────────────────────────────────────────────────

test("parses per-file results and durations from raw TAP", () => {
  const raw = [
    "TAP version 14",
    "ok 1 - test/core/geo.doctest.md # time=630.192ms",
    "not ok 2 - test/webapp/routes/routes-api.doctest.md # time=5548.991ms",
    "1..2",
  ].join("\n");
  assert.deepEqual(parseTapFiles(raw), [
    { file: "test/core/geo.doctest.md", ok: true, ms: 630 },
    { file: "test/webapp/routes/routes-api.doctest.md", ok: false, ms: 5549 },
  ]);
});

test("ignores indented subtest lines, which would double-count", () => {
  // Every assertion inside a file also emits an `ok` line, indented. Counting
  // those would report thousands of "files" and wreck every denominator.
  const raw = [
    "    ok 1 - (unnamed test)",
    "    ok 2 - test/not-a-real-file.doctest.md",
    "ok 1 - test/core/geo.doctest.md # time=1ms",
  ].join("\n");
  assert.deepEqual(parseTapFiles(raw).map((r) => r.file), ["test/core/geo.doctest.md"]);
});

test("a file result with no timing still parses, with zero duration", () => {
  assert.deepEqual(parseTapFiles("ok 1 - test/a.doctest.md"), [
    { file: "test/a.doctest.md", ok: true, ms: 0 },
  ]);
});

// ── porcelain parsing ───────────────────────────────────────────────────────

/** Join entries the way `git status --porcelain -z` does: NUL-terminated. */
const Z = (entries: string[]): string => entries.map((e) => `${e}\u0000`).join("");

test("an unstaged modification keeps its first character", () => {
  // Regression: trimming porcelain output before splitting strips the leading
  // status space, and `slice(3)` then eats the path's first character. It hit
  // the commonest case there is — ` M path` — and produced "in/foo.ts".
  assert.deepEqual(parsePorcelainPaths(Z([" M bin/test-graph.test.ts"])), [
    "bin/test-graph.test.ts",
  ]);
});

test("staged, untracked, and deleted entries all parse", () => {
  assert.deepEqual(parsePorcelainPaths(Z(["A  a.ts", "?? b.ts", " D c.ts", "MM d.ts"])), [
    "a.ts",
    "b.ts",
    "c.ts",
    "d.ts",
  ]);
});

test("a rename reports the destination and consumes the origin entry", () => {
  // Under -z a rename is TWO entries: `R  new` then a bare `old`. Treating the
  // origin as another status line would slice three characters off it.
  assert.deepEqual(parsePorcelainPaths(Z(["R  new.ts", "old.ts", " M other.ts"])), [
    "new.ts",
    "other.ts",
  ]);
});

test("empty output yields no paths", () => {
  assert.deepEqual(parsePorcelainPaths(""), []);
});

test("a path containing a space survives, because -z never quotes", () => {
  // Without -z git emits `"src/a b.ts"` — quoted — and the quotes land in the
  // recorded path.
  assert.deepEqual(parsePorcelainPaths(Z([" M src/a b.ts"])), ["src/a b.ts"]);
});

test("a path containing ' -> ' is not mistaken for a rename", () => {
  assert.deepEqual(parsePorcelainPaths(Z(["?? src/a -> b.ts"])), ["src/a -> b.ts"]);
});

// ── classification ──────────────────────────────────────────────────────────

test("a failure the graph pointed at is attached", () => {
  const implicated = new Set(["test/a.doctest.md"]);
  assert.equal(classifyFailure({ file: "test/a.doctest.md", implicated }), "attached");
});

test("a failure the graph did not point at is unimplicated", () => {
  // The number the whole instrument exists to produce.
  const implicated = new Set(["test/a.doctest.md"]);
  assert.equal(classifyFailure({ file: "test/b.doctest.md", implicated }), "unimplicated");
});

test("with no graph, a failure is unknown — never guessed either way", () => {
  assert.equal(classifyFailure({ file: "test/a.doctest.md", implicated: null }), "unknown");
});

// ── flake derivation ────────────────────────────────────────────────────────

const FILESETS: Record<string, string[]> = {
  all: ["test/a.doctest.md", "test/b.doctest.md"],
  none: [],
};

function rec(over: Partial<LedgerRecord>): LedgerRecord {
  return {
    ts: "2026-08-09T00:00:00.000Z",
    commit: "c1",
    branch: "worktree-x",
    treeHash: "t1",
    mode: "full",
    exitCode: 0,
    accounted: true,
    changed: [],
    ranFiles: "all",
    implicated: "none",
    durations: {},
    failures: [],
    ...over,
  };
}

test("fail then pass at the same commit and tree is a flake", () => {
  const records = [
    rec({ failures: [{ file: "test/a.doctest.md", class: "attached" }] }),
    rec({ failures: [] }),
  ];
  assert.deepEqual([...deriveFlakes({ records, filesets: FILESETS })], [["test/a.doctest.md", 1]]);
});

test("fail then pass at a DIFFERENT tree is not a flake — someone fixed it", () => {
  const records = [
    rec({ failures: [{ file: "test/a.doctest.md", class: "attached" }] }),
    rec({ treeHash: "t2", failures: [] }),
  ];
  assert.deepEqual([...deriveFlakes({ records, filesets: FILESETS })], []);
});

test("fail then pass at a different commit is not a flake", () => {
  const records = [
    rec({ failures: [{ file: "test/a.doctest.md", class: "attached" }] }),
    rec({ commit: "c2", failures: [] }),
  ];
  assert.deepEqual([...deriveFlakes({ records, filesets: FILESETS })], []);
});

test("a later run that did not include the file proves nothing", () => {
  const records = [
    rec({ failures: [{ file: "test/a.doctest.md", class: "attached" }] }),
    rec({ ranFiles: "none", failures: [] }),
  ];
  assert.deepEqual([...deriveFlakes({ records, filesets: FILESETS })], []);
});

test("repeated fail-then-pass cycles each count", () => {
  const records = [
    rec({ failures: [{ file: "test/a.doctest.md", class: "attached" }] }),
    rec({ failures: [] }),
    rec({ failures: [{ file: "test/a.doctest.md", class: "attached" }] }),
    rec({ failures: [] }),
  ];
  assert.deepEqual([...deriveFlakes({ records, filesets: FILESETS })], [["test/a.doctest.md", 2]]);
});

// ── aggregation ─────────────────────────────────────────────────────────────

test("the denominator counts runs that included the file, not all runs", () => {
  // This is why green runs are recorded at all: without them there is no
  // denominator, and it cannot be reconstructed after the fact.
  const filesets = { both: ["test/a.doctest.md", "test/b.doctest.md"], onlyA: ["test/a.doctest.md"] };
  const records = [
    rec({ ranFiles: "both", failures: [] }),
    rec({ ranFiles: "onlyA", commit: "c2", failures: [{ file: "test/a.doctest.md", class: "unimplicated" }] }),
  ];
  const stats = summarize({ records, filesets });
  assert.equal(stats.get("test/a.doctest.md")?.runs, 2);
  assert.equal(stats.get("test/b.doctest.md")?.runs, 1, "b only ran once");
  assert.equal(stats.get("test/a.doctest.md")?.failures, 1);
  assert.equal(stats.get("test/a.doctest.md")?.unimplicatedFailures, 1);
});

test("a file that never failed still appears, with zero failures", () => {
  const stats = summarize({ records: [rec({})], filesets: FILESETS });
  assert.equal(stats.get("test/b.doctest.md")?.failures, 0);
  assert.equal(stats.get("test/b.doctest.md")?.runs, 1);
});

test("an incomplete run is excluded from the denominator", () => {
  // A signal-killed run reports only the files it reached; counting it would
  // inflate every file's run count with a run that never had a chance to fail.
  const records = [rec({ exitCode: 0 }), rec({ commit: "c2", exitCode: 143 })];
  assert.equal(summarize({ records, filesets: FILESETS }).get("test/a.doctest.md")?.runs, 1);
});

test("a completed run with failures still counts", () => {
  const records = [
    rec({ exitCode: 1, failures: [{ file: "test/a.doctest.md", class: "attached" }] }),
  ];
  const stats = summarize({ records, filesets: FILESETS });
  assert.equal(stats.get("test/a.doctest.md")?.runs, 1);
  assert.equal(stats.get("test/a.doctest.md")?.failures, 1);
});

test("median duration comes from the recorded per-file timings", () => {
  const records = [
    rec({ durations: { "test/a.doctest.md": 100 } }),
    rec({ commit: "c2", durations: { "test/a.doctest.md": 300 } }),
    rec({ commit: "c3", durations: { "test/a.doctest.md": 200 } }),
  ];
  assert.equal(summarize({ records, filesets: FILESETS }).get("test/a.doctest.md")?.medianMs, 200);
});

// ── fileset hashing ─────────────────────────────────────────────────────────

test("fileset hashing is order-independent", () => {
  assert.equal(hashFileset(["b", "a"]), hashFileset(["a", "b"]));
});

test("different filesets hash differently", () => {
  assert.notEqual(hashFileset(["a"]), hashFileset(["a", "b"]));
});
