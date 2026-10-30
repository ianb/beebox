// Tests for the /finish decision sheet's rules — the classification, the
// verification map, the typecheck/lint skip, and trailer parsing.
//
// A node:test file rather than the t.check test bin/AGENTS.md asks for, for the same
// reason bin/test-select.test.ts is one: the thing under test decides which
// tests a landing runs, so exercising it from inside that suite is circular.
//
//   node --import tsx --test bin/finish-preflight.test.ts
// (or `pnpm test` at the repo root, which runs every bin/*.test.ts this way).

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  groupPaths,
  touchesSiteInput,
  hasCodeChange,
  isDocsOnly,
  parseTrailers,
  skipTypecheckLintDecision,
  type SkipInput,
  trackORecommendation,
  verificationCommands,
} from "./finish-preflight-lib.js";
import { formatSheet, type Sheet } from "./finish-preflight.js";

const PACKAGES = new Set([
  "beebox",
  "beebox/pub-worker",
  "site",
  "tap-check",
  "canvas-loop",
  "workstreams-app",
]);
const NO_SKIP = { value: false, reason: "the merge of main brought code in" };

/** Every package in these tests has the full script trio unless stated. */
const allScripts = (): ((pkg: string, script: string) => boolean) => () => true;

test("docsOnly is an iff over every path", () => {
  assert.equal(isDocsOnly(["beebox/docs/testing.md", "docs/x.md"]), true);
  assert.equal(isDocsOnly(["beebox/docs/a.md", "beebox/src/x.ts"]), false);
  // Any .md counts, wherever it lives; doc assets under docs/ too.
  assert.equal(isDocsOnly(["AGENTS.md"]), true);
  assert.equal(isDocsOnly(["issues/features/x.md", "README.md", "beebox/docs/architecture/images/a.png"]), true);
  assert.equal(isDocsOnly(["site/docs-manifest.yaml"]), false);
  assert.equal(isDocsOnly([]), false);
});

test("codeChanged ignores docs and tests", () => {
  assert.equal(hasCodeChange(["beebox/docs/a.md", "bin/x.test.ts"]), false);
  assert.equal(hasCodeChange(["beebox/test/core/box.test.ts"]), false);
  assert.equal(hasCodeChange(["beebox/src/core/box.ts"]), true);
  assert.equal(hasCodeChange(["issues/bugs/x.md", "bin/doctor.ts"]), true);
});

test("paths group by package, with bin/ and root files on the root scripts", () => {
  const grouped = groupPaths(
    [
      "beebox/src/x.ts",
      "bin/doctor.ts",
      "package.json",
      "issues/bugs/x.md",
      "site/src/y.ts",
      "weird-new-dir/z.ts",
    ],
    PACKAGES,
  );
  assert.deepEqual(grouped.packages, ["beebox", "site"]);
  assert.equal(grouped.root, true);
  assert.deepEqual(grouped.unknown, ["weird-new-dir"]);
  assert.deepEqual(grouped.groups["(none)"], ["issues/bugs/x.md"]);
  assert.deepEqual(grouped.groups["(root)"], ["bin/doctor.ts", "package.json"]);
});

test("a nested package owns its own paths, and its parent still owns the rest", () => {
  const grouped = groupPaths(
    ["beebox/pub-worker/src/x.ts", "beebox/src/x.ts"],
    PACKAGES,
  );
  assert.deepEqual(grouped.packages, ["beebox", "beebox/pub-worker"]);
  const commands = verificationCommands({
    paths: ["beebox/pub-worker/src/x.ts"],
    workspacePackages: PACKAGES,
    hasScript: allScripts(),
    skipTypecheckLint: NO_SKIP,
  });
  assert.deepEqual(
    commands.map((command) => command.command),
    [
      "pnpm --dir beebox/pub-worker test",
      "pnpm --dir beebox/pub-worker typecheck",
      "bin/smoke",
      "pnpm lint:changed",
    ],
  );
});

