/**
 * Codex agent mirrors: a gitignored .codex/agents/<name>.toml for every tracked
 * .claude/agents/*.md, with the Claude `model:` alias mapped to a Codex model.
 * Called by bin/generate-agents-md.ts at worktree spin-up. Without a generated
 * mirror, Codex worktrees had no named agent at all and ran /finish on the
 * session's default model.
 */

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

import { MODEL_ID } from "../beebox/src/shared/model-ids.js";

function gitLsFiles(checkoutDir: string, pattern: string): string[] {
  return execFileSync("git", ["-C", checkoutDir, "ls-files", "--", pattern], {
    encoding: "utf8",
  })
    .split("\n")
    .filter((line) => line !== "");
}

// Claude subagent `model:` aliases → the Codex model that fills the same role.
// An unmapped, missing, or `inherit` model fails generation: a Codex agent
// silently inheriting the session's (expensive) default model is the bug this
// mapping exists to prevent.
const CODEX_MODEL_FOR_CLAUDE_ALIAS: Record<string, string> = {
  sonnet: MODEL_ID.luna,
};

const CODEX_AGENT_HEADER =
  "# GENERATED from .claude/agents by bin/generate-agents-md.ts at worktree" +
  " spin-up. Do not edit or commit this file (it is gitignored).";

class UnmappedAgentModelError extends Error {
  constructor(
    readonly agentPath: string,
    readonly model: string,
  ) {
    super(
      `${agentPath}: no Codex model mapped for Claude model "${model}" ` +
        "(add it to CODEX_MODEL_FOR_CLAUDE_ALIAS in bin/generate-codex-agents.ts)",
    );
    this.name = "UnmappedAgentModelError";
  }
}

class MalformedAgentFileError extends Error {
  constructor(
    readonly agentPath: string,
    readonly problem: string,
  ) {
    super(`${agentPath}: ${problem}`);
    this.name = "MalformedAgentFileError";
  }
}

// Pure conversion of one Claude subagent file to a Codex agent TOML. The body
// is copied verbatim into a TOML literal string (no escapes, so backslashes in
// shell snippets survive).
export function buildCodexAgentToml(agentPath: string, md: string): string {
  const match = /^---\n([\S\s]*?)\n---\n\n?([\S\s]*)$/.exec(md);
  if (match === null)
    throw new MalformedAgentFileError(agentPath, "missing frontmatter");
  const [, frontmatter = "", body = ""] = match;
  const fields = new Map(
    frontmatter
      .split("\n")
      .map((line) => /^([a-z]+):(.*)$/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1] ?? "", (m[2] ?? "").trim()]),
  );
  const field = (key: string): string | undefined => fields.get(key);
  const name = field("name");
  const description = field("description");
  if (name === undefined || description === undefined)
    throw new MalformedAgentFileError(agentPath, "needs name and description");
  if (body.includes("'''"))
    throw new MalformedAgentFileError(agentPath, "body contains '''");
  const alias = field("model") ?? "(none)";
  const codexModel = CODEX_MODEL_FOR_CLAUDE_ALIAS[alias];
  if (codexModel === undefined)
    throw new UnmappedAgentModelError(agentPath, alias);
  return (
    `${CODEX_AGENT_HEADER}\n` +
    `name = ${JSON.stringify(name)}\n` +
    `description = ${JSON.stringify(description)}\n` +
    `model = ${JSON.stringify(codexModel)}\n` +
    `developer_instructions = '''\n${body.trimEnd()}\n'''\n`
  );
}

// Write .codex/agents/<name>.toml for every tracked .claude/agents/*.md.
// The tracked Claude agent is authoritative: its mirror is always overwritten,
// because a stale hand-written TOML at the same name is how Codex /finish ran
// unpinned. Generated TOMLs whose source is gone are removed; other TOMLs
// (no generated header) are left alone.
export function generateCodexAgents(checkoutDir: string): string[] {
  const agentFiles = gitLsFiles(checkoutDir, ".claude/agents/*.md").filter(
    (path) => /^\.claude\/agents\/[^/]+\.md$/.test(path),
  );
  const agentsDir = join(checkoutDir, ".codex", "agents");
  mkdirSync(agentsDir, { recursive: true });
  const isGenerated = (path: string): boolean =>
    readFileSync(path, "utf8").startsWith(CODEX_AGENT_HEADER);
  const expected = new Set(
    agentFiles.map((rel) => `${basename(rel, ".md")}.toml`),
  );
  for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
    const path = join(agentsDir, entry.name);
    if (entry.isFile() && !expected.has(entry.name) && isGenerated(path))
      unlinkSync(path);
  }

  const written: string[] = [];
  for (const rel of agentFiles.toSorted()) {
    const target = join(".codex", "agents", `${basename(rel, ".md")}.toml`);
    const path = join(checkoutDir, target);
    writeFileSync(
      path,
      buildCodexAgentToml(rel, readFileSync(join(checkoutDir, rel), "utf8")),
    );
    written.push(target);
  }
  return written;
}
