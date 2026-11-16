// `bin/finish-preflight --tested <rev>`: which sheet checks the changes since a
// tested revision reach. A node:test file for the reason
// bin/finish-preflight.test.ts gives.
//
//   node --import tsx --test bin/finish-preflight-delta.test.ts

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deltaSinceTested, formatSinceTested, resolveTested, sinceTested } from "./finish-preflight-delta.js";
import { TestedRevisionError } from "./finish-preflight-errors.js";
import { verificationCommands, type VerificationCommand } from "./finish-preflight-lib.js";

const PACKAGES = new Set(["beebox", "site"]);
const hasScript = (): boolean => true;
const NO_SKIP = { value: false, reason: "" };

/** A sheet as preflight builds it for a branch that touched beebox code, bin/, and docs. */
function sheet(selectorFailed: boolean): VerificationCommand[] {
  return verificationCommands({
    paths: ["beebox/src/core/box.ts", "bin/tool.ts", "beebox/docs/a.md", "ios-app/A.swift"],
    workspacePackages: PACKAGES,
    hasScript,
    skipTypecheckLint: NO_SKIP,
    selectorFailed,
  });
}

function delta(
  paths: string[],
  deltaTests: { count: number; failed: boolean; note?: string; causes?: string[] } | null,
) {
  return deltaSinceTested({
    paths,
    verification: sheet(false),
    workspacePackages: PACKAGES,
    hasScript,
    selectorFailed: false,
    deltaTests: deltaTests === null ? null : { note: "", causes: [], ...deltaTests },
  });
}

const reachedOf = (result: ReturnType<typeof delta>): string[] =>
  result.checks.filter((check) => check.reached).map((check) => check.command);

test("a markdown-only delta reaches the site build and nothing else", () => {
  const result = delta(["issues/bugs/x.md"], null);
  assert.deepEqual(reachedOf(result), ["pnpm --dir site build --base /"]);
  assert.deepEqual(result.groups, [
    {
      checks: ["pnpm --dir site build --base /"],
      shared: false,
      paths: ["issues/bugs/x.md"],
    },
  ]);
});

test("beebox source the selector finds no test for leaves beebox tests unreached, with the reason", () => {
  const result = delta(["beebox/src/core/box.ts"], { count: 0, failed: false });
  const tests = result.checks.find((check) => check.command === "pnpm --dir beebox test:changed");
  assert.deepEqual(tests, {
    command: "pnpm --dir beebox test:changed",
    reached: false,
    note: "no test imports these paths",
  });
  assert.deepEqual(reachedOf(result), ["pnpm --dir beebox typecheck", "bin/smoke", "pnpm lint:changed"]);
});

test("the selector reaches beebox tests even through a path the per-path map does not send there", () => {
  // A bin/ script a beebox test spawns: the selector's spawner edges see it.
  const result = delta(["bin/tool.ts", "bin/other.ts"], { count: 2, failed: false, causes: ["bin/tool.ts"] });
  assert.ok(reachedOf(result).includes("pnpm --dir beebox test:changed"));
  assert.deepEqual(
    result.groups.map((group) => [group.paths, group.checks]),
    [
      [["bin/tool.ts"], ["pnpm --dir beebox test:changed", "pnpm test", "pnpm typecheck"]],
      [["bin/other.ts"], ["pnpm test", "pnpm typecheck"]],
    ],
  );
});

test("tests selected through no single path still reach beebox tests, and say so", () => {
  // Tests the graph cannot resolve run on every change and name no path.
  const result = delta(["beebox/src/core/box.ts"], { count: 3, failed: false, causes: [] });
  assert.deepEqual(result.checks[0], {
    command: "pnpm --dir beebox test:changed",
    reached: true,
    note: "3 tests selected, none through a single path",
  });
});

test("a change to a check's own runner reaches that check", () => {
  for (const path of ["bin/smoke", "bin/smoke-lib.ts"]) {
    assert.ok(reachedOf(delta([path], null)).includes("bin/smoke"), path);
  }
  assert.ok(!reachedOf(delta(["bin/smokestack.ts"], null)).includes("bin/smoke"));
});