test("beebox runs the selected set, not the whole suite", () => {
  const commands = verificationCommands({
    paths: ["beebox/src/core/box.ts"],
    workspacePackages: PACKAGES,
    hasScript: allScripts(),
    skipTypecheckLint: NO_SKIP,
  });
  assert.deepEqual(
    commands.map((c) => c.command),
    [
      "pnpm --dir beebox test:changed",
      "pnpm --dir beebox typecheck",
      "bin/smoke",
      "pnpm lint:changed",
    ],
  );
  assert.ok(commands[0]?.isolate?.argv.includes("../bin/test-ledger.ts"));
});

test("a failed selector sends beebox to the full suite", () => {
  // An internal selector error (graph, esbuild) is not a test result. The sheet
  // already noted "run pnpm test"; the verification list has to agree, or
  // finish-verify runs `test:changed` straight back into the same error.
  const commands = verificationCommands({
    paths: ["beebox/src/core/box.ts"],
    workspacePackages: PACKAGES,
    hasScript: allScripts(),
    skipTypecheckLint: NO_SKIP,
    selectorFailed: true,
  });
  assert.deepEqual(commands[0]?.command, "pnpm --dir beebox test");
  assert.deepEqual(commands[0]?.argv, ["pnpm", "--dir", "beebox", "test"]);
  // Still isolatable: a flake in the full suite is a flake.
  assert.equal(commands[0]?.isolate?.packageDir, "beebox");
});

test("the beebox isolate resolves TAP paths against the package, not its cwd", () => {
  const commands = verificationCommands({
    paths: ["beebox/src/core/box.ts"],
    workspacePackages: PACKAGES,
    hasScript: allScripts(),
    skipTypecheckLint: NO_SKIP,
  });
  // `pnpm --dir beebox` is spawned from the repo root while tap prints
  // `test/...` relative to beebox/.
  assert.equal(commands[0]?.isolate?.cwd, ".");
  assert.equal(commands[0]?.isolate?.packageDir, "beebox");
});

test("a bin/ change runs the root suite and typecheck, and lints nothing", () => {
  const commands = verificationCommands({
    paths: ["bin/doctor.ts"],
    workspacePackages: PACKAGES,
    hasScript: allScripts(),
    skipTypecheckLint: NO_SKIP,
  });
  assert.deepEqual(
    commands.map((c) => c.command),
    ["pnpm test", "pnpm typecheck"],
  );
});

