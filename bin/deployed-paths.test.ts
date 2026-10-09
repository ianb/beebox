import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEPLOYED_PATHS_PATTERN,
  NOT_SHIPPED_PATTERN,
  isDeployedPath,
  touchesDeployedPath,
} from "./deployed-paths.js";

const REPO_ROOT = join(import.meta.dirname, "..");

/**
 * The hook's own copy of the pattern, pulled out of the `grep -qE '…'` line.
 * Parsing the hook rather than restating it is the point: a third copy here
 * would drift with the other two and prove nothing.
 */
function hookPattern(hookName: string, flag: "-qE" | "-vE"): string {
  const hook = readFileSync(join(REPO_ROOT, ".husky", hookName), "utf-8");
  const match = (flag === "-qE" ? /grep -qE '([^']+)'/ : /grep -vE '([^']+)'/).exec(hook);
  assert.ok(match !== null, `.husky/${hookName} no longer has a \`grep ${flag} '…'\` line`);
  return match[1] ?? "";
}

test("both deploy hooks and the patterns here are the same rule", () => {
  for (const hookName of ["post-commit", "post-merge"]) {
    assert.equal(hookPattern(hookName, "-qE"), DEPLOYED_PATHS_PATTERN, hookName);
    assert.equal(hookPattern(hookName, "-vE"), NOT_SHIPPED_PATTERN, hookName);
  }
});

test("development docs under beebox/docs/ do not ship; docs/box/ does", () => {
  for (const path of [
    "beebox/docs/doc-graph.md",
    "beebox/docs/plans/some-plan.md",
    "beebox/docs/implemented-plans/old-plan.md",
    "beebox/docs/reports/a-report.md",
    "beebox/docs/chat/sessions.md",
    "beebox/docs/boxes/notes.md",
  ]) {
    assert.equal(isDeployedPath(path), false, path);
  }
  for (const path of ["beebox/docs/box/publishing.md", "beebox/docs/box/nested/page.md", "beebox/src/docs/thing.ts"]) {
    assert.equal(isDeployedPath(path), true, path);
  }
});

test("every docs/ entry in beebox's package files list still ships", () => {
  // The package `files` list is what reaches a box; a docs/ entry added there
  // must not fall under NOT_SHIPPED_PATTERN, or its edits would never deploy.
  const pkg: unknown = JSON.parse(readFileSync(join(REPO_ROOT, "beebox/package.json"), "utf-8"));
  const files = typeof pkg === "object" && pkg !== null && "files" in pkg && Array.isArray(pkg.files) ? pkg.files : [];
  const docsEntries = files.filter((entry): entry is string => typeof entry === "string" && entry.startsWith("docs"));
  assert.ok(docsEntries.length > 0, "expected at least one docs/ entry in beebox's package files");
  for (const entry of docsEntries) {
    assert.equal(isDeployedPath(`beebox/${entry}/x.md`), true, entry);
  }
});

test("isDeployedPath: shipped subprojects and root pnpm files, nothing else", () => {
  for (const path of [
    "beebox/src/hub/server.ts",
    "agent-doctest/src/run.ts",
    "personal-vibe-check/eslint.config.ts",
    "patches/tap+21.0.1.patch",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".npmrc",
  ]) {
    assert.equal(isDeployedPath(path), true, path);
  }
  for (const path of [
    "issues/bugs/2026-08-26-thing.md",
    "bin/smoke.ts",
    "ios-app/App.swift",
    "beebox-clerk/src/background.ts",
    "research/notes.md",
    "README.md",
    // Anchoring: the name has to be at the root, not anywhere in the path.
    "dev/beebox/notes.md",
    "docs/package.json",
  ]) {
    assert.equal(isDeployedPath(path), false, path);
  }
});

test("touchesDeployedPath: any shipped path counts; an empty diff ships nothing", () => {
  assert.equal(touchesDeployedPath(["issues/x.md", "beebox/src/a.ts"]), true);
  assert.equal(touchesDeployedPath(["issues/x.md", "bin/b.ts"]), false);
  assert.equal(touchesDeployedPath([]), false);
});
