/**
 * Tests for `bin/skill-lint.ts` against throwaway `.claude/` trees.
 *
 * Note on tier: bin/CLAUDE.md prefers doctests for new `bin/` tooling; the
 * boxholder asked for this file beside the lint, as `bin/schedules-lint.test.ts`
 * sits beside `bin/schedules lint`, and root `pnpm test` runs `bin/*.test.ts`.
 *
 *   node --import tsx --test bin/skill-lint.test.ts
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";

import { lintSkills, type Finding } from "./skill-lint.js";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "skill-lint-test-"));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}

function skill(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: Does ${name} things.\n---\n${body}`;
}

/** A one-line-body skill with extra frontmatter lines. */
function skillWithKeys(name: string, extra: string): string {
  return `---\nname: ${name}\ndescription: Does ${name} things.\n${extra}---\nbody\n`;
}

function rules(findings: Finding[]): string[] {
  return findings.map((f) => `${f.file}:${f.line} ${f.severity} ${f.rule}`);
}

test("a clean skill and agent produce no findings", () => {
  const root = tree({
    ".claude/skills/alpha/SKILL.md": skill("alpha", "# Alpha\n\nSee the `beta` skill and `bin/tool.ts`.\n"),
    ".claude/skills/alpha/references/notes.md": "notes\n",
    ".claude/skills/beta/SKILL.md": skill("beta", "Use `/alpha` or `$alpha` in code spans only.\n"),
    ".claude/agents/runner.md": "---\nname: runner\ndescription: Runs.\nmodel: sonnet\n---\nBody.\n",
    "bin/tool.ts": "",
  });
  assert.deepEqual(lintSkills(root), []);
});

test("frontmatter: unparseable, name mismatch, empty and overlong description", () => {
  const root = tree({
    ".claude/skills/broken/SKILL.md": "---\nname: [unclosed\n---\nbody\n",
    ".claude/skills/misnamed/SKILL.md": skill("other", "body\n"),
    ".claude/skills/empty/SKILL.md": "---\nname: empty\ndescription: \"  \"\n---\nbody\n",
    ".claude/skills/long/SKILL.md": `---\nname: long\ndescription: ${"x".repeat(1024)}\n---\nbody\n`,
    ".claude/skills/nofence/SKILL.md": "# no frontmatter\n",
    ".claude/agents/agent.md": "---\nname: wrong\ndescription: d\n---\n",
  });
  assert.deepEqual(rules(lintSkills(root)), [
    ".claude/skills/broken/SKILL.md:1 error frontmatter",
    ".claude/skills/empty/SKILL.md:1 error description",
    ".claude/skills/long/SKILL.md:1 error description",
    ".claude/skills/misnamed/SKILL.md:1 error name",
    ".claude/skills/nofence/SKILL.md:1 error frontmatter",
    ".claude/agents/agent.md:1 error name",
  ]);
});

test("body length, nested references, and a missing SKILL.md", () => {
  const root = tree({
    ".claude/skills/big/SKILL.md": skill("big", "line\n".repeat(400)),
    ".claude/skills/ok/SKILL.md": skill("ok", "line\n".repeat(399)),
    ".claude/skills/ok/references/deep/too.md": "x\n",
    ".claude/skills/empty-dir/README.md": "x\n",
  });
  assert.deepEqual(rules(lintSkills(root)), [
    ".claude/skills/big/SKILL.md:5 error body-length",
    ".claude/skills/empty-dir/SKILL.md:1 error missing-skill-file",
    ".claude/skills/ok/SKILL.md:1 error reference-depth",
  ]);
});

test("bare sigils for other skills in prose fail; code, paths, and self-reference pass", () => {
  const body = [
    "# /alpha", // self-reference: allowed
    "Run /beta when done, or $beta in Codex.", // two findings
    "Paths are fine: bin/beta, .claude/skills/beta/SKILL.md, ../beta/x.md, https://x.test/beta.",
    "Code is fine: `/beta` and `$beta`.",
    "```",
    "/beta inside a fence",
    "```",
    "Unknown names are fine: /usr and $HOME and /gamma.",
  ].join("\n");
  const root = tree({
    ".claude/skills/alpha/SKILL.md": skill("alpha", `${body}\n`),
    ".claude/skills/beta/SKILL.md": skill("beta", "body\n"),
  });
  const findings = lintSkills(root);
  assert.deepEqual(rules(findings), [
    ".claude/skills/alpha/SKILL.md:6 error skill-sigil",
    ".claude/skills/alpha/SKILL.md:6 error skill-sigil",
  ]);
  assert.match(findings[0]?.message ?? "", /bare \/beta/);
  assert.match(findings[1]?.message ?? "", /bare \$beta/);
});

