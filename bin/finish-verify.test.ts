// Tests for finish-verify's output and verdict logic on synthetic results —
// no commands are spawned.
//
// A `.test.ts` rather than a doctest, for bin/test-select.test.ts's reason: the
// thing under test runs the suites, so testing it from inside one is circular.
//
//   node --import tsx --test bin/finish-verify.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VerificationCommand } from "./finish-preflight-lib.js";
import {
  existsRelative,
  formatResult,
  parseFailingFiles,
  verdict,
  type CommandResult,
} from "./finish-verify.js";

const TESTS: VerificationCommand = {
  kind: "tests",
  command: "pnpm --dir beebox test:changed",
  cwd: ".",
  argv: ["pnpm", "--dir", "beebox", "test:changed"],
  isolate: { cwd: ".", packageDir: "beebox", argv: ["tap"] },
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

test("failing files also come from the spec reporter's `test at` headers", () => {
  // What `node --test bin/*.test.ts schedules/*/*.test.ts` actually prints when
  // piped — spec, not TAP (Node 24). The stack frames carry the same path in
  // `at … (file:///…)` form and must not be read as a second candidate, and the
  // `✖ <name>` line under each header is a test name, not a file.
  const output = [
    "\u2716 failing tests:",
    "",
    "test at bin/schedules-hardening.test.ts:3:1824",
    "\u2716 a timeout kills the whole process group, not just the run script (1824.5ms)",
    "  AssertionError [ERR_ASSERTION]: 1 == 2",
    "      at TestContext.<anonymous> (file:///repo/bin/schedules-hardening.test.ts:3:36)",
    "",
    "test at schedules/full-suite/ledger.test.ts:12:1",
    "\u2716 a tracked flake is not reported twice (2.1ms)",
  ].join("\n");
  const real = new Set(["bin/schedules-hardening.test.ts", "schedules/full-suite/ledger.test.ts"]);
  assert.deepEqual(parseFailingFiles(output, (p) => real.has(p)), [
    "bin/schedules-hardening.test.ts",
    "schedules/full-suite/ledger.test.ts",
  ]);
});

test("a spec run whose only failing test is unidentifiable stays unattributed", () => {
  // The existence check is what keeps a test NAME out of the list, in spec
  // output as much as in TAP. Nothing on disk, nothing claimed.
  const output = ["\u2716 failing tests:", "", "test at gone/removed.test.ts:1:1", "\u2716 whatever"].join("\n");
  assert.deepEqual(parseFailingFiles(output, () => false), []);
});

test("a green run prints one line and no verdict noise", () => {
  const green = result({ ok: true, seconds: 12.34 });
  assert.deepEqual(formatResult(green), ["ok   pnpm --dir beebox test:changed (12.3s)"]);
  assert.deepEqual(verdict([green]), { green: true, flakes: [] });
});

test("a flake-only failure is green, and named", () => {
  const flaked = result({ files: [{ file: "test/lib/git-lock.doctest.md", outcome: "flake" }] });
  assert.deepEqual(verdict([flaked]), {
    green: true,
    flakes: ["test/lib/git-lock.doctest.md"],
  });
  assert.deepEqual(formatResult(flaked), [
    "FAIL pnpm --dir beebox test:changed (1.0s) → /tmp/out.log",
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

test("a beebox TAP path resolves against the package, not the command's cwd", () => {
  // The shape that matters: `pnpm --dir beebox test:changed` runs from
  // the repo root and tap prints `test/...` relative to beebox/. Checked
  // against the cwd, no failing file is ever identified — and finish-verify
  // reports every one of them `real`, blocking on a known flake.
  const root = mkdtempSync(join(tmpdir(), "finish-verify-"));
  try {
    mkdirSync(join(root, "beebox/test/core"), { recursive: true });
    writeFileSync(join(root, "beebox/test/core/box.doctest.md"), "");
    const path = "test/core/box.doctest.md";
    assert.equal(existsRelative({ packageDir: join(root, "beebox"), path, root }), true);
    assert.equal(existsRelative({ packageDir: root, path, root }), false);
    const output = `not ok 1 - ${path} # time=812ms`;
    assert.deepEqual(
      parseFailingFiles(output, (p) =>
        existsRelative({ packageDir: join(root, "beebox"), path: p, root }),
      ),
      [path],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
