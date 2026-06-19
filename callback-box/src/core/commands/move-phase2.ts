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
 * Every card is YAML-frontmatter, so a card move is always a file +
 * attach-dir rename; referrer ref updates are handled by the substring
 * rewrite pass in move-operations.ts.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { attachDirFor } from "../../shared/attach-path.js";

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

/**
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
