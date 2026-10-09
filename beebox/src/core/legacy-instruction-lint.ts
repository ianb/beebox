/**
 * The legacy instruction-file lint: a converted box (one whose manifest
 * records `agents-md-2026-10`) must not hold a `CLAUDE.md`, `CLAUDE.local.md`,
 * or `.claude/CLAUDE.md`. Claude Code loads `AGENTS.md` only for a project with
 * no `CLAUDE.md` of its own, so one stray file silently drops every
 * `AGENTS.md` in the box. A box not yet converted gets no finding: there
 * `CLAUDE.md` is still the authored name.
 *
 * Reported as an error by `bbx validate` (whole box) and by the validate hook
 * (one written file).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CLAUDE_LOCAL_MD, CLAUDE_MD, isAgentsMdBox } from "./agent-instruction-files.js";

const LEGACY_INSTRUCTION_MESSAGE =
  "Name instruction files AGENTS.md. A CLAUDE.md here makes Claude Code ignore every AGENTS.md.";

/**
 * Not walked: vendored and VCS trees, and parked template copies (inactive
 * guidance the `agents-md-2026-10` migration moves with its original).
 */
const SKIP_DIRS = new Set(["node_modules", ".git", ".pnpm", "_template-updates"]);

/** Whether the path's name is one a converted box rejects (`.claude/CLAUDE.md` included). */
function isLegacyInstructionName(filePath: string): boolean {
  const base = path.basename(filePath);
  return base === CLAUDE_MD || base === CLAUDE_LOCAL_MD;
}

function formatError(boxRoot: string, absPath: string): string {
  return `${path.relative(boxRoot, absPath)}: ${LEGACY_INSTRUCTION_MESSAGE}`;
}

/**
 * The error for one written file, or null. Checks the name first and reads
 * the manifest only on a match, so the hook stays cheap for every other write.
 */
export async function legacyInstructionError(boxRoot: string, absPath: string): Promise<string | null> {
  if (!isLegacyInstructionName(absPath)) return null;
  return (await isAgentsMdBox(boxRoot)) ? formatError(boxRoot, absPath) : null;
}

async function findLegacyInstructionFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await findLegacyInstructionFiles(abs)));
    else if (isLegacyInstructionName(entry.name)) found.push(abs);
  }
  return found;
}

/** One error line per legacy instruction file in a converted box; empty for a box not yet converted. */
export async function lintLegacyInstructionFiles(boxRoot: string): Promise<string[]> {
  if (!(await isAgentsMdBox(boxRoot))) return [];
  const files = await findLegacyInstructionFiles(boxRoot);
  return files.toSorted().map((abs) => formatError(boxRoot, abs));
}
