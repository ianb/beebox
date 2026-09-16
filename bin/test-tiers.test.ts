// Tests for the ordinary/careful tiers — list parsing, the argv the ledger
// wrapper builds, and the selector's exclusion of careful files. A `.test.ts`
// rather than the doctest this directory's CLAUDE.md asks for, for the same
// reason bin/test-select.test.ts is one: the thing under test decides which
// doctests run, so exercising it from inside that suite is circular.
//
//   node --import tsx --test bin/test-tiers.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  capJobs,
  cappedJobs,
  hasExplicitJobs,
  carefulExclusions,
  parseCarefulList,
  readCarefulList,
  taprcTestFiles,
  tierCommand,
  TierListError,
} from "./test-tiers.js";
import { selectTests } from "./test-select-lib.js";
import type { TestGraph } from "./test-graph-query.js";

/** A fixture package: `files` maps package-relative path -> contents. */
function fixture(files: Record<string, string>): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "test-tiers-"));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// ── the careful list ────────────────────────────────────────────────────────

test("comments, trailing comments and blank lines are not test paths", () => {
  const text = ["# why this tier exists", "", "test/a.doctest.md", "  test/b.doctest.md  ", ""];
  assert.deepEqual(parseCarefulList(text.join("\n")), ["test/a.doctest.md", "test/b.doctest.md"]);
});

test("a listed path that does not exist fails loudly", () => {
  // Silently shrinking the tier is the failure the list exists to prevent: the
  // run would stay green while testing less than it claims to.
  const fx = fixture({
    "test/careful.txt": "test/here.doctest.md\ntest/gone.doctest.md\n",
    "test/here.doctest.md": "# here\n",
  });
  try {
    assert.throws(() => readCarefulList(fx.root), TierListError);
    assert.throws(() => readCarefulList(fx.root), /test\/gone\.doctest\.md/);
  } finally {
    fx.cleanup();
  }
});

test("no careful.txt at all is an empty tier, not an error", () => {
  const fx = fixture({ "test/a.doctest.md": "# a\n" });
  try {
    assert.deepEqual(readCarefulList(fx.root), []);
  } finally {
    fx.cleanup();
  }
});

