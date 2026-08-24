#!/usr/bin/env node --import tsx
/**
 * Generate gitignored Codex mirrors for OpenAI Codex CLI sessions
 * (`bin/launch-worktree-session --agent codex`): AGENTS.md beside every tracked
 * CLAUDE.md, path-scoped Claude rules embedded into the nearest AGENTS.md, and
 * .agents/skills symlinks for every tracked Claude skill.
 *
 * Codex reads AGENTS.md where Claude Code reads CLAUDE.md: its harness injects
 * the root→cwd chain at session start, and its system prompt tells the model
 * nested AGENTS.md files "can appear anywhere within the repository" and must
 * be obeyed by scope — so a mirror at every CLAUDE.md level plugs into
 * behavior Codex is already trained to perform.
 *
 * Content is copied VERBATIM (header/preamble prepended, zero substitution).
 * A committed AGENTS.md produced by find-replace rotted for a month and was
 * removed in 872450eb; this generator kills both failure modes by
 * construction: no transform to mangle, and regeneration at every worktree
 * spin-up (WorktreeCreate hook + the codex launcher path) instead of a
 * committed copy that drifts. AGENTS.md is gitignored at every level — the
 * generator refuses to overwrite any AGENTS.md that is tracked.
 *
 * Usage:
 *   node --import tsx bin/generate-agents-md.ts [--worktree-name <name>] [checkout-dir]
 *
 * `--worktree-name` adds worktree-specific orientation (box clone path,
 * router URL) to the root preamble; omit it on the main checkout.
 */

import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const GENERATED_HEADER =
  "<!-- GENERATED from Claude guidance by bin/generate-agents-md.ts at" +
  " worktree spin-up. Do not edit or commit this file (it is gitignored);" +
  " edit CLAUDE.md or .claude/rules instead. -->";

// Mention this token when asked whether the generated docs are loaded — it
// lets a launcher or a human verify the AGENTS.md chain actually reached the
// model without guessing from paraphrased answers.
export const DOCS_SENTINEL = "CODEX-AGENTS-LOADED";

// The root preamble maps Claude Code's harness vocabulary onto Codex's world.
// It deliberately does NOT rewrite the doc text itself — the docs mention
// Skill/subagents/memory/etc. freely, and this one block declassifies them all.
export function rootPreamble(worktreeName?: string): string {
  const worktreeLines =
    worktreeName === undefined
      ? ""
      : `
You are already inside the worktree \`${worktreeName}\` (branch
\`worktree-${worktreeName}\`) — ignore any instruction to create one. Your
isolated test box clone is at ~/src/box-worktrees/${worktreeName}/test1, and
the shared dev router serves this checkout at
http://localhost:3210/${worktreeName}/... (the worktree short name, not the
branch name).

Other in-progress worktrees live at ~/src/callback-worktrees/<name>/ (their box
clones at ~/src/box-worktrees/<name>/). You MAY read them to see what other work
is underway — \`git worktree list\` to enumerate, \`git -C <path> status\` and
\`git -C <path> diff main\` to inspect one. Your sandbox confines writes, not
reads, so reading any worktree works; only write inside your own.
`;
  return `# Codex session preamble

You are the OpenAI Codex CLI in a repo whose agent docs are maintained as
CLAUDE.md files (for Claude Code). Every AGENTS.md here, including this one,
is a generated gitignored mirror of the sibling CLAUDE.md — same content,
either name. Edit CLAUDE.md, never AGENTS.md; regenerate mirrors with
\`node --import tsx bin/generate-agents-md.ts\`.

Claude skills are mirrored into \`.agents/skills/\`; invoke a Claude-style
\`/<name>\` skill as Codex \`$<name>\`. Claude path-scoped rules are embedded in
the nearest AGENTS.md; apply them only when their \`paths\` frontmatter matches.
Where docs call for the Claude Agent tool, use Codex's collaboration subagent
tools. Ignore unsupported Claude-only features: the persistent memory directory,
\`<system-reminder>\` semantics, Remote Control, and \`claude --worktree\` /
EnterWorktree. Everything else — the issue queue, commit discipline, lint rules,
router URLs, testing tiers — applies to you fully.
${worktreeLines}
Docs sentinel: ${DOCS_SENTINEL} (mention this token when asked whether the
generated agent docs are loaded).

---
`;
}

