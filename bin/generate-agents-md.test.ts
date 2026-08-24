// Tests for generate-agents-md.ts: pure assembly via buildAgentsMd(), and the
// git-integrated generateAgentsFiles() against a throwaway repo in a tmpdir.
// Run with:
//   node --import tsx --test bin/generate-agents-md.test.ts
// (or `pnpm test` at the repo root, which runs every bin/*.test.ts this way.)

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  DOCS_SENTINEL,
  buildAgentsMd,
  generateAgentsFiles,
  generateSkillLinks,
} from "./generate-agents-md.js";

test("nested mirror is header + verbatim content, no preamble", () => {
  const content =
    "# bin docs\n\nRun `claude --worktree x`. See bin/CLAUDE.md.\n";
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
  assert.ok(
    out.includes("invoke a Claude-style\n`/<name>` skill as Codex `$<name>`"),
  );
  assert.ok(
    out.includes("path-scoped rules are embedded in\nthe nearest AGENTS.md"),
  );
  assert.ok(!out.includes("ignore instructions to use them: the Skill tool"));
  assert.ok(out.endsWith(content));
  // No worktree name → no worktree orientation block.
  assert.ok(!out.includes("box-worktrees"));
});

test("worktree name parameterizes the orientation block", () => {
  const out = buildAgentsMd("x\n", {
    isRoot: true,
    worktreeName: "my-feature",
  });
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
  assert.ok(
    readFileSync(join(repo, "sub", "AGENTS.md"), "utf8").endsWith("sub docs\n"),
  );
});

test("regeneration overwrites untracked mirrors in place", () => {
  writeFileSync(join(repo, "CLAUDE.md"), "root docs v2\n");
  const written = generateAgentsFiles(repo);
  assert.equal(written.length, 2);
  const root = readFileSync(join(repo, "AGENTS.md"), "utf8");
  assert.ok(root.endsWith("root docs v2\n"));
  assert.ok(!root.includes("wt1"));
});

test("embeds path-scoped Claude rules in the nearest AGENTS.md", () => {
  mkdirSync(join(repo, "sub", ".claude", "rules"), { recursive: true });
  mkdirSync(join(repo, "rule-only", ".claude", "rules"), { recursive: true });
  writeFileSync(
    join(repo, "sub", ".claude", "rules", "doctest.md"),
    '---\npaths:\n  - "**/*.doctest.md"\n---\n\nUse TypeScript fences.\n',
  );
  writeFileSync(
    join(repo, "rule-only", ".claude", "rules", "global.md"),
    "A rule without a sibling CLAUDE.md uses the nearest ancestor.\n",
  );
  git(
    "add",
    "sub/.claude/rules/doctest.md",
    "rule-only/.claude/rules/global.md",
  );
  git("commit", "-q", "-m", "add scoped rule");

  assert.deepEqual(generateAgentsFiles(repo).sort(), [
    "AGENTS.md",
    "sub/AGENTS.md",
  ]);
  const root = readFileSync(join(repo, "AGENTS.md"), "utf8");
  const nested = readFileSync(join(repo, "sub", "AGENTS.md"), "utf8");
  assert.ok(!root.includes("Use TypeScript fences."));
  assert.ok(
    root.includes(
      "A rule without a sibling CLAUDE.md uses the nearest ancestor.",
    ),
  );
  assert.equal(existsSync(join(repo, "rule-only", "AGENTS.md")), false);
  assert.ok(
    nested.includes(
      "Apply each rule below only when its `paths` frontmatter matches",
    ),
  );
  assert.ok(nested.includes('paths:\n  - "**/*.doctest.md"'));
  assert.ok(nested.includes("Use TypeScript fences."));
});

test("refuses to overwrite a git-tracked AGENTS.md", () => {
  git("add", "-f", "sub/AGENTS.md");
  git("commit", "-q", "-m", "track a mirror (the failure mode)");
  assert.throws(
    () => generateAgentsFiles(repo),
    /refusing to overwrite git-tracked AGENTS.md: sub\/AGENTS.md/,
  );
  git("rm", "-q", "--cached", "sub/AGENTS.md");
  git("commit", "-q", "-m", "untrack");
});

test("links tracked Claude skills into the Codex skill directory", () => {
  mkdirSync(join(repo, ".claude", "skills", "finish"), { recursive: true });
  writeFileSync(
    join(repo, ".claude", "skills", "finish", "SKILL.md"),
    "---\nname: finish\n---\n",
  );
  writeFileSync(
    join(repo, ".claude", "skills", "finish", "helper.txt"),
    "linked asset\n",
  );
  git(
    "add",
    ".claude/skills/finish/SKILL.md",
    ".claude/skills/finish/helper.txt",
  );
  git("commit", "-q", "-m", "add skill");

  assert.deepEqual(generateSkillLinks(repo), [".agents/skills/finish"]);
  assert.equal(
    readlinkSync(join(repo, ".agents", "skills", "finish")),
    join("..", "..", ".claude", "skills", "finish"),
  );
  assert.equal(
    readFileSync(
      join(repo, ".agents", "skills", "finish", "helper.txt"),
      "utf8",
    ),
    "linked asset\n",
  );
});

test("regeneration removes stale generated skill links", () => {
  git("rm", "-q", "-r", ".claude/skills/finish");
  git("commit", "-q", "-m", "remove skill");

  assert.deepEqual(generateSkillLinks(repo), []);
  assert.equal(existsSync(join(repo, ".agents", "skills", "finish")), false);
});

test("refuses to overwrite an existing native Codex skill, and keeps going", () => {
  mkdirSync(join(repo, ".claude", "skills", "finish"), { recursive: true });
  writeFileSync(
    join(repo, ".claude", "skills", "finish", "SKILL.md"),
    "---\nname: finish\n---\n",
  );
  mkdirSync(join(repo, ".claude", "skills", "later"), { recursive: true });
  writeFileSync(
    join(repo, ".claude", "skills", "later", "SKILL.md"),
    "---\nname: later\n---\n",
  );
  mkdirSync(join(repo, ".agents", "skills", "finish"), { recursive: true });
  writeFileSync(
    join(repo, ".agents", "skills", "finish", "SKILL.md"),
    "native\n",
  );
  git("add", ".claude/skills/finish/SKILL.md", ".claude/skills/later/SKILL.md");
  git("commit", "-q", "-m", "restore skill");

  // The native skill is left untouched — that protection is the point.
  const written = generateSkillLinks(repo);
  assert.equal(
    readFileSync(join(repo, ".agents", "skills", "finish", "SKILL.md"), "utf8"),
    "native\n",
  );

  // ...but it no longer aborts the run. `later` sorts after `finish`, so under
  // the old throw-on-first-conflict behavior it was never linked at all — one
  // unexpected directory silently cost every skill after it.
  assert.ok(written.includes(".agents/skills/later"));
  assert.equal(
    readlinkSync(join(repo, ".agents", "skills", "later")),
    join("..", "..", ".claude", "skills", "later"),
  );
});
