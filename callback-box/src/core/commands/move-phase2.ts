/**
 * Phase-2 card file moving.
 *
 * Cardworks' `loader.load()` parses card bodies as XML — fine for the
 * legacy XML schemas (procedure, guide, landmark, capture-session,
 * procedure-run) but not for Phase-2 frontmatter+markdown cards
 * (doc, briefing, memo, recipe, …). For Phase-2 cards we have to do
 * the move ourselves; the substring rewrite pass in the move command
 * picks up ref updates in every other card regardless of card kind.
 *
 * Detect by extracting the type from the filename and checking it
 * against the registered Phase-2 card schemas. Anything else (XML
 * card, plain file, unknown type) falls through to the cardworks
 * loader path.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { attachDirFor } from "../../shared/attach-path.js";
import { cardSchemas } from "../../schemas/registry.js";

const PHASE2_TYPES = new Set(cardSchemas.map((s) => s.type));

class AttachDirRenameError extends Error {
  readonly from: string;
  readonly to: string;
  constructor({ from, to, cause }: { from: string; to: string; cause: unknown }) {
    super(`failed to rename attach directory: ${from} → ${to}`, { cause });
    this.name = "AttachDirRenameError";
    this.from = from;
    this.to = to;
  }
}

function cardTypeFromPath(p: string): string | undefined {
  const base = p.split("/").pop() ?? p;
  const match = /^.+\.([^.]+)\.card$/.exec(base);
  if (match === null) return undefined;
  return match[1];
}

/**
 * Whether a path names a Phase-2 frontmatter+markdown card (vs. a legacy
 * XML card, plain file, or unknown type).
 */
export function isPhase2CardPath(p: string): boolean {
  const type = cardTypeFromPath(p);
  return type !== undefined && PHASE2_TYPES.has(type);
}

/**
 * Rename a file and (if present) its sibling `<basename>.attach/`
 * directory atomically — the Phase-2 analogue of what cardworks'
 * `loader.move()` does for XML cards. Returns the list of moved
 * file paths in the same `{from, to}` shape cardworks emits.
 */
export async function movePhase2CardFiles(
  sourcePath: string,
  destPath: string,
): Promise<Array<{ from: string; to: string }>> {
  const moved: Array<{ from: string; to: string }> = [];
  const oldAttach = attachDirFor(sourcePath);
  const newAttach = attachDirFor(destPath);
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.rename(sourcePath, destPath);
  moved.push({ from: sourcePath, to: destPath });
  if (oldAttach !== newAttach) {
    try {
      await fs.rename(oldAttach, newAttach);
      moved.push({ from: oldAttach, to: newAttach });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") throw new AttachDirRenameError({ from: oldAttach, to: newAttach, cause: err });
      // No attach dir to move; fine.
    }
  }
  return moved;
}