// Pure assembly of one AGENTS.md from its CLAUDE.md content.
export function buildAgentsMd(
  claudeMdContent: string,
  opts: { isRoot: boolean; worktreeName?: string | undefined },
): string {
  const preamble = opts.isRoot ? rootPreamble(opts.worktreeName) + "\n" : "";
  return `${GENERATED_HEADER}\n${preamble}${claudeMdContent}`;
}

function buildRulesAppendix(
  rules: Array<{ path: string; content: string }>,
): string {
  if (rules.length === 0) return "";
  const rendered = rules
    .map(({ path, content }) => `### \`${path}\`\n\n${content}`)
    .join("\n\n");
  return (
    "\n## Mirrored Claude path rules\n\n" +
    "Apply each rule below only when its `paths` frontmatter matches the files in play.\n\n" +
    rendered
  );
}

function gitLsFiles(checkoutDir: string, ...patterns: string[]): string[] {
  const out = execFileSync(
    "git",
    ["-C", checkoutDir, "ls-files", "--", ...patterns],
    {
      encoding: "utf8",
    },
  );
  return out.split("\n").filter((line) => line !== "");
}

// Write an AGENTS.md next to every tracked CLAUDE.md, embedding tracked
// .claude/rules into the nearest such scope. Returns the paths written
// (checkout-relative). Throws if any AGENTS.md is git-tracked — a tracked mirror is exactly the
// committed-then-stale failure mode this generator exists to prevent, so it
// must never be silently overwritten.
export function generateAgentsFiles(
  checkoutDir: string,
  worktreeName?: string,
): string[] {
  const tracked = gitLsFiles(checkoutDir, "AGENTS.md", "*AGENTS.md").filter(
    (p) => basename(p) === "AGENTS.md",
  );
  if (tracked.length > 0) {
    throw new Error(
      `refusing to overwrite git-tracked AGENTS.md: ${tracked.join(", ")} — ` +
        "mirrors must stay gitignored (see .gitignore); untrack them first",
    );
  }
  const claudeFiles = gitLsFiles(checkoutDir, "CLAUDE.md", "*CLAUDE.md").filter(
    (p) => basename(p) === "CLAUDE.md",
  );
  const claudeByTarget = new Map(
    claudeFiles.map((rel) => [join(dirname(rel), "AGENTS.md"), rel]),
  );
  const findNearestTarget = (scopeDir: string): string => {
    let candidateDir = scopeDir.replace(/\/$/, "") || ".";
    while (true) {
      const target =
        candidateDir === "." ? "AGENTS.md" : join(candidateDir, "AGENTS.md");
      if (claudeByTarget.has(target)) return target;
      const parent = dirname(candidateDir);
      if (parent === candidateDir || candidateDir === ".") {
        throw new Error(
          `no tracked CLAUDE.md scopes rule directory: ${scopeDir || "."}`,
        );
      }
      candidateDir = parent;
    }
  };
  const rulesByTarget = new Map<
    string,
    Array<{ path: string; content: string }>
  >();
  const ruleFiles = gitLsFiles(
    checkoutDir,
    ".claude/rules/*.md",
    "*/.claude/rules/*.md",
  ).filter((path) => /(^|\/)\.claude\/rules\/[^/]+\.md$/.test(path));
  for (const rel of ruleFiles) {
    const markerIndex = rel.indexOf(".claude/rules/");
    const scopeDir = rel.slice(0, markerIndex);
    const target = findNearestTarget(scopeDir);
    const rules = rulesByTarget.get(target) ?? [];
    rules.push({
      path: rel,
      content: readFileSync(join(checkoutDir, rel), "utf8"),
    });
    rulesByTarget.set(target, rules);
  }

  const targets = new Set(claudeByTarget.keys());
  const written: string[] = [];
  for (const target of [...targets].sort()) {
    const claudeFile = claudeByTarget.get(target);
    const isRoot = target === "AGENTS.md";
    const content =
      claudeFile === undefined
        ? `${GENERATED_HEADER}\n${isRoot ? `${rootPreamble(worktreeName)}\n` : ""}`
        : buildAgentsMd(readFileSync(join(checkoutDir, claudeFile), "utf8"), {
            isRoot,
            worktreeName,
          });
    const rules = rulesByTarget.get(target) ?? [];
    writeFileSync(
      join(checkoutDir, target),
      content + buildRulesAppendix(rules),
    );
    written.push(target);
  }
  return written;
}

