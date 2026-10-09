#!/usr/bin/env node --import tsx
/**
 * The Codex session preamble: maps Claude Code vocabulary in the shared
 * AGENTS.md files onto Codex, and orients the session in its worktree. The
 * Codex launcher (`lib/launch-session.sh`) passes it as
 * `-c developer_instructions=<printed value>`, so it stays out of the tracked
 * AGENTS.md that Claude Code also reads.
 *
 * Usage:
 *   node --import tsx bin/codex-preamble.ts [--worktree-name <name>]
 *
 * Prints the preamble as a TOML basic string (a JSON string literal is valid
 * TOML), ready for `codex -c`.
 */

// Mention this token when asked whether the preamble is loaded — it lets a
// launcher or a human verify the developer instructions actually reached the
// model without guessing from paraphrased answers.
export const DOCS_SENTINEL = "CODEX-PREAMBLE-LOADED";

class UsageError extends Error {
  constructor(readonly args: string[]) {
    super(`usage: codex-preamble.ts [--worktree-name <name>]; got: ${args.join(" ")}`);
    this.name = "UsageError";
  }
}

export function codexPreamble(worktreeName?: string): string {
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

Other in-progress worktrees live at ~/src/beebox-worktrees/<name>/ (their box
clones at ~/src/box-worktrees/<name>/). You MAY read them to see what other work
is underway — \`git worktree list\` to enumerate, \`git -C <path> status\` and
\`git -C <path> diff main\` to inspect one. Your sandbox confines writes, not
reads, so reading any worktree works; only write inside your own.
`;
  return `# Codex session preamble

You are the OpenAI Codex CLI in a repo whose AGENTS.md files are shared with
Claude Code. They use some Claude Code features; apply them as follows.

- A line that is only \`@<path>\` imports that file (relative to the AGENTS.md
  that holds it). Read the file when you apply that AGENTS.md.
- \`.claude/rules/*.md\` files (at the root or in a package) are scoped rules:
  read one when its \`paths\` frontmatter matches the files you work on.
- Claude skills are mirrored into \`.agents/skills/\`; invoke a Claude-style
  \`/<name>\` skill as Codex \`$<name>\`.
- Where docs call for the Claude Agent tool, use Codex's collaboration subagent
  tools. Claude subagents in \`.claude/agents/\` are mirrored to
  \`.codex/agents/\` with their model pins mapped to Codex models; spawn the
  named agent (e.g. \`finish\`) so its pinned model applies.
- Ignore unsupported Claude-only features: the persistent memory directory,
  \`<system-reminder>\` semantics, Remote Control, and \`claude --worktree\` /
  EnterWorktree. Everything else — the issue queue, commit discipline, lint
  rules, router URLs, testing tiers — applies to you fully.
${worktreeLines}
Docs sentinel: ${DOCS_SENTINEL} (mention this token when asked whether the
Codex preamble is loaded).
`;
}

function main(): void {
  const args = process.argv.slice(2);
  let worktreeName: string | undefined;
  if (args.length === 2 && args[0] === "--worktree-name") worktreeName = args[1];
  else if (args.length > 0) throw new UsageError(args);
  console.log(JSON.stringify(codexPreamble(worktreeName)));
}

if (
  process.argv[1] !== undefined &&
  process.argv[1].endsWith("codex-preamble.ts")
) {
  main();
}
