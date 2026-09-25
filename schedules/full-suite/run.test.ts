/**
 * The decisions the hourly full-suite run makes, tested without a checkout.
 *
 * Everything here is `lib.ts`: which landings are in the batch, whether a red
 * run is a broken environment, whether one failing file is a flake, where the
 * binary search steps next, and what gets written. The I/O halves (`run.ts`,
 * `checkout.ts`) are a git worktree and a suite run; what they need to be right
 * about is here.
 */

import assert from "node:assert/strict";
import { homedir } from "node:os";
import { test } from "node:test";

import type { LedgerRecord } from "../../bin/test-ledger-lib.js";
import {
  ENVIRONMENT_CLUSTER_FILES,
  ENVIRONMENT_FAILURE_FILES,
  LANDING_FIELD_SEPARATOR as FS,
  LANDING_RECORD_SEPARATOR as RS,
  LEDGER_SOURCE,
  TIERS,
  batchExit,
  bisect,
  bisectStep,
  classifyFailure,
  completionMarker,
  environmentCluster,
  failureExcerpt,
  firstErrorLine,
  firstErrorLines,
  isEnvironmentFailure,
  isHostQuiet,
  issuePath,
  lastTestedCommit,
  narrowBisect,
  parseLandings,
  renderIssue,
  tierProducedResults,
  workstreamOf,
  unstageIssueArgs,
} from "./lib.js";
import { renderEnvironmentAlert } from "./alerts.js";

// ─── the batch ────────────────────────────────────────────────────────────

const log = (entries: Array<[string, string]>): string =>
  entries.map(([commit, subject]) => `${commit}${FS}${subject}${RS}`).join("\n");

test("parseLandings reads the first-parent log, oldest first", () => {
  const raw = log([
    ["a".repeat(40), "Merge branch 'worktree-scanner-ingest'"],
    ["b".repeat(40), "docs: fix a typo"],
  ]);
  assert.deepEqual(parseLandings(raw), [
    { commit: "a".repeat(40), subject: "Merge branch 'worktree-scanner-ingest'" },
    { commit: "b".repeat(40), subject: "docs: fix a typo" },
  ]);
});

test("parseLandings survives a subject with a newline in it", () => {
  // The reason the format is unit-separated: a line-splitting parser turns the
  // second line into a landing with no commit.
  const raw = log([["c".repeat(40), "feat: a thing\nand its second line"]]);
  const landings = parseLandings(raw);
  assert.equal(landings.length, 1);
  assert.equal(landings[0]?.commit, "c".repeat(40));
});

test("parseLandings on an empty range is an empty batch", () => {
  assert.deepEqual(parseLandings(""), []);
  assert.deepEqual(parseLandings("\n"), []);
});

test("workstreamOf reads bin/land's merge subject, and admits when there is none", () => {
  assert.equal(workstreamOf("Merge branch 'worktree-test-economics'"), "test-economics");
  assert.equal(workstreamOf("Merge branch 'worktree-a' into main"), "a");
  assert.equal(workstreamOf("fix(chat): a husk title"), null);
});

// ─── the baseline ─────────────────────────────────────────────────────────

function record(overrides: Partial<LedgerRecord>): LedgerRecord {
  return {
    ts: "2026-08-25T00:00:00.000Z",
    commit: "0".repeat(40),
    branch: "HEAD",
    treeHash: "sha256:0",
    mode: "full",
    accounted: null,
    changed: [],
    ranFiles: "sha256:r",
    implicated: "sha256:i",
    durations: {},
    failures: [],
    ...overrides,
  };
}

/** The marker the run writes once both tiers are done, at `commit`. */
function marker(commit: string, exitCode: number): LedgerRecord {
  return completionMarker({
    commit,
    branch: "HEAD",
    treeHash: "sha256:0",
    exitCode,
    tiers: [...TIERS],
    changed: [],
    emptyFileset: "sha256:empty",
  });
}

test("lastTestedCommit takes the newest completed marker this schedule wrote", () => {
  const records = [
    marker("a".repeat(40), 0),
    // Somebody's own `pnpm test` on main: no source, so not this schedule's.
    record({ commit: "z".repeat(40), branch: "main", exitCode: 0 }),
    // A red batch still counts — its failures were filed, and re-testing the
    // same range hourly would re-file them.
    marker("b".repeat(40), 1),
  ];
  assert.equal(lastTestedCommit(records), "b".repeat(40));
});

