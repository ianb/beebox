// Tests for finish-verify's output and verdict logic on synthetic results —
// no commands are spawned.
//
// A `.test.ts` rather than a doctest, for bin/test-select.test.ts's reason: the
// thing under test runs the suites, so testing it from inside one is circular.
//
//   node --import tsx --test bin/finish-verify.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import type { VerificationCommand } from "./finish-preflight-lib.js";
import { formatResult, parseFailingFiles, verdict, type CommandResult } from "./finish-verify.js";

const TESTS: VerificationCommand = {
  kind: "tests",
  command: "pnpm --dir callback-box test:changed",
  cwd: ".",
  argv: ["pnpm", "--dir", "callback-box", "test:changed"],
  isolate: { cwd: "callback-box", argv: ["tap"] },
};
const LINT: VerificationCommand = {
  kind: "lint",
  command: "pnpm lint",
  cwd: ".",
  argv: ["pnpm", "lint"],
};

function result(input: Partial<CommandResult>): CommandResult {
  return {
    command: TESTS,
    ok: false,
    seconds: 1,
    outputPath: "/tmp/out.log",
    files: [],
    unattributed: false,
    ...input,
  };
}

test("failing files come from TAP lines, and only when the name is a real file", () => {
  const output = [
    "not ok 1 - test/core/box.doctest.md # time=812ms",
    "not ok 2 - a test whose name has spaces",
    "    not ok 3 - test/hub/hub-e2e.doctest.md",
    "not ok 4 - test/core/box.doctest.md",
    "ok 5 - test/lib/fine.doctest.md",
  ].join("\n");
  const real = new Set(["test/core/box.doctest.md", "test/hub/hub-e2e.doctest.md"]);
  assert.deepEqual(parseFailingFiles(output, (p) => real.has(p)), [
    "test/core/box.doctest.md",
    "test/hub/hub-e2e.doctest.md",
  ]);
});

test("a green run prints one line and no verdict noise", () => {
  const green = result({ ok: true, seconds: 12.34 });
  assert.deepEqual(formatResult(green), ["ok   pnpm --dir callback-box test:changed (12.3s)"]);
  assert.deepEqual(verdict([green]), { green: true, flakes: [] });
});

test("a flake-only failure is green, and named", () => {
  const flaked = result({ files: [{ file: "test/lib/git-lock.doctest.md", outcome: "flake" }] });
  assert.deepEqual(verdict([flaked]), {
    green: true,
    flakes: ["test/lib/git-lock.doctest.md"],
  });
  assert.deepEqual(formatResult(flaked), [
    "FAIL pnpm --dir callback-box test:changed (1.0s) → /tmp/out.log",
    "     flake test/lib/git-lock.doctest.md",
  ]);
});

test("one real failure among flakes is red", () => {
  const mixed = result({
    files: [
      { file: "a.doctest.md", outcome: "flake" },
      { file: "b.doctest.md", outcome: "real", outputPath: "/tmp/b.log" },
    ],
  });
  assert.deepEqual(verdict([mixed]), { green: false, flakes: ["a.doctest.md"] });
  assert.ok(formatResult(mixed).includes("     real  b.doctest.md → /tmp/b.log"));
});

test("a red test run whose failing files could not be identified is red", () => {
  const opaque = result({ unattributed: true });
  assert.equal(verdict([opaque]).green, false);
  assert.ok(formatResult(opaque).some((line) => line.includes("treated as real")));
});

test("a failing typecheck or lint is red with no isolation attempted", () => {
  assert.equal(verdict([result({ command: LINT })]).green, false);
  assert.deepEqual(formatResult(result({ command: LINT, seconds: 4 })), [
    "FAIL pnpm lint (4.0s) → /tmp/out.log",
  ]);
});
