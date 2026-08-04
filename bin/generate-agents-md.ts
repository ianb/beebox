#!/usr/bin/env node --import tsx
/**
 * Generate gitignored AGENTS.md mirrors of every tracked CLAUDE.md, for OpenAI
 * Codex CLI sessions (`bin/launch-worktree-session --agent codex`).
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
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const GENERATED_HEADER =
  "<!-- GENERATED from the sibling CLAUDE.md by bin/generate-agents-md.ts at" +
  " worktree spin-up. Do not edit or commit this file (it is gitignored);" +
  " edit CLAUDE.md. -->";

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
`;
  return `# Codex session preamble

You are the OpenAI Codex CLI in a repo whose agent docs are maintained as
CLAUDE.md files (for Claude Code). Every AGENTS.md here, including this one,
is a generated gitignored mirror of the sibling CLAUDE.md — same content,
either name. Edit CLAUDE.md, never AGENTS.md; regenerate mirrors with
\`node --import tsx bin/generate-agents-md.ts\`.

These docs mention Claude Code harness features that do not exist in your
harness — ignore instructions to use them: the Skill tool and \`/<name>\`
slash-command skills, subagents / the Agent tool, the persistent memory
directory, \`<system-reminder>\` semantics, \`/finish\`, Remote Control, and
\`claude --worktree\` / EnterWorktree. Everything else — the issue queue,
commit discipline, lint rules, router URLs, testing tiers — applies to you
fully.
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

function gitLsFiles(checkoutDir: string, ...patterns: string[]): string[] {
  const out = execFileSync("git", ["-C", checkoutDir, "ls-files", "--", ...patterns], {
    encoding: "utf8",
  });
  return out.split("\n").filter((line) => line !== "");
}

// Write an AGENTS.md next to every tracked CLAUDE.md. Returns the paths
// written (checkout-relative). Throws if any AGENTS.md is git-tracked — a
// tracked mirror is exactly the committed-then-stale failure mode this
// generator exists to prevent, so it must never be silently overwritten.
export function generateAgentsFiles(checkoutDir: string, worktreeName?: string): string[] {
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
  const written: string[] = [];
  for (const rel of claudeFiles) {
    const content = readFileSync(join(checkoutDir, rel), "utf8");
    const isRoot = rel === "CLAUDE.md";
    const target = join(dirname(rel), "AGENTS.md");
    writeFileSync(join(checkoutDir, target), buildAgentsMd(content, { isRoot, worktreeName }));
    written.push(target);
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
      if (worktreeName === undefined) throw new Error("--worktree-name needs a value");
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown flag: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length > 1) throw new Error(`expected at most one checkout dir, got: ${positional.join(" ")}`);
  const checkoutDir = resolve(positional[0] ?? process.cwd());
  const written = generateAgentsFiles(checkoutDir, worktreeName);
  console.log(`generate-agents-md: wrote ${written.length} AGENTS.md mirror(s) in ${checkoutDir}`);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("generate-agents-md.ts")) {
  main();
}
