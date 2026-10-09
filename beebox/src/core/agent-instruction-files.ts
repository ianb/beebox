/**
 * The filenames a harness reads box instructions from, and which one a writer
 * uses.
 *
 * `AGENTS.md` is the authored instruction file: Claude Code and Codex both
 * read it. A box made before the `agents-md-2026-10` migration authors
 * `CLAUDE.md` instead, with an `AGENTS.md` symlink beside each one
 * (`agent-context-mirrors.ts`) so Codex finds the same content. Until that
 * migration runs, writers go through {@link instructionFilePath}, which keeps
 * an unconverted box on `CLAUDE.md`.
 *
 * Code that RECOGNIZES instruction files over a directory listing uses
 * {@link AGENT_INSTRUCTION_FILES}, because a listing may show any of the
 * names. A bare `=== "CLAUDE.md"` there silently ignores the others, which is
 * how the map precheck once demanded every MAP list a symlink to the file it
 * excluded on the line above.
 */

import type { Stats } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../shared/error-guards.js";
import { hasAppliedMigration } from "./migration-manifest.js";

/** The legacy instruction file: authored in a box not yet converted. */
export const CLAUDE_MD = "CLAUDE.md";

/** The authored instruction file. In an unconverted box, a symlink to the sibling CLAUDE.md. */
export const AGENTS_MD = "AGENTS.md";

/** Claude Code's personal, uncommitted instruction file. */
export const CLAUDE_LOCAL_MD = "CLAUDE.local.md";

/** Every instruction-file name, for membership tests over directory entries. */
export const AGENT_INSTRUCTION_FILES: readonly string[] = [CLAUDE_MD, AGENTS_MD, CLAUDE_LOCAL_MD];

/**
 * The migration that renames a box's `CLAUDE.md` files to `AGENTS.md`. A box
 * whose manifest records it is "converted".
 */
export const AGENTS_MD_MIGRATION = "agents-md-2026-10";

/** Any harness's instruction file — instructions, not linkable content. */
export function isAgentInstructionsFile(filePath: string): boolean {
  return AGENT_INSTRUCTION_FILES.includes(path.basename(filePath));
}

/**
 * The other spelling of an instruction-file path: `<dir>/AGENTS.md` for
 * `<dir>/CLAUDE.md` and the reverse, or null for any other path. The template
 * ledger and parked copies treat the two as one entry while boxes convert.
 */
export function instructionSiblingPath(relPath: string): string | null {
  const base = path.posix.basename(relPath);
  const other = base === CLAUDE_MD ? AGENTS_MD : base === AGENTS_MD ? CLAUDE_MD : null;
  if (other === null) return null;
  const dir = path.posix.dirname(relPath);
  return dir === "." ? other : `${dir}/${other}`;
}

/** Whether the box has run {@link AGENTS_MD_MIGRATION}. */
export async function isAgentsMdBox(boxRoot: string): Promise<boolean> {
  return hasAppliedMigration(boxRoot, AGENTS_MD_MIGRATION);
}

async function lstatOrNull(absPath: string): Promise<Stats | null> {
  try {
    return await fs.lstat(absPath);
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
}

/**
 * The box-relative instruction file a writer uses for directory `dirRel`
 * (`""` for the box root). An existing `CLAUDE.md` wins; else an existing real
 * `AGENTS.md` (a symlink there is the old mirror, not an authored file); else
 * the box-level name from {@link instructionFileName}.
 */
export async function instructionFilePath(boxRoot: string, dirRel: string): Promise<string> {
  const rel = (name: string): string => (dirRel === "" ? name : path.posix.join(dirRel, name));
  if ((await lstatOrNull(path.join(boxRoot, dirRel, CLAUDE_MD))) !== null) return rel(CLAUDE_MD);
  if ((await lstatOrNull(path.join(boxRoot, dirRel, AGENTS_MD)))?.isFile() === true) return rel(AGENTS_MD);
  return rel(await instructionFileName(boxRoot));
}

/** The instruction-file name for this box: `AGENTS.md` once converted, `CLAUDE.md` before. */
export async function instructionFileName(boxRoot: string): Promise<string> {
  return (await isAgentsMdBox(boxRoot)) ? AGENTS_MD : CLAUDE_MD;
}