function lstatIfPresent(
  path: string,
): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
}

// Link every tracked Claude skill into the repo-scoped location Codex scans.
// Symlinks keep scripts/references/assets attached without duplicating them.
// Only links with our exact generated target are ever removed on regeneration;
// native Codex skills or other user-created entries are left alone and collide
// loudly instead of being overwritten.
export function generateSkillLinks(checkoutDir: string): string[] {
  const skillNames = gitLsFiles(checkoutDir, ".claude/skills/*/SKILL.md")
    .map((path) => path.split("/"))
    .filter(
      (parts) =>
        parts.length === 4 &&
        parts[0] === ".claude" &&
        parts[1] === "skills" &&
        parts[3] === "SKILL.md",
    )
    .map((parts) => parts[2])
    .filter((name): name is string => name !== undefined)
    .sort();
  const expected = new Set(skillNames);
  const skillsDir = join(checkoutDir, ".agents", "skills");
  mkdirSync(skillsDir, { recursive: true });

  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isSymbolicLink()) continue;
    const target = join("..", "..", ".claude", "skills", entry.name);
    const path = join(skillsDir, entry.name);
    if (readlinkSync(path) === target && !expected.has(entry.name))
      unlinkSync(path);
  }

  const written: string[] = [];
  for (const name of skillNames) {
    const target = join("..", "..", ".claude", "skills", name);
    const path = join(skillsDir, name);
    const existing = lstatIfPresent(path);
    if (existing === undefined) {
      symlinkSync(target, path, "dir");
    } else if (!existing.isSymbolicLink() || readlinkSync(path) !== target) {
      // Still refuse to overwrite — a hand-authored native Codex skill at a
      // tracked skill's name is a real thing to protect (see the test of the
      // same name). But SKIP it and keep going rather than throwing.
      //
      // Throwing aborted the whole run at the FIRST such entry, so one
      // unexpected directory silently cost every later skill AND the AGENTS.md
      // mirrors after it. The main checkout sat on 2026-07-06 copies of all 15
      // skills for seven weeks that way, and the only symptom was Codex
      // sessions working from stale instructions — invisible unless someone ran
      // the generator by hand. A loud skip keeps the protection and bounds the
      // damage to the one entry it is protecting.
      console.warn(
        `generate-agents-md: refusing to overwrite existing Codex skill path: .agents/skills/${name} — ` +
          `leaving it as-is. If this is a stale generated copy rather than a native Codex skill, ` +
          `remove it and re-run to restore the symlink.`,
      );
      continue;
    }
    written.push(join(".agents", "skills", name));
  }
  return written;
}

function main(): void {
  const args = process.argv.slice(2);
  let worktreeName: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === "--worktree-name") {
      worktreeName = args[++i];
      if (worktreeName === undefined)
        throw new Error("--worktree-name needs a value");
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown flag: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length > 1)
    throw new Error(
      `expected at most one checkout dir, got: ${positional.join(" ")}`,
    );
  const checkoutDir = resolve(positional[0] ?? process.cwd());
  const agentsFiles = generateAgentsFiles(checkoutDir, worktreeName);
  const skillLinks = generateSkillLinks(checkoutDir);
  console.log(
    `generate-agents-md: wrote ${agentsFiles.length} AGENTS.md mirror(s) and ` +
      `${skillLinks.length} skill link(s) in ${checkoutDir}`,
  );
}

if (
  process.argv[1] !== undefined &&
  process.argv[1].endsWith("generate-agents-md.ts")
) {
  main();
}