test("a failed delta selection counts beebox tests as reached", () => {
  const result = delta(["beebox/src/core/box.ts"], {
    count: 0,
    failed: true,
    note: "selector failed (boom) — run pnpm test",
  });
  assert.deepEqual(result.checks[0], {
    command: "pnpm --dir beebox test:changed",
    reached: true,
    note: "selector failed (boom) — run pnpm test",
  });
});

test("a shared input reaches every check, beebox tests included", () => {
  for (const path of ["pnpm-lock.yaml", "eslint.config.mjs", "patches/x.patch", "newdir/thing.ts"]) {
    const result = delta([path], { count: 0, failed: false });
    assert.deepEqual(
      result.checks.filter((check) => !check.reached),
      [],
      path,
    );
    assert.equal(result.groups[0]?.shared, true, path);
  }
});

test("Apple matches by kind, since its command names the sheet's paths", () => {
  const result = delta(["ios-app/B.swift"], null);
  assert.deepEqual(reachedOf(result), ["bin/apple-test --changed ios-app/A.swift"]);
});

test("a sheet whose selector failed names beebox's full suite, and the delta still matches it", () => {
  const result = deltaSinceTested({
    paths: ["beebox/test/x.test.ts"],
    verification: sheet(true),
    workspacePackages: PACKAGES,
    hasScript,
    selectorFailed: true,
    deltaTests: { count: 1, failed: false, note: "", causes: ["beebox/test/x.test.ts"] },
  });
  assert.ok(reachedOf(result).includes("pnpm --dir beebox test"));
});

test("skipped sheet checks are left out, and every path is printed once", () => {
  const docsSheet = verificationCommands({
    paths: ["beebox/docs/a.md"],
    workspacePackages: PACKAGES,
    hasScript,
    skipTypecheckLint: NO_SKIP,
  });
  const paths = ["beebox/docs/a.md", "beebox/docs/b.md", "notes/c.txt"];
  const result = deltaSinceTested({
    paths,
    verification: docsSheet,
    workspacePackages: PACKAGES,
    hasScript,
    selectorFailed: false,
    deltaTests: null,
  });
  assert.deepEqual(result.checks, [{ command: "pnpm --dir site build --base /", reached: true }]);
  const text = formatSinceTested({
    rev: "abc",
    sha: "a".repeat(40),
    paths,
    ...result,
    selectedTests: null,
  });
  for (const path of paths) assert.equal(text.filter((line) => line.trim() === path).length, 1, path);
  assert.ok(text.includes("  reaches no listed check:"));
});

function repo(): {
  dir: string;
  git: (...args: string[]) => string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "finish-preflight-delta-"));
  const git = (...args: string[]): string =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "core.hooksPath", "/dev/null");
  const commit = (path: string): void => {
    writeFileSync(join(dir, path), `${path}\n`);
    git("add", "-A");
    git("commit", "-q", "-m", path);
  };
  commit("a.txt");
  git("checkout", "-q", "-b", "side");
  commit("side.txt");
  git("checkout", "-q", "main");
  commit("b.txt");
  return {
    dir,
    git,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const input = (root: string, rev: string) => ({
  root,
  rev,
  sha: resolveTested(root, rev),
  packages: new Set<string>(),
  hasScript,
  verification: [],
  selectorFailed: false,
});

test("the delta lists committed and uncommitted paths since an ancestor", () => {
  const fx = repo();
  try {
    writeFileSync(join(fx.dir, "dirty.txt"), "x\n");
    const result = sinceTested(input(fx.dir, "HEAD~1"));
    assert.deepEqual(result.paths, ["b.txt", "dirty.txt"]);
    assert.equal(result.sha, fx.git("rev-parse", "HEAD~1"));
  } finally {
    fx.cleanup();
  }
});

test("a tested revision that is not a commit, or not in HEAD, is refused", () => {
  const fx = repo();
  try {
    const refused = (fn: () => unknown, pattern: RegExp): void => {
      assert.throws(
        fn,
        (e: unknown) => e instanceof TestedRevisionError && e.exitCode === 2 && pattern.test(e.message),
      );
    };
    refused(() => resolveTested(fx.dir, "no-such-ref"), /not a commit/);
    // Three-dot from `side` would diff from the merge base and hide b.txt.
    refused(() => sinceTested(input(fx.dir, "side")), /not an ancestor of HEAD/);
  } finally {
    fx.cleanup();
  }
});
