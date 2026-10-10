/**
 * The template tracker's sibling-key rule. While boxes move from `CLAUDE.md`
 * to `AGENTS.md` (the `agents-md-2026-10` migration), the ledger
 * (`_config/template-versions.json`) and the parked copies treat
 * `<dir>/CLAUDE.md` and `<dir>/AGENTS.md` as one entry: a lookup for either
 * finds whichever key exists, and a write keeps that key. Only instruction-file
 * basenames have a sibling. Pre-migration support, removed once every box is
 * converted.
 */

import * as path from "node:path";
import { fileExists } from "../lib/file-exists.js";
import { instructionSiblingPath } from "./agent-instruction-files.js";
import { GUIDANCE_SURFACES, guidancePathPattern } from "./box/guidance-surfaces.js";
import type { VersionsFile } from "./install-template-file.js";

/**
 * The ledger key for `relPath`: itself, or its instruction-file sibling when
 * only the sibling has an entry.
 */
export function ledgerKey(versions: VersionsFile, relPath: string): string {
  if (Object.hasOwn(versions, relPath)) return relPath;
  const sibling = instructionSiblingPath(relPath);
  return sibling !== null && Object.hasOwn(versions, sibling) ? sibling : relPath;
}

/** `relPath` and, for an instruction file, its sibling: every key a removal clears. */
export function instructionSiblings(relPath: string): string[] {
  const sibling = instructionSiblingPath(relPath);
  return sibling === null ? [relPath] : [relPath, sibling];
}

/**
 * `relPath`, or its instruction-file sibling when only the sibling exists
 * under `baseAbs`. With the box root it finds the file on disk; with the
 * parked-updates root it finds the parked copy.
 */
export async function existingSiblingPath(baseAbs: string, relPath: string): Promise<string> {
  const sibling = instructionSiblingPath(relPath);
  if (sibling === null || await fileExists(path.join(baseAbs, relPath))) return relPath;
  return await fileExists(path.join(baseAbs, sibling)) ? sibling : relPath;
}

/**
 * The legacy `CLAUDE.md` spelling of each tracked instruction guide (the
 * registry names `AGENTS.md`). A box not yet converted still installs and
 * edits its guide there, and `generateDocs` must still commit it.
 */
export const LEGACY_INSTRUCTION_PATTERNS: readonly RegExp[] = GUIDANCE_SURFACES
  .filter((row) => row.gitTracked && row.class === "tracked")
  .flatMap((row) => {
    const sibling = instructionSiblingPath(row.path);
    return sibling === null ? [] : [guidancePathPattern(sibling)];
  });
