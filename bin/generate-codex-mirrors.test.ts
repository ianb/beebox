// Tests for codex-preamble.ts and the git-integrated Codex agent/hook mirrors
// (generate-codex-agents.ts) against a throwaway repo in a tmpdir.
// Run with:
//   node --import tsx --test bin/generate-codex-mirrors.test.ts
// (or `pnpm test` at the repo root, which runs every bin/*.test.ts this way.)

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { DOCS_SENTINEL, codexPreamble } from "./codex-preamble.js";
import {
  buildCodexAgentToml,
  generateCodexAgents,
  generateCodexHooks,
} from "./generate-codex-agents.js";

test("preamble maps Claude features and carries the sentinel", () => {
  const out = codexPreamble();
  assert.ok(out.includes(DOCS_SENTINEL));
  assert.ok(out.includes("`/<name>` skill as Codex `$<name>`"));
  assert.ok(out.includes("`@<path>` imports that file"));
  assert.ok(out.includes("`.claude/rules/*.md`"));
  // No worktree name → no worktree orientation block.
  assert.ok(!out.includes("box-worktrees"));
});

test("worktree name parameterizes the orientation block", () => {
  const out = codexPreamble("my-feature");
  assert.ok(out.includes("~/src/box-worktrees/my-feature/test1"));
  assert.ok(out.includes("http://localhost:3210/my-feature/"));
  assert.ok(out.includes("`worktree-my-feature`"));
});

test("CLI prints the preamble as one TOML basic string", () => {
  const printed = execFileSync(
    process.execPath,
    ["--import", "tsx", join(import.meta.dirname, "codex-preamble.ts"), "--worktree-name", "wt1"],
    { encoding: "utf8" },
  ).trim();
  assert.ok(printed.startsWith('"') && printed.endsWith('"'));
  assert.ok(!printed.includes("\n"));
  assert.equal(JSON.parse(printed), codexPreamble("wt1"));
});

// --- git-integrated tests against a scratch repo ---

const repo = mkdtempSync(join(tmpdir(), "generate-codex-mirrors-test-"));
after(() => rmSync(repo, { recursive: true, force: true }));

function git(...args: string[]): void {
  execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
}

test("scratch repo initializes", () => {
  git("init", "-q");
  git("config", "user.email", "t@example.invalid");
  git("config", "user.name", "t");
  writeFileSync(join(repo, "README.md"), "x\n");
  git("add", "README.md");
  git("commit", "-q", "-m", "init");
});

test("Codex agent TOML maps the Claude model alias and keeps the body verbatim", () => {
  const body = "Run `sed -n 's/\\(x\\)/\\1/p'` then report.\n";
  const md =
    "---\nname: finish\ndescription: Lands work.\ntools: Bash\nmodel: sonnet\n---\n\n" +
    body;
  const toml = buildCodexAgentToml(".claude/agents/finish.md", md);
  assert.ok(toml.includes('\nmodel = "gpt-6-luna"\n'));
  assert.ok(toml.includes('\nname = "finish"\n'));
  assert.ok(toml.includes(`'''\n${body}'''\n`));
  assert.ok(!toml.includes("tools"));
});

test("Codex agent TOML fails on an unmapped, inherited, or missing model", () => {
  for (const [modelLine, shown] of [
    ["model: opus\n", "opus"],
    ["model: inherit\n", "inherit"],
    ["", "(none)"],
  ] as const) {
    assert.throws(
      () =>
        buildCodexAgentToml(
          ".claude/agents/x.md",
          `---\nname: x\ndescription: d\n${modelLine}---\n\nbody\n`,
        ),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes(`no Codex model mapped for Claude model "${shown}"`),
    );
  }
});

test("generates Codex agents, replaces stale hand-written mirrors, removes orphans", () => {
  mkdirSync(join(repo, ".claude", "agents"), { recursive: true });
  writeFileSync(
    join(repo, ".claude", "agents", "finish.md"),
    "---\nname: finish\ndescription: d\nmodel: sonnet\n---\n\nbody\n",
  );
  git("add", ".claude/agents/finish.md");
  git("commit", "-q", "-m", "add agent");
  mkdirSync(join(repo, ".codex", "agents"), { recursive: true });
  writeFileSync(
    join(repo, ".codex", "agents", "native.toml"),
    'name = "native"\n',
  );
  // A hand-written stale mirror at a tracked agent's name is replaced.
  writeFileSync(
    join(repo, ".codex", "agents", "finish.toml"),
    'name = "finish"\ndeveloper_instructions = "stale"\n',
  );

  assert.deepEqual(generateCodexAgents(repo), [".codex/agents/finish.toml"]);
  assert.ok(
    readFileSync(join(repo, ".codex", "agents", "finish.toml"), "utf8").includes(
      'model = "gpt-6-luna"',
    ),
  );

  git("rm", "-q", ".claude/agents/finish.md");
  git("commit", "-q", "-m", "remove agent");
  assert.deepEqual(generateCodexAgents(repo), []);
  assert.equal(existsSync(join(repo, ".codex", "agents", "finish.toml")), false);
  assert.equal(existsSync(join(repo, ".codex", "agents", "native.toml")), true);
});

test("the Codex hook file carries an absolute command, and never a Claude-only variable", () => {
  assert.equal(generateCodexHooks(repo), ".codex/hooks.json");
  const written = readFileSync(join(repo, ".codex", "hooks.json"), "utf8");
  assert.ok(!written.includes("CLAUDE_PROJECT_DIR"));
  assert.ok(written.includes(join(repo, "beebox", "node_modules", ".bin", "vibe-check")));
  // Regenerating is a no-op rewrite, not a refusal: the file it wrote is its own.
  assert.equal(generateCodexHooks(repo), ".codex/hooks.json");
});

test("a hand-authored Codex hook file is left alone", () => {
  writeFileSync(join(repo, ".codex", "hooks.json"), '{"hooks":{}}\n');
  assert.equal(generateCodexHooks(repo), null);
  assert.equal(readFileSync(join(repo, ".codex", "hooks.json"), "utf8"), '{"hooks":{}}\n');
});

test("a hook file from the generator's old name is replaced", () => {
  writeFileSync(
    join(repo, ".codex", "hooks.json"),
    JSON.stringify({
      description:
        "GENERATED by bin/generate-agents-md.ts — lint this checkout's edits." +
        " Do not edit or commit (.codex is gitignored); edit the generator instead.",
    }),
  );
  assert.equal(generateCodexHooks(repo), ".codex/hooks.json");
  assert.ok(readFileSync(join(repo, ".codex", "hooks.json"), "utf8").includes("generate-codex-mirrors.ts"));
});