test("a tier record alone does not mark a commit tested", () => {
  // The exact shape of a run that died between the two tiers: the ordinary
  // tier finished and recorded, the careful tier never ran. Reading this as
  // "tested" would skip the careful tier for that range forever.
  const records = [
    marker("a".repeat(40), 0),
    record({ commit: "b".repeat(40), source: LEDGER_SOURCE, tier: "ordinary", exitCode: 0 }),
  ];
  assert.equal(lastTestedCommit(records), "a".repeat(40));
});

test("lastTestedCommit ignores a marker whose batch did not complete", () => {
  assert.equal(lastTestedCommit([marker("a".repeat(40), 0), marker("b".repeat(40), 143)]), "a".repeat(40));
});

test("lastTestedCommit is null before the schedule has ever run", () => {
  assert.equal(lastTestedCommit([record({ commit: "a".repeat(40) })]), null);
  assert.equal(lastTestedCommit([]), null);
});

test("a marker records no files, so it is no run's denominator", () => {
  const written = marker("a".repeat(40), 0);
  assert.equal(written.marker, true);
  assert.deepEqual(written.tiers, ["ordinary", "careful"]);
  assert.deepEqual(written.failures, []);
  assert.deepEqual(written.durations, {});
});

test("batchExit is the worst tier, unless one never completed", () => {
  assert.equal(batchExit([0, 0]), 0);
  assert.equal(batchExit([0, 1]), 1);
  // A killed tier: reported as-is, which keeps the marker out of the baseline.
  assert.equal(batchExit([1, 143]), 143);
  assert.equal(batchExit([0, null]), 2);
});

// ─── classifying red ──────────────────────────────────────────────────────

test("a wide failure is the environment, not a batch of bugs", () => {
  const wide = Array.from({ length: ENVIRONMENT_FAILURE_FILES + 1 }, (_unused, i) => `test/f${String(i)}.test.ts`);
  assert.equal(isEnvironmentFailure({ failures: wide }), true);
  assert.equal(isEnvironmentFailure({ failures: wide.slice(0, ENVIRONMENT_FAILURE_FILES) }), false);
});

/** A TAP block per file, all failing the same way. */
const loaderBlock = (files: string[], error: string): string =>
  files
    .map((file, i) => [`not ok ${String(i + 1)} - ${file}`, "  ---", `  error: ${error}`, "  ...", ""].join("\n"))
    .join("\n");

test("a directory failing identically is the environment, under the file bar", () => {
  // The plan's own example: the frontend loader block, 13 files — well under
  // the 20-file bar, and thirteen bogus issues if it is bisected.
  const files = Array.from({ length: 13 }, (_unused, i) => `test/frontend/f${String(i)}.test.ts`);
  const raw = loaderBlock(files, "Cannot find module 'react-dom/client'");
  const firstErrors = firstErrorLines({ raw, files });
  assert.equal(isEnvironmentFailure({ failures: files, firstErrors }), true);
  assert.equal(environmentCluster({ failures: files, firstErrors })?.directory, "test/frontend/");
});

test("a cluster needs the SAME error, not just the same directory", () => {
  const files = Array.from({ length: ENVIRONMENT_CLUSTER_FILES }, (_unused, i) => `test/core/f${String(i)}.test.ts`);
  const raw = files
    .map((file, i) => `not ok ${String(i + 1)} - ${file}\n  ---\n  error: distinct failure ${String(i)}\n  ...\n`)
    .join("\n");
  const firstErrors = firstErrorLines({ raw, files });
  assert.equal(isEnvironmentFailure({ failures: files, firstErrors }), false);
  assert.equal(environmentCluster({ failures: files, firstErrors }), null);
});

test("too few files failing alike is a set of bugs, not a broken machine", () => {
  const files = Array.from({ length: ENVIRONMENT_CLUSTER_FILES - 1 }, (_unused, i) => `test/frontend/f${String(i)}.test.ts`);
  const raw = loaderBlock(files, "Cannot find module 'react-dom/client'");
  assert.equal(isEnvironmentFailure({ failures: files, firstErrors: firstErrorLines({ raw, files }) }), false);
});

test("files with no readable error are never clustered", () => {
  const files = Array.from({ length: 8 }, (_unused, i) => `test/frontend/f${String(i)}.test.ts`);
  const raw = files.map((file, i) => `not ok ${String(i + 1)} - ${file}`).join("\n");
  const firstErrors = firstErrorLines({ raw, files });
  assert.deepEqual(Object.values(firstErrors), files.map(() => null));
  assert.equal(isEnvironmentFailure({ failures: files, firstErrors }), false);
});

