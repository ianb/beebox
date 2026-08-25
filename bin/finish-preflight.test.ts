// Tests for the /finish decision sheet's rules — the classification, the
// verification map, the typecheck/lint skip, and trailer parsing.
//
// A `.test.ts` rather than the doctest bin/CLAUDE.md asks for, for the same
// reason bin/test-select.test.ts is one: the thing under test decides which
// tests a landing runs, so exercising it from inside that suite is circular.
//
//   node --import tsx --test bin/finish-preflight.test.ts
// (or `pnpm test` at the repo root, which runs every bin/*.test.ts this way).

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  groupPaths,
  hasCodeChange,
  isDocsOnly,
  parseTrailers,
  skipTypecheckLintDecision,
  trackORecommendation,
  verificationCommands,
} from "./finish-preflight-lib.js";

const PACKAGES = new Set(["callback-box", "site", "agent-doctest", "canvas-loop"]);
const NO_SKIP = { value: false, reason: "the merge of main brought code in" };

/** Every package in these tests has the full script trio unless stated. */
const allScripts = (): ((pkg: string, script: string) => boolean) => () => true;

test("docsOnly is an iff over every path, and a .doctest.md is not a doc", () => {
  assert.equal(isDocsOnly(["callback-box/docs/testing.md", "docs/x.md"]), true);
  assert.equal(isDocsOnly(["callback-box/docs/a.md", "callback-box/src/x.ts"]), false);
  assert.equal(isDocsOnly(["callback-box/docs/a.doctest.md"]), false);
  // A stray root .md is not under a docs/ directory.
  assert.equal(isDocsOnly(["CLAUDE.md"]), false);
  assert.equal(isDocsOnly([]), false);
});

test("codeChanged ignores docs and tests, and a .doctest.md is a test", () => {
  assert.equal(hasCodeChange(["callback-box/docs/a.md", "bin/x.test.ts"]), false);
  assert.equal(hasCodeChange(["callback-box/test/core/box.doctest.md"]), false);
  assert.equal(hasCodeChange(["callback-box/src/core/box.ts"]), true);
  assert.equal(hasCodeChange(["issues/bugs/x.md", "bin/router.ts"]), true);
});

test("paths group by package, with bin/ and root files on the root scripts", () => {
  const grouped = groupPaths(
    [
      "callback-box/src/x.ts",
      "bin/router.ts",
      "package.json",
      "issues/bugs/x.md",
      "site/src/y.ts",
      "weird-new-dir/z.ts",
    ],
    PACKAGES,
  );
  assert.deepEqual(grouped.packages, ["callback-box", "site"]);
  assert.equal(grouped.root, true);
  assert.deepEqual(grouped.unknown, ["weird-new-dir"]);
  assert.deepEqual(grouped.groups["(none)"], ["issues/bugs/x.md"]);
  assert.deepEqual(grouped.groups["(root)"], ["bin/router.ts", "package.json"]);
});

test("callback-box runs the selected set, not the whole suite", () => {
  const commands = verificationCommands({
    paths: ["callback-box/src/core/box.ts"],
    workspacePackages: PACKAGES,
    hasScript: allScripts(),
    skipTypecheckLint: NO_SKIP,
  });
  assert.deepEqual(
    commands.map((c) => c.command),
    ["pnpm --dir callback-box test:changed", "pnpm --dir callback-box typecheck", "pnpm --dir callback-box lint:changed"],
  );
  assert.ok(commands[0]?.isolate?.argv.includes("../bin/test-ledger.ts"));
});

test("a failed selector sends callback-box to the full suite", () => {
  // An internal selector error (graph, esbuild) is not a test result. The sheet
  // already noted "run pnpm test"; the verification list has to agree, or
  // finish-verify runs `test:changed` straight back into the same error.
  const commands = verificationCommands({
    paths: ["callback-box/src/core/box.ts"],
    workspacePackages: PACKAGES,
    hasScript: allScripts(),
    skipTypecheckLint: NO_SKIP,
    selectorFailed: true,
  });
  assert.deepEqual(commands[0]?.command, "pnpm --dir callback-box test");
  assert.deepEqual(commands[0]?.argv, ["pnpm", "--dir", "callback-box", "test"]);
  // Still isolatable: a flake in the full suite is a flake.
  assert.equal(commands[0]?.isolate?.packageDir, "callback-box");
});

test("the callback-box isolate resolves TAP paths against the package, not its cwd", () => {
  const commands = verificationCommands({
    paths: ["callback-box/src/core/box.ts"],
    workspacePackages: PACKAGES,
    hasScript: allScripts(),
    skipTypecheckLint: NO_SKIP,
  });
  // `pnpm --dir callback-box` is spawned from the repo root while tap prints
  // `test/...` relative to callback-box/.
  assert.equal(commands[0]?.isolate?.cwd, ".");
  assert.equal(commands[0]?.isolate?.packageDir, "callback-box");
});

