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
import { test } from "node:test";

import type { LedgerRecord } from "../../bin/test-ledger-lib.js";
import {
  BISECT_MAX_FILES,
  ENVIRONMENT_FAILURE_FILES,
  LANDING_FIELD_SEPARATOR as FS,
  LANDING_RECORD_SEPARATOR as RS,
  LEDGER_SOURCE,
  bisect,
  bisectStep,
  classifyFailure,
  failureExcerpt,
  isEnvironmentFailure,
  issuePath,
  lastTestedCommit,
  narrowBisect,
  parseLandings,
  renderEnvironmentAlert,
  renderIssue,
  renderRedAlert,
  workstreamOf,
} from "./lib.js";

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

test("lastTestedCommit takes the newest completed run this schedule made", () => {
  const records = [
    record({ commit: "a".repeat(40), source: LEDGER_SOURCE, exitCode: 0 }),
    // Somebody's own `pnpm test` on main: no source, so not this schedule's.
    record({ commit: "z".repeat(40), branch: "main", exitCode: 0 }),
    // A red batch still counts — its failures were filed, and re-testing the
    // same range hourly would re-file them.
    record({ commit: "b".repeat(40), source: LEDGER_SOURCE, exitCode: 1 }),
  ];
  assert.equal(lastTestedCommit(records), "b".repeat(40));
});

test("lastTestedCommit ignores a run that did not complete", () => {
  const records = [
    record({ commit: "a".repeat(40), source: LEDGER_SOURCE, exitCode: 0 }),
    record({ commit: "b".repeat(40), source: LEDGER_SOURCE, exitCode: 143 }),
  ];
  assert.equal(lastTestedCommit(records), "a".repeat(40));
});

test("lastTestedCommit is null before the schedule has ever run", () => {
  assert.equal(lastTestedCommit([record({ commit: "a".repeat(40) })]), null);
  assert.equal(lastTestedCommit([]), null);
});

// ─── classifying red ──────────────────────────────────────────────────────

test("a wide failure is the environment, not a batch of bugs", () => {
  const wide = Array.from({ length: ENVIRONMENT_FAILURE_FILES + 1 }, (_unused, i) => `test/f${String(i)}.test.ts`);
  assert.equal(isEnvironmentFailure({ failures: wide }), true);
  assert.equal(isEnvironmentFailure({ failures: wide.slice(0, ENVIRONMENT_FAILURE_FILES) }), false);
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

test("renderIssue names the landing, the workstream, the files and the excerpt", () => {
  const text = renderIssue({
    date: "2026-08-25",
    landing,
    files: ["test/core/box/file-watcher.doctest.md"],
    excerpt: "not ok 12 - test/core/box/file-watcher.doctest.md",
    testedCommit: "1".repeat(40),
    baseCommit: "2".repeat(40),
  });
  assert.match(text, /^---\n/u);
  assert.match(text, /^workstream: scanner-ingest$/mu);
  assert.match(text, /^priority: important$/mu);
  assert.match(text, /^discovered-in: worktree-scanner-ingest — /mu);
  assert.match(text, /abcdef12/u);
  assert.match(text, /test\/core\/box\/file-watcher\.doctest\.md/u);
  assert.match(text, /not ok 12/u);
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

test("the red alert names culprits, flakes and what it did not bisect", () => {
  const message = renderRedAlert({
    testedCommit: "1".repeat(40),
    baseCommit: "2".repeat(40),
    landings: [landing],
    culprits: [{ landing, files: ["test/a.test.ts"], excerpt: "" }],
    flakes: ["test/hub/hub-e2e.doctest.md"],
    unattributed: ["test/b.test.ts"],
  });
  assert.match(message, /`abcdef12` \(scanner-ingest\): test\/a\.test\.ts/u);
  assert.match(message, /hub-e2e/u);
  assert.ok(message.includes(`${String(BISECT_MAX_FILES)}-file budget`), message);
});

test("the environment alert says why nothing was filed", () => {
  const message = renderEnvironmentAlert({
    testedCommit: "1".repeat(40),
    failures: Array.from({ length: 40 }, (_unused, i) => `test/f${String(i)}.test.ts`),
  });
  assert.match(message, /40 test files failed/u);
  assert.match(message, /no\nissue was filed/u);
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