test("firstErrorLine reads a folded scalar's next line", () => {
  const raw = ["not ok 1 - test/a.test.ts", "  ---", "  error: >-", "    ENOENT: no such file", "  ...", ""].join("\n");
  assert.equal(firstErrorLine({ raw, file: "test/a.test.ts" }), "ENOENT: no such file");
});

test("the environment alert says which rule fired", () => {
  const files = Array.from({ length: 13 }, (_unused, i) => `test/frontend/f${String(i)}.test.ts`);
  const raw = loaderBlock(files, "Cannot find module 'react-dom/client'");
  const cluster = environmentCluster({ failures: files, firstErrors: firstErrorLines({ raw, files }) });
  const message = renderEnvironmentAlert({ testedCommit: "1".repeat(40), failures: files, cluster });
  assert.match(message, /13 files under `test\/frontend\/` all failed with the same first error/u);
  assert.match(message, /\*\*Shared error:\*\* Cannot find module/u);
});

test("classifyFailure follows the plan's order", () => {
  // Passes alone: a flake by definition, whatever its history.
  assert.equal(classifyFailure({ isolatedPass: true, flakeShare: 0 }), "flake");
  // Fails twice, but the ledger already knows it flakes.
  assert.equal(classifyFailure({ isolatedPass: false, flakeShare: 0.4 }), "flake");
  // Fails twice with a clean history: the batch's to answer for.
  assert.equal(classifyFailure({ isolatedPass: false, flakeShare: 0.1 }), "real");
});

// ─── bisect ───────────────────────────────────────────────────────────────

test("bisectStep halves, and stops when the range is one landing", () => {
  assert.equal(bisectStep({ lo: 0, hi: 7 }), 3);
  assert.equal(bisectStep({ lo: 4, hi: 4 }), null);
  assert.equal(bisectStep({ lo: 0, hi: 1 }), 0);
});

test("narrowBisect clears a passing landing and bounds on a failing one", () => {
  assert.deepEqual(narrowBisect({ range: { lo: 0, hi: 7 }, index: 3, passed: true }), { lo: 4, hi: 7 });
  assert.deepEqual(narrowBisect({ range: { lo: 0, hi: 7 }, index: 3, passed: false }), { lo: 0, hi: 3 });
});

test("bisect finds the first failing landing, and asks about log2 of them", async () => {
  for (let culprit = 0; culprit < 9; culprit++) {
    const asked: number[] = [];
    const found = await bisect({
      count: 9,
      passesAt: (index) => {
        asked.push(index);
        return Promise.resolve(index < culprit);
      },
    });
    assert.equal(found, culprit, `culprit ${String(culprit)}`);
    assert.ok(asked.length <= 4, `asked ${String(asked.length)} times for 9 landings`);
  }
});

// ─── the quiet-host decision ──────────────────────────────────────────────

test("isHostQuiet needs both load under bar and pressure under critical", () => {
  assert.equal(isHostQuiet({ load1: 4, bar: 8, level: 1 }), true);
  // 2026-09-11: load1 8 read quiet against a bar of 12 while swap thrashed —
  // pressure has to gate independently of load, not just raise the bar.
  assert.equal(isHostQuiet({ load1: 4, bar: 8, level: 4 }), false);
  assert.equal(isHostQuiet({ load1: 20, bar: 8, level: 1 }), false);
});

test("isHostQuiet treats a missing pressure signal (non-Darwin) as no objection", () => {
  assert.equal(isHostQuiet({ load1: 4, bar: 8, level: null }), true);
});

test("isHostQuiet is not tripped by warn, only critical", () => {
  assert.equal(isHostQuiet({ load1: 4, bar: 8, level: 2 }), true);
});

// ─── did a tier actually run ──────────────────────────────────────────────

// 2026-09-11: the load-gate refusal is exit 1 with no `ok`/`not ok` lines, which `failingFiles` would read as green.
const refusalOutput = "test-ledger: host is under critical memory pressure...\n";

test("tierProducedResults trusts a clean exit even with no parsed files", () => {
  assert.equal(tierProducedResults({ exitCode: 0, output: "" }), true);
});

test("tierProducedResults is false only for a non-zero exit with no TAP output", () => {
  assert.equal(tierProducedResults({ exitCode: 1, output: refusalOutput }), false);
  const output = "ok 1 - test/a.test.ts # time=10ms\nnot ok 2 - test/b.test.ts # time=20ms\n";
  assert.equal(tierProducedResults({ exitCode: 1, output }), true);
});

