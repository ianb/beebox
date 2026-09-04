import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { REPO_ROOT, resolveMainRoot, resolveWorktreesRoot } from "../../src/router/router-config.js";

test("repository root is anchored above the workstreams-app package", () => {
  assert.equal(REPO_ROOT, path.resolve(import.meta.dirname, "../../.."));
});

test("main root follows Git's main checkout instead of a renamed-directory guess", () => {
  const worktree = "/checkouts/beebox-worktrees/topic";
  assert.equal(resolveMainRoot({ repoRoot: worktree, commonDir: "/checkouts/callback-box/.git" }), "/checkouts/callback-box");
});

test("main root override remains authoritative", () => {
  assert.equal(resolveMainRoot({ repoRoot: "/checkout", override: "/custom/main", commonDir: "/ignored/.git" }), "/custom/main");
});

test("a non-Git source tree serves itself", () => {
  assert.equal(resolveMainRoot({ repoRoot: path.resolve("/checkout") }), "/checkout");
});

test("worktree storage follows the physical main-checkout family during rename transition", () => {
  assert.equal(resolveWorktreesRoot("/checkouts/callback-box"), "/checkouts/callback-worktrees");
  assert.equal(resolveWorktreesRoot("/checkouts/beebox"), "/checkouts/beebox-worktrees");
});
