#!/usr/bin/env node --import tsx
/**
 * Generate gitignored Codex mirrors of Claude-only surfaces for OpenAI Codex
 * CLI sessions (`bin/launch-worktree-session --agent codex`): .agents/skills
 * symlinks for every tracked Claude skill (`lib/codex-skill-links.ts`, which
 * also removes entries with no tracked source), a .codex/agents/<name>.toml
 * for every tracked Claude subagent, and .codex/hooks.json.
 *
 * Instructions need no mirror: the tracked AGENTS.md files are read natively by
 * both Codex and Claude Code. Codex-only orientation reaches the session as
 * developer instructions from `codex-preamble.ts`.
 *
 * Usage:
 *   node --import tsx bin/generate-codex-mirrors.ts [checkout-dir]
 */

import { resolve } from "node:path";

import { generateCodexAgents, generateCodexHooks } from "./generate-codex-agents.js";
import { generateSkillLinks } from "./lib/codex-skill-links.js";

class UsageError extends Error {
  constructor(readonly args: string[]) {
    super(`usage: generate-codex-mirrors.ts [checkout-dir]; got: ${args.join(" ")}`);
    this.name = "UsageError";
  }
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => arg.startsWith("--")))
    throw new UsageError(args);
  const checkoutDir = resolve(args[0] ?? process.cwd());
  const skillLinks = generateSkillLinks(checkoutDir);
  const codexAgents = generateCodexAgents(checkoutDir);
  const codexHooks = generateCodexHooks(checkoutDir);
  console.log(
    `generate-codex-mirrors: wrote ${skillLinks.length} skill link(s), ` +
      `${codexAgents.length} Codex agent(s), and ` +
      `${codexHooks === null ? 0 : 1} Codex hook file(s) in ${checkoutDir}`,
  );
}

if (
  process.argv[1] !== undefined &&
  process.argv[1].endsWith("generate-codex-mirrors.ts")
) {
  main();
}