test("a bin/ change runs the root suite and typecheck, and lints nothing", () => {
  const commands = verificationCommands({
    paths: ["bin/router.ts"],
    workspacePackages: PACKAGES,
    hasScript: allScripts(),
    skipTypecheckLint: NO_SKIP,
  });
  assert.deepEqual(
    commands.map((c) => c.command),
    ["pnpm test", "pnpm typecheck"],
  );
});

test("two changed packages coalesce onto the one workspace lint gate", () => {
  const commands = verificationCommands({
    paths: ["callback-box/src/x.ts", "site/src/y.ts"],
    workspacePackages: PACKAGES,
    hasScript: allScripts(),
    skipTypecheckLint: NO_SKIP,
  });
  const lint = commands.filter((c) => c.kind === "lint");
  assert.deepEqual(
    lint.map((c) => c.command),
    ["pnpm lint:changed"],
  );
  // Tests and typechecks never coalesce.
  assert.equal(commands.filter((c) => c.kind === "typecheck").length, 2);
});

test("a package without a script contributes no command for it", () => {
  const commands = verificationCommands({
    paths: ["canvas-loop/src/x.ts"],
    workspacePackages: PACKAGES,
    hasScript: (_pkg, script) => script !== "test",
    skipTypecheckLint: NO_SKIP,
  });
  assert.deepEqual(
    commands.map((c) => c.kind),
    ["typecheck", "lint"],
  );
});

test("a docs-only diff names every command as skipped rather than hiding it", () => {
  const commands = verificationCommands({
    paths: ["callback-box/docs/testing.md"],
    workspacePackages: PACKAGES,
    hasScript: allScripts(),
    skipTypecheckLint: NO_SKIP,
  });
  assert.ok(commands.length > 0);
  assert.ok(commands.every((c) => c.skip === "docs-only diff"));
});

test("skipTypecheckLint keys on what pre-commit never saw", () => {
  assert.deepEqual(
    skipTypecheckLintDecision({ mergeNoOp: true, mergeBroughtPaths: [], stragglers: [] }).value,
    true,
  );
  assert.equal(
    skipTypecheckLintDecision({
      mergeNoOp: false,
      mergeBroughtPaths: ["issues/bugs/x.md", "callback-box/docs/a.md"],
      stragglers: [],
    }).value,
    true,
  );
  assert.equal(
    skipTypecheckLintDecision({
      mergeNoOp: false,
      mergeBroughtPaths: ["callback-box/src/x.ts"],
      stragglers: [],
    }).value,
    false,
  );
  // An uncommitted file ran no pre-commit at all, whatever the merge did.
  assert.equal(
    skipTypecheckLintDecision({ mergeNoOp: true, mergeBroughtPaths: [], stragglers: ["a.ts"] })
      .value,
    false,
  );
});

test("the skipped typecheck/lint commands are still listed, with the reason", () => {
  const commands = verificationCommands({
    paths: ["callback-box/src/x.ts"],
    workspacePackages: PACKAGES,
    hasScript: allScripts(),
    skipTypecheckLint: { value: true, reason: "merge of main was a no-op" },
  });
  assert.equal(commands.find((c) => c.kind === "tests")?.skip, undefined);
  assert.equal(commands.find((c) => c.kind === "lint")?.skip, "merge of main was a no-op");
});

test("Track O is skipped on a small or code-free diff", () => {
  assert.equal(trackORecommendation({ codeChanged: false, sourceLines: 900 }).recommended, false);
  assert.equal(trackORecommendation({ codeChanged: true, sourceLines: 29 }).recommended, false);
  assert.equal(trackORecommendation({ codeChanged: true, sourceLines: 30 }).recommended, true);
});

test("trailers are read off whole commit messages, deduped and sorted", () => {
  const trailers = parseTrailers([
    "fix: a thing\n\nIssue: 2026-08-08-run-less-of-the-test-suite\nWorkstream: test-economics\n",
    "feat: another\n\nPlan: change-based-test-selection\nIssue: 2026-08-08-run-less-of-the-test-suite\n",
    // Not a trailer: an issue mentioned mid-prose.
    "chore: mention Issue: not-a-trailer inline\n",
  ]);
  assert.deepEqual(trailers.issues, ["2026-08-08-run-less-of-the-test-suite"]);
  assert.deepEqual(trailers.plans, ["change-based-test-selection"]);
});
