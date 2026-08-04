// Tests for generate-agents-md.ts: pure assembly via buildAgentsMd(), and the
// git-integrated generateAgentsFiles() against a throwaway repo in a tmpdir.
// Run with:
//   node --import tsx --test bin/generate-agents-md.test.ts
// (or `pnpm test` at the repo root, which runs every bin/*.test.ts this way.)

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { DOCS_SENTINEL, buildAgentsMd, generateAgentsFiles } from "./generate-agents-md.js";

test("nested mirror is header + verbatim content, no preamble", () => {
  const content = "# bin docs\n\nRun `claude --worktree x`. See bin/CLAUDE.md.\n";
  const out = buildAgentsMd(content, { isRoot: false });
  assert.ok(out.startsWith("<!-- GENERATED"));
  // Verbatim: the original text survives untouched — including the `claude`
  // command and the CLAUDE.md pointer (the old find-replace mangled both).
  assert.ok(out.endsWith(content));
  assert.ok(!out.includes("Codex session preamble"));
});

test("root mirror gets the preamble, sentinel, and verbatim content", () => {
  const content = "# Monorepo Layout\n";
  const out = buildAgentsMd(content, { isRoot: true });
  assert.ok(out.includes("Codex session preamble"));
  assert.ok(out.includes(DOCS_SENTINEL));
  assert.ok(out.endsWith(content));
  // No worktree name → no worktree orientation block.
  assert.ok(!out.includes("box-worktrees"));
});

test("worktree name parameterizes the orientation block", () => {
  const out = buildAgentsMd("x\n", { isRoot: true, worktreeName: "my-feature" });
  assert.ok(out.includes("~/src/box-worktrees/my-feature/test1"));
  assert.ok(out.includes("http://localhost:3210/my-feature/"));
  assert.ok(out.includes("`worktree-my-feature`"));
});

// --- git-integrated tests against a scratch repo ---

const repo = mkdtempSync(join(tmpdir(), "generate-agents-md-test-"));
after(() => rmSync(repo, { recursive: true, force: true }));

function git(...args: string[]): void {
  execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
}

test("writes a mirror beside every tracked CLAUDE.md, skips untracked", () => {
  git("init", "-q");
  git("config", "user.email", "t@example.invalid");
  git("config", "user.name", "t");
  writeFileSync(join(repo, "CLAUDE.md"), "root docs\n");
  mkdirSync(join(repo, "sub"));
  writeFileSync(join(repo, "sub", "CLAUDE.md"), "sub docs\n");
  mkdirSync(join(repo, "untracked"));
  writeFileSync(join(repo, "untracked", "CLAUDE.md"), "not committed\n");
  writeFileSync(join(repo, "NOTCLAUDE.md"), "basename mismatch\n");
  git("add", "CLAUDE.md", "sub/CLAUDE.md", "NOTCLAUDE.md");
  git("commit", "-q", "-m", "init");

  const written = generateAgentsFiles(repo, "wt1");
  assert.deepEqual(written.sort(), ["AGENTS.md", "sub/AGENTS.md"]);
  assert.ok(readFileSync(join(repo, "AGENTS.md"), "utf8").includes("wt1"));
  assert.ok(readFileSync(join(repo, "sub", "AGENTS.md"), "utf8").endsWith("sub docs\n"));
});

test("regeneration overwrites untracked mirrors in place", () => {
  writeFileSync(join(repo, "CLAUDE.md"), "root docs v2\n");
  const written = generateAgentsFiles(repo);
  assert.equal(written.length, 2);
  const root = readFileSync(join(repo, "AGENTS.md"), "utf8");
  assert.ok(root.endsWith("root docs v2\n"));
  assert.ok(!root.includes("wt1"));
});

test("refuses to overwrite a git-tracked AGENTS.md", () => {
  git("add", "-f", "sub/AGENTS.md");
  git("commit", "-q", "-m", "track a mirror (the failure mode)");
  assert.throws(() => generateAgentsFiles(repo), /refusing to overwrite git-tracked AGENTS.md: sub\/AGENTS.md/);
  git("rm", "-q", "--cached", "sub/AGENTS.md");
  git("commit", "-q", "-m", "untrack");
});
