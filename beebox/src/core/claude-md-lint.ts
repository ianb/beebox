/**
 * Soft size lint for a box's CLAUDE.md files.
 *
 * A box CLAUDE.md is loaded into the boxholder agent's context every single
 * turn, so an oversized one silently crowds out the actual task. Published
 * guidance converges on ~200 lines as the practical target and ~300 as the
 * ceiling past which models reliably start dropping instructions (Claude Code's
 * own system prompt already spends part of the instruction budget).
 *
 * We measure in **characters**, not lines: a line can be a one-word bullet or a
 * 170-char paragraph, so line count is a poor proxy for context cost. Two tiers
 * map the line guidance through a realistic ~60-80 chars/line — a soft "getting
 * large" nudge, then firmer "too large" language.
 *
 * Both are *soft* warnings — never a hard error and never a commit block. The
 * nudge is to trim, or move detail onto a lazier surface (a nested CLAUDE.md,
 * a `.claude/rules/` glob, or a skill) rather than to fail the edit. Markdown
 * validity is deliberately NOT checked for CLAUDE.md (it isn't rendered); only
 * size is.
 *
 * Sources (June 2026):
 *  - https://code.claude.com/docs/en/best-practices ("Write an effective CLAUDE.md")
 *  - https://www.humanlayer.dev/blog/writing-a-good-claude-md
 *
 * Concrete fixing strategies for an oversized file are documented in the package
 * docs, reducing-claude-md.md (src/core/reducing-claude-md-doc.ts),
 * which the warning below points to.
 */

import { BOX_PACKAGE_DOCS } from "./docs-gen/shared.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CLAUDE_MD } from "./agent-instruction-files.js";

/** Soft "getting large" tier — ~200-line target, roughly 3k tokens. */
export const CLAUDE_MD_WARN_CHARS = 12_000;
/** Firm "too large" tier — ~300-line ceiling, roughly 5k tokens. */
export const CLAUDE_MD_FIRM_CHARS = 20_000;

const SKIP_DIRS = new Set(["node_modules", ".git", ".pnpm", ".claude"]);

const MOVE_ADVICE =
  "Trim it, consolidate duplication, or move detail onto a lazier surface " +
  "(a sibling doc, a nested CLAUDE.md, a .claude/rules/ glob, or a skill). " +
  `See ${BOX_PACKAGE_DOCS}/reducing-claude-md.md for concrete strategies.`;

/**
 * Return a soft warning line if the CLAUDE.md is large, else null. Two tiers:
 * a gentle nudge at {@link CLAUDE_MD_WARN_CHARS}, firmer language at
 * {@link CLAUDE_MD_FIRM_CHARS}. `relPath` is used only to label the message.
 */
export function lintClaudeMdSize(relPath: string, content: string): string | null {
  const chars = content.length;
  if (chars < CLAUDE_MD_WARN_CHARS) return null;
  const kb = Math.round(Buffer.byteLength(content, "utf-8") / 1024);
  const size = `${String(chars)} chars (~${String(kb)} KB)`;
  if (chars >= CLAUDE_MD_FIRM_CHARS) {
    return (
      `warning  ${relPath}  [claude-md-size] ${size} — too large. CLAUDE.md loads into agent context ` +
      `every turn, and past ~${String(CLAUDE_MD_FIRM_CHARS)} chars Claude reliably drops instructions. ` +
      `Fix it now: ${MOVE_ADVICE}`
    );
  }
  return (
    `warning  ${relPath}  [claude-md-size] ${size} — getting large for a file loaded into context every ` +
    `turn; aim to stay under ~${String(CLAUDE_MD_WARN_CHARS)} chars (~200 lines). ${MOVE_ADVICE}`
  );
}

/** Read and size-lint one CLAUDE.md file. Missing/unreadable → null. */
export async function lintClaudeMdFile(boxRoot: string, absPath: string): Promise<string | null> {
  let content: string;
  try {
    content = await fs.readFile(absPath, "utf-8");
  } catch (_e) {
    // The file vanished between discovery and read, or isn't readable — nothing
    // actionable to warn about, so treat it as clean.
    return null;
  }
  return lintClaudeMdSize(path.relative(boxRoot, absPath), content);
}

/** Recursively find every CLAUDE.md in the box, skipping vendored/infra dirs. */
async function findClaudeMdFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null);
  if (entries === null) return [];
  const results: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        const sub = await findClaudeMdFiles(path.join(dir, entry.name));
        results.push(...sub);
      }
    } else if (entry.isFile() && entry.name === CLAUDE_MD) {
      results.push(path.join(dir, entry.name));
    }
  }
  return results.toSorted();
}

/** Size-lint every CLAUDE.md in the box; returns one warning line per oversized file. */
export async function lintAllClaudeMd(boxRoot: string): Promise<string[]> {
  const files = await findClaudeMdFiles(boxRoot);
  const warnings: string[] = [];
  for (const file of files) {
    const warning = await lintClaudeMdFile(boxRoot, file);
    if (warning !== null) warnings.push(warning);
  }
  return warnings;
}
