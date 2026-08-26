import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEPLOYED_PATHS_PATTERN,
  isDeployedPath,
  touchesDeployedPath,
} from "./deployed-paths.js";

const REPO_ROOT = join(import.meta.dirname, "..");

/**
 * The hook's own copy of the pattern, pulled out of the `grep -qE '…'` line.
 * Parsing the hook rather than restating it is the point: a third copy here
 * would drift with the other two and prove nothing.
 */
function hookPattern(): string {
  const hook = readFileSync(join(REPO_ROOT, ".husky/post-commit"), "utf-8");
  const match = /grep -qE '([^']+)'/.exec(hook);
  assert.ok(match !== null, ".husky/post-commit no longer has a `grep -qE '…'` line");
  return match[1] ?? "";
}

test("the deploy hook and DEPLOYED_PATHS_PATTERN are the same rule", () => {
  assert.equal(hookPattern(), DEPLOYED_PATHS_PATTERN);
});

test("isDeployedPath: shipped subprojects and root pnpm files, nothing else", () => {
  for (const path of [
    "callback-box/src/hub/server.ts",
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
    "callback-clerk/src/background.ts",
    "research/notes.md",
    "README.md",
    // Anchoring: the name has to be at the root, not anywhere in the path.
    "dev/callback-box/notes.md",
    "docs/package.json",
  ]) {
    assert.equal(isDeployedPath(path), false, path);
  }
});

test("touchesDeployedPath: any shipped path counts; an empty diff ships nothing", () => {
  assert.equal(touchesDeployedPath(["issues/x.md", "callback-box/src/a.ts"]), true);
  assert.equal(touchesDeployedPath(["issues/x.md", "bin/b.ts"]), false);
  assert.equal(touchesDeployedPath([]), false);
});