test("the repo's own careful.txt exists and every path in it is real", () => {
  // The list is committed and the files it names move; this is the guard that
  // says so at `pnpm test` time rather than at the next batched run.
  assert.ok(carefulExclusions().length > 0);
  for (const path of carefulExclusions()) assert.match(path, /^beebox\/test\//);
});

// ── what `.taprc` includes ──────────────────────────────────────────────────

test("taprc include/exclude are read, not restated", () => {
  const fx = fixture({
    ".taprc": "include:\n  - test/**/*.doctest.md\nexclude:\n  - test/skipme/**\n",
    "test/a.doctest.md": "# a\n",
    "test/skipme/b.doctest.md": "# b\n",
    "test/c.test.ts": "",
  });
  try {
    assert.deepEqual(taprcTestFiles(fx.root), ["test/a.doctest.md"]);
  } finally {
    fx.cleanup();
  }
});

// ── argv ────────────────────────────────────────────────────────────────────

const TAPRC_FILES = ["test/a.doctest.md", "test/flaky.doctest.md", "test/b.test.ts"];
const CAREFUL = ["test/flaky.doctest.md"];

test("the ordinary tier runs everything the careful tier does not", () => {
  assert.deepEqual(
    tierCommand({ command: ["tap"], tier: "ordinary", taprcFiles: TAPRC_FILES, careful: CAREFUL }),
    ["tap", "test/a.doctest.md", "test/b.test.ts"],
  );
});

test("the careful tier runs its own list, one job at a time", () => {
  assert.deepEqual(
    tierCommand({ command: ["tap"], tier: "careful", taprcFiles: TAPRC_FILES, careful: CAREFUL }),
    ["tap", "-j1", "test/flaky.doctest.md"],
  );
});

test("a caller's own -j wins over the tier's", () => {
  assert.deepEqual(
    tierCommand({
      command: ["tap", "-j2"],
      tier: "careful",
      taprcFiles: TAPRC_FILES,
      careful: CAREFUL,
    }),
    ["tap", "-j2", "test/flaky.doctest.md"],
  );
});

test("explicit files pass through — that is how test:changed runs a selection", () => {
  assert.deepEqual(
    tierCommand({
      command: ["tap", "test/a.doctest.md"],
      tier: "ordinary",
      taprcFiles: TAPRC_FILES,
      careful: CAREFUL,
    }),
    ["tap", "test/a.doctest.md"],
  );
});

test("an option's value is not a file list, and does not suppress the tier", () => {
  // `tap --timeout 300` and `tap --grep box` put a bare word in argv. Reading
  // it as "the caller named the files" left a bare `tap`, which falls back to
  // .taprc and runs everything — the careful tier included.
  const never = (): boolean => false;
  for (const command of [
    ["tap", "--timeout", "300"],
    ["tap", "--grep", "box"],
  ]) {
    assert.deepEqual(
      tierCommand({ command, tier: "ordinary", taprcFiles: TAPRC_FILES, careful: CAREFUL, isFile: never }),
      [...command, "test/a.doctest.md", "test/b.test.ts"],
    );
  }
});

test("a real path after an option is still an explicit file list", () => {
  assert.deepEqual(
    tierCommand({
      command: ["tap", "--timeout", "300", "test/on-disk.test.ts"],
      tier: "ordinary",
      taprcFiles: TAPRC_FILES,
      careful: CAREFUL,
      isFile: (path) => path === "test/on-disk.test.ts",
    }),
    ["tap", "--timeout", "300", "test/on-disk.test.ts"],
  );
});

test("a command that is not tap is not rewritten", () => {
  const command = ["pnpm", "exec", "vitest"];
  assert.deepEqual(
    tierCommand({ command, tier: "ordinary", taprcFiles: TAPRC_FILES, careful: CAREFUL }),
    command,
  );
});

test("an empty tier refuses to become a bare `tap`", () => {
  // A bare `tap` falls back to .taprc's includes and runs EVERYTHING — the
  // exact fragility that made shell expansion the rejected design.
  assert.throws(
    () => tierCommand({ command: ["tap"], tier: "careful", taprcFiles: TAPRC_FILES, careful: [] }),
    TierListError,
  );
});

// ── the exclude wiring ──────────────────────────────────────────────────────

test("the selector drops careful files unless the branch changed one", () => {
  const box = "beebox/";
  const careful = carefulExclusions();
  const member = careful[0];
  assert.ok(member !== undefined);
  const graph: TestGraph = {
    tests: new Map([
      [member, new Set([`${box}src/shared.ts`])],
      [`${box}test/ordinary.doctest.md`, new Set([`${box}src/shared.ts`])],
    ]),
    universe: new Set([`${box}src/shared.ts`]),
    unresolved: new Set(),
    ambiguousEdges: 0,
    buildMs: 0,
    cached: false,
  };
  assert.deepEqual(
    selectTests({ graph, changed: [`${box}src/shared.ts`], exclude: careful }).selected,
    [`${box}test/ordinary.doctest.md`],
  );
  assert.deepEqual(selectTests({ graph, changed: [member], exclude: careful }).selected, [member]);
});

// ── the fan-out cap ──────────────────────────────────────────────────────────
// The semaphore counts runs; the scarce resource is cores. Two slots at
// .taprc's `jobs: 6` is twelve tap processes on twelve logical cores, which the
// ledger measures as 1.69x median / 3.05x p90 per-file inflation — and which
// left the dev router unable to answer a readiness probe on 2026-09-15.

test("capJobs: a full run joining a busy host halves its fan-out", () => {
  assert.deepEqual(
    capJobs({ args: ["a.test.ts"], mode: "full", concurrency: 1, cores: 12 }),
    ["a.test.ts", "-j3"],
  );
});

test("capJobs: a run that is alone keeps .taprc's default", () => {
  // 85% of recorded runs are solo. Slowing them to fix the other 15% is the
  // trade this conditional cap exists to avoid.
  assert.deepEqual(capJobs({ args: ["a.test.ts"], mode: "full", concurrency: 0, cores: 12 }), ["a.test.ts"]);
});

test("capJobs: a selected run is never capped", () => {
  // Selected runs are seconds long; the measured harm is concentrated in
  // full-run overlap (1.43x median for selected against 1.69x for full).
  assert.deepEqual(capJobs({ args: ["a.test.ts"], mode: "selected", concurrency: 1, cores: 12 }), ["a.test.ts"]);
});

test("capJobs: no slot means no cap, matching the ledger's fail-open posture", () => {
  // A lock directory that cannot be used is already not a reason to refuse to
  // test; it is not a reason to run slowly either.
  assert.deepEqual(capJobs({ args: ["a.test.ts"], mode: "full", concurrency: null, cores: 12 }), ["a.test.ts"]);
});

test("capJobs: an explicit -j always wins, including the careful tier's own -j1", () => {
  // tierCommand adds -j1 for the careful tier because "the flakes in this tier
  // are contention". Widening that to 3 here would undo it.
  assert.deepEqual(
    capJobs({ args: ["-j1", "a.test.ts"], mode: "full", concurrency: 1, cores: 12 }),
    ["-j1", "a.test.ts"],
  );
  assert.deepEqual(
    capJobs({ args: ["-j8", "a.test.ts"], mode: "full", concurrency: 1, cores: 12 }),
    ["-j8", "a.test.ts"],
  );
});

test("capJobs: two capped runs together land on .taprc's intended half", () => {
  // The whole point of the number: `jobs: 6` was chosen as "half the cores" for
  // ONE run. Two runs at cappedJobs(12) = 3 is six, which is that same half.
  assert.equal(cappedJobs(12) * 2, 6);
});

test("cappedJobs: never drops below one, however small the machine", () => {
  assert.equal(cappedJobs(1), 1);
  assert.equal(cappedJobs(2), 1);
  assert.equal(cappedJobs(4), 1);
  assert.equal(cappedJobs(8), 2);
  assert.equal(cappedJobs(32), 8);
});

test("hasExplicitJobs: every spelling tap documents, so none is silently overridden", () => {
  // `tap --help`: "-j<n> --jobs=<n>". A startsWith("-j") test alone misses the
  // long forms.
  for (const args of [["-j3"], ["-j", "3"], ["--jobs=3"], ["--jobs", "3"]]) {
    assert.equal(hasExplicitJobs(args), true, args.join(" "));
  }
  assert.equal(hasExplicitJobs(["test/a.test.ts", "--grep", "foo"]), false);
  // Not a jobs flag despite the prefix overlap.
  assert.equal(hasExplicitJobs(["--jobsomething"]), false);
});

test("capJobs: a long-form --jobs is respected rather than contradicted", () => {
  assert.deepEqual(
    capJobs({ args: ["--jobs=8", "a.test.ts"], mode: "full", concurrency: 1, cores: 12 }),
    ["--jobs=8", "a.test.ts"],
    "appending -j3 here would hand tap two conflicting job counts",
  );
});

test("tierCommand: a caller's explicit --jobs is not overridden by the careful tier's -j1", () => {
  assert.deepEqual(
    tierCommand({ command: ["tap", "--jobs=4"], tier: "careful", taprcFiles: TAPRC_FILES, careful: CAREFUL }),
    ["tap", "--jobs=4", "test/flaky.doctest.md"],
  );
});