test("lint is one root fan-out entry however many packages changed", () => {
  const commands = verificationCommands({
    paths: ["beebox/src/x.ts", "site/src/y.ts"],
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

// `bin/schedules lint` is the only check over schedules/*.ts, and no package's
// lint reaches it. Root `pnpm lint:changed` is what runs it.
// See issues/closed/code-quality/2026-08-25-lint-runs-contend-like-tests.md.
test("a schedules-only change still gets a lint entry", () => {
  const commands = verificationCommands({
    paths: ["schedules/full-suite/run.ts"],
    workspacePackages: PACKAGES,
    hasScript: allScripts(),
    skipTypecheckLint: NO_SKIP,
  });
  assert.deepEqual(
    commands.map((c) => c.command),
    ["pnpm test", "pnpm typecheck", "pnpm lint:changed"],
  );
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
    paths: ["beebox/docs/testing.md"],
    workspacePackages: PACKAGES,
    hasScript: allScripts(),
    skipTypecheckLint: NO_SKIP,
  });
  assert.ok(commands.length > 0);
  // Every command is named and skipped, except the site build: docs are its input.
  assert.ok(commands.filter((c) => c.kind !== "site").every((c) => c.skip === "docs-only diff"));
  assert.equal(commands.find((c) => c.kind === "site")?.skip, undefined);
});

type Merge = SkipInput["merges"][number];
const merged = (sha: string, paths: string[]): Merge => ({ sha, paths, edited: [] });

test("skipTypecheckLint keys on what pre-commit never saw", () => {
  // The branch has code of its own, so every merge's code meets it.
  const skip = (merges: Merge[], stragglers: string[]): boolean =>
    skipTypecheckLintDecision({ merges, stragglers, ownCommits: ["beebox/src/mine.ts"], vsMain: ["beebox/src/mine.ts"] }).value;
  assert.equal(skip([], []), true);
  assert.equal(skip([merged("a", ["issues/bugs/x.md", "beebox/docs/a.md"])], []), true);
  assert.equal(skip([merged("a", ["beebox/src/x.ts"])], []), false);
  // Tests are typechecked, so a merge that brought only a test still counts.
  assert.equal(skip([merged("a", ["beebox/src/x.test.ts"])], []), false);
  // An older merge's code is still unchecked when the newest merge brought only docs.
  assert.equal(skip([merged("new", ["beebox/docs/a.md"]), merged("old", ["beebox/src/x.ts"])], []), false);
  // An uncommitted file ran no pre-commit at all, whatever the merges did.
  assert.equal(skip([], ["a.ts"]), false);
  assert.equal(skipTypecheckLintDecision({ merges: [], stragglers: ["a.ts"], ownCommits: [], vsMain: [] }).value, false);
});

test("skipTypecheckLint skips a merge of code into a branch that changed only docs", () => {
  const decide = (input: { ownCommits?: string[]; edited?: string[]; vsMain?: string[] }) =>
    skipTypecheckLintDecision({
      merges: [{ sha: "abcdef0123", paths: ["beebox/src/x.ts"], edited: input.edited ?? ["notes/a.md"] }],
      stragglers: [],
      ownCommits: input.ownCommits ?? ["notes/a.md"],
      vsMain: input.vsMain ?? ["notes/a.md"],
    });
  const docsOnly = decide({});
  assert.equal(docsOnly.value, true);
  assert.match(docsOnly.reason, /^merge abcdef012 brought code, but the branch changed only \.md files/);
  // Any non-.md path in any of the three forces the checks. A branch commit
  // counts even when a later commit reverted it (HEAD equals main); a merge
  // that resolved a conflict in code counts even when HEAD's tree matches main.
  const cases: [Parameters<typeof decide>[0], string][] = [
    [{ ownCommits: ["notes/a.md", "beebox/src/reverted.ts"] }, "a branch commit touched code (beebox/src/reverted.ts)"],
    [{ ownCommits: ["beebox/docs/example.ts"] }, "a branch commit touched code (beebox/docs/example.ts)"],
    [{ edited: ["beebox/src/x.ts"] }, "merge abcdef012 edited code (beebox/src/x.ts)"],
    [{ vsMain: ["beebox/src/x.test.ts", "bin/y.ts"] }, "HEAD differs from main in code (beebox/src/x.test.ts +1)"],
  ];
  for (const [input, why] of cases) {
    const decision = decide(input);
    assert.equal(decision.value, false, why);
    assert.ok(decision.reason.includes(why), decision.reason);
  }
});

test("the skipped typecheck/lint commands are still listed, with the reason", () => {
  const commands = verificationCommands({
    paths: ["beebox/src/x.ts"],
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

// ── the smoke tier ──────────────────────────────────────────────────────────

test("a code-related diff gets a smoke walk; a diff that ships nothing does not", () => {
  const smokeFor = (paths: string[]): boolean =>
    verificationCommands({
      paths,
      workspacePackages: PACKAGES,
      hasScript: allScripts(),
      skipTypecheckLint: NO_SKIP,
    }).some((command) => command.kind === "smoke");

  assert.equal(smokeFor(["beebox/src/core/box.ts"]), true);
  assert.equal(smokeFor(["pnpm-lock.yaml"]), true);
  // bin/ and issues/ change nothing a running box would show, and neither
  // ships — the deploy hook's rule and this one are deliberately identical.
  assert.equal(smokeFor(["bin/doctor.ts"]), false);
  assert.equal(smokeFor(["issues/bugs/x.md"]), false);
});

test("a docs-only diff names the smoke walk as skipped rather than dropping it", () => {
  // Same reason the other commands are listed-and-skipped: a sheet that simply
  // omits a step reads as "this diff never needed one".
  const commands = verificationCommands({
    paths: ["beebox/docs/box/publishing.md"],
    workspacePackages: PACKAGES,
    hasScript: allScripts(),
    skipTypecheckLint: NO_SKIP,
  });
  const smoke = commands.find((command) => command.kind === "smoke");
  assert.equal(smoke?.command, "bin/smoke");
  assert.equal(smoke?.skip, "docs-only diff");
});

test("the canonical site build runs for site/ or any markdown change, and is never skipped as docs-only", () => {
  assert.equal(touchesSiteInput(["site/docs/01-what-bee-box-is.md"]), true);
  assert.equal(touchesSiteInput(["beebox/AGENTS.md"]), true);
  assert.equal(touchesSiteInput(["beebox/src/core/box.ts"]), false);
  const commands = verificationCommands({
    paths: ["issues/features/x.md", "beebox/docs/glossary.md"],
    workspacePackages: PACKAGES,
    hasScript: allScripts(),
    skipTypecheckLint: NO_SKIP,
  });
  const site = commands.find((c) => c.kind === "site");
  assert.equal(site?.command, "pnpm --dir site build --base /");
  assert.equal(site?.skip, undefined);
  const code = verificationCommands({
    paths: ["beebox/src/core/box.ts"],
    workspacePackages: PACKAGES,
    hasScript: allScripts(),
    skipTypecheckLint: NO_SKIP,
  });
  assert.equal(code.some((c) => c.kind === "site"), false);
});

test("the text sheet puts the decision fields first and shortens the test list", () => {
  const files = Array.from({ length: 40 }, (_, i) => `test/t${String(i)}.test.ts`);
  const sheet: Sheet = {
    worktree: "demo",
    branch: "worktree-demo",
    repoRoot: "/repo",
    privateLeg: { active: false, state: "no-repo", repo: null },
    stragglers: [],
    merge: { status: "merged", broughtPaths: ["beebox/src/x.ts"], resolved: [] },
    changed: { all: ["beebox/src/y.ts"], byGroup: { beebox: ["beebox/src/y.ts"] }, unknownGroups: [] },
    docsOnly: false,
    codeChanged: true,
    selectedTests: {
      files,
      reasons: [
        { reason: "imports beebox/src/y.ts", count: 38 },
        { reason: "the test itself changed", count: 2 },
      ],
      note: "40 selected",
    },
    verification: [{ kind: "tests", command: "pnpm --dir beebox test:changed", cwd: ".", argv: [] }],
    skipTypecheckLint: { value: false, reason: "merge abc brought code in", rule: "" },
    plan: { attached: false, docs: [], trailers: [] },
    issues: [],
    diff: { lines: 10, sourceLines: 10 },
    trackO: { recommended: false, reason: "small" },
  };
  const lines = formatSheet(sheet).split("\n");
  const at = (prefix: string): number => lines.findIndex((line) => line.startsWith(prefix));
  assert.deepEqual([at("merge main:"), at("verification:"), at("skipTypecheckLint:")], [1, 2, 4]);
  assert.ok(at("selected tests: 40 selected") > at("skipTypecheckLint:"));
  assert.deepEqual(lines.slice(at("selected tests:") + 1), [
    "  by reason: 38 imports beebox/src/y.ts; 2 the test itself changed",
    "  test/t0.test.ts",
    "  test/t1.test.ts",
    "  test/t2.test.ts",
    "  test/t3.test.ts",
    "  test/t4.test.ts",
    "  … 35 more (--json lists all; bin/test-select.ts --why groups them)",
  ]);
});

