/**
 * What host configuration a Claude session started for a box may load.
 *
 * The beebox server runs the Claude Code CLI under the host's Claude login.
 * With the SDK defaults that session also loads the host user's settings
 * (`~/.claude/settings.json`, `~/.claude/CLAUDE.md`, user hooks, skills and
 * plugins) and every claude.ai connector of the signed-in account (Gmail,
 * Calendar, Drive). A box agent must see only the box: one account's mail
 * offered to every member of a box is a privacy breach
 * (`issues/closed/bugs/2026-10-08-box-chat-agent-inherits-host-claude-account-connectors.md`).
 *
 * Every SDK call that runs against a box spreads this into its options.
 */

import { dirname, join, resolve } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";

type BoxSessionSettings = Required<Pick<Options, "settingSources" | "settings">>;

/**
 * Instruction files in every directory above the box. The CLI walks up from
 * its working directory and loads each `CLAUDE.md` it finds as project memory,
 * so a box under the host's home directory loads `~/.claude/CLAUDE.md` even
 * without the `user` source.
 */
function ancestorInstructionFiles(boxRoot: string): string[] {
  const out: string[] = [];
  let dir = resolve(boxRoot);
  for (let parent = dirname(dir); parent !== dir; dir = parent, parent = dirname(dir)) {
    out.push(
      join(parent, "CLAUDE.md"),
      join(parent, "CLAUDE.local.md"),
      join(parent, ".claude", "CLAUDE.md"),
      join(parent, ".claude", "rules", "**"),
    );
  }
  return out;
}

/**
 * `loadBoxContext: true` loads the box's project settings: `CLAUDE.md`,
 * `.claude/rules/`, `.claude/skills/`, and the hooks in
 * `.claude/settings.json`. `false` loads no filesystem settings at all, for
 * structured passes that need none of it. Neither loads the `user` source,
 * no instruction file above `boxRoot` loads, and claude.ai connectors are off
 * in both (`disableClaudeAiConnectors` is a flag-level setting; any source that
 * sets it true wins).
 */
export function boxSessionSettings(
  { boxRoot, loadBoxContext }: { boxRoot: string; loadBoxContext: boolean },
): BoxSessionSettings {
  return {
    settingSources: loadBoxContext ? ["project"] : [],
    settings: {
      disableClaudeAiConnectors: true,
      claudeMdExcludes: ancestorInstructionFiles(boxRoot),
    },
  };
}