test("backticked repo paths must resolve; src/ and docs/ also resolve under beebox/", () => {
  const body = [
    "Exists: `bin/real.ts`, `src/core/x.ts:12`, `docs/guide.md#top`, `.claude/skills/alpha/SKILL.md`.",
    "Missing: `bin/gone.ts` and `beebox/docs/gone.md`.",
    "Skipped: `bin/test/<path>.doctest.md`, `bin/*.ts`, `bin/workstreams`, `beebox/`, `scratch/x.md`.",
    "```sh",
    "cat bin/also-gone.ts `bin/fenced-gone.ts`",
    "```",
  ].join("\n");
  const root = tree({
    ".claude/skills/alpha/SKILL.md": skill("alpha", `${body}\n`),
    "bin/real.ts": "",
    "beebox/src/core/x.ts": "",
    "beebox/docs/guide.md": "",
  });
  const findings = lintSkills(root);
  assert.deepEqual(
    findings.map((f) => `${f.line} ${f.rule} ${f.message}`),
    ["6 missing-path `bin/gone.ts` does not exist", "6 missing-path `beebox/docs/gone.md` does not exist"],
  );
});

test("a missing backticked path that git ignores is a runtime artifact and passes", () => {
  const root = tree({
    ".claude/skills/alpha/SKILL.md": skill("alpha", "Logs land in `bin/run.log`; `bin/gone.ts` is gone.\n"),
    ".gitignore": "*.log\n",
  });
  spawnSync("git", ["init", "-q", root]);
  assert.deepEqual(
    lintSkills(root).map((f) => f.message),
    ["`bin/gone.ts` does not exist"],
  );
});

test("Codex-ignored frontmatter keys are information, not failures", () => {
  const root = tree({
    ".claude/skills/alpha/SKILL.md": skillWithKeys("alpha", "allowed-tools: Bash\ncontext: fork\n"),
    ".claude/agents/runner.md": "---\nname: runner\ndescription: d\nhooks: {}\n---\n",
  });
  const findings = lintSkills(root);
  assert.deepEqual(rules(findings), [
    ".claude/skills/alpha/SKILL.md:1 info codex-ignored-key",
    ".claude/skills/alpha/SKILL.md:1 info codex-ignored-key",
  ]);
});

function cli(...args: string[]): { status: number | null; stdout: string } {
  const result = spawnSync(process.execPath, ["--import", "tsx", join(REPO_ROOT, "bin", "skill-lint.ts"), ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout };
}

test("CLI: one line per finding, exit 1 on failure, --quiet drops info, --json", () => {
  const failing = tree({ ".claude/skills/alpha/SKILL.md": skillWithKeys("beta", "allowed-tools: Bash\n") });
  const text = cli("--root", failing);
  assert.equal(text.status, 1);
  assert.deepEqual(text.stdout.trim().split("\n"), [
    ".claude/skills/alpha/SKILL.md:1: error name: name \"beta\" does not match \"alpha\"",
    ".claude/skills/alpha/SKILL.md:1: info codex-ignored-key: Codex ignores frontmatter key \"allowed-tools\" in the .agents/skills mirror",
  ]);
  assert.equal(cli("--root", failing, "--quiet").stdout.trim().split("\n").length, 1);

  const infoOnly = tree({ ".claude/skills/alpha/SKILL.md": skillWithKeys("alpha", "paths: [x]\n") });
  const json = cli("--root", infoOnly, "--json");
  assert.equal(json.status, 0);
  const parsed: unknown = JSON.parse(json.stdout);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed.length, 1);
  assert.equal(cli("--root", infoOnly, "--quiet").stdout, "");
});