test("bisect over a single landing asks nothing — it is already the answer", async () => {
  let asked = 0;
  const found = await bisect({
    count: 1,
    passesAt: () => {
      asked++;
      return Promise.resolve(true);
    },
  });
  assert.equal(found, 0);
  assert.equal(asked, 0);
});

// ─── what gets written ────────────────────────────────────────────────────

const landing = { commit: "abcdef1234567890".padEnd(40, "0"), subject: "Merge branch 'worktree-scanner-ingest'" };

test("issuePath follows issues/CLAUDE.md and carries the landing in the slug", () => {
  assert.equal(
    issuePath({ date: "2026-08-25", landing }),
    "issues/bugs/2026-08-25-full-suite-red-scanner-ingest-abcdef12.md",
  );
  assert.equal(
    issuePath({ date: "2026-08-25", landing: { commit: "f".repeat(40), subject: "docs: typo" } }),
    "issues/bugs/2026-08-25-full-suite-red-ffffffff.md",
  );
});

test("a failed issue commit is cleaned up with a path-scoped unstage", () => {
  const args = unstageIssueArgs(["issues/bugs/a.md", "issues/bugs/b.md"]);
  assert.deepEqual(args, ["restore", "--staged", "--", "issues/bugs/a.md", "issues/bugs/b.md"]);
});

test("renderIssue names the landing, the workstream, the files and the excerpt", () => {
  const text = renderIssue({
    date: "2026-08-25",
    landing,
    files: ["test/core/box/file-watcher.doctest.md"],
    excerpt: `not ok 12 - test/core/box/file-watcher.doctest.md\n  command: ${homedir()}/.nvm/bin/node`,
    testedCommit: "1".repeat(40),
    baseCommit: "2".repeat(40),
  });
  assert.match(text, /^---\n/u);
  assert.match(text, /^workstream: scanner-ingest$/mu);
  assert.match(text, /^priority: important$/mu);
  assert.match(text, /^discovered-in: worktree-scanner-ingest — /mu);
  assert.match(text, /abcdef12/u);
  assert.match(text, /test\/core\/box\/file-watcher\.doctest\.md/u);
  assert.match(text, /^title: "Full-suite red: test\/core\/box\/file-watcher\.doctest\.md"$/mu);
  assert.match(text, /not ok 12/u);
  // The excerpt's home paths are written as `~`, or path-leak-check refuses the report.
  assert.match(text, /command: ~\/\.nvm\/bin\/node/u);
  assert.ok(!text.includes(homedir()));
  // No `# H1`: the title lives in frontmatter.
  assert.doesNotMatch(text, /^# /mu);
});

test("renderIssue on a direct commit to main claims no workstream", () => {
  const text = renderIssue({
    date: "2026-08-25",
    landing: { commit: "f".repeat(40), subject: "docs: typo" },
    files: ["test/a.test.ts"],
    excerpt: "",
    testedCommit: "1".repeat(40),
    baseCommit: "2".repeat(40),
  });
  assert.match(text, /^workstream: unattached$/mu);
  assert.doesNotMatch(text, /^discovered-in:/mu);
});

// ─── the excerpt ──────────────────────────────────────────────────────────

const TAP = [
  "ok 1 - test/a.test.ts # time=10ms",
  "not ok 2 - test/b.doctest.md # time=20ms",
  "  ---",
  "  error: expected 1 got 2",
  "  ...",
  "ok 3 - test/c.test.ts # time=30ms",
].join("\n");

test("failureExcerpt takes one file's block and stops at the next result", () => {
  const excerpt = failureExcerpt({ raw: TAP, file: "test/b.doctest.md" });
  assert.match(excerpt, /not ok 2 - test\/b\.doctest\.md/u);
  assert.match(excerpt, /expected 1 got 2/u);
  assert.doesNotMatch(excerpt, /test\/c\.test\.ts/u);
});

test("failureExcerpt says so rather than inventing a block", () => {
  assert.match(failureExcerpt({ raw: TAP, file: "test/missing.test.ts" }), /no TAP block found/u);
});

test("failureExcerpt matches the whole path, not a prefix of it", () => {
  // `test/b.doctest.md` must not answer for `test/b.doctest.md.bak`.
  const raw = "not ok 2 - test/b.doctest.md.bak\n  ---\n  boom\n";
  assert.match(failureExcerpt({ raw, file: "test/b.doctest.md" }), /no TAP block found/u);
});
