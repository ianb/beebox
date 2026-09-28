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
import { randomUUID } from "node:crypto";
import { attachDirFor } from "../../shared/attach-path.js";
import { errnoCode } from "../../shared/error-guards.js";
import { isCardFile } from "../../lib/paths/core.js";

async function isAnnexObjectPath(target: string, sourcePath: string): Promise<boolean> {
  const resolved = path.resolve(target);
  for (let ancestor = path.dirname(sourcePath); ; ancestor = path.dirname(ancestor)) {
    const objects = path.join(ancestor, ".git", "annex", "objects");
    if (resolved.startsWith(`${objects}${path.sep}`)) {
      try {
        if ((await fs.stat(objects)).isDirectory()) return true;
      } catch (error) {
        if (errnoCode(error) !== "ENOENT") throw error;
      }
    }
    if (path.dirname(ancestor) === ancestor) return false;
  }
}

class AnnexPreservingMoveError extends Error {
  readonly from: string;
  readonly to: string;
  readonly reason: "destination-exists" | "paths-missing";
  constructor({ from, to, reason }: { from: string; to: string; reason: "destination-exists" | "paths-missing" }) {
    super(reason === "destination-exists" ? "move destination already exists" : "move source and destination are missing");
    this.name = "AnnexPreservingMoveError";
    this.from = from;
    this.to = to;
    this.reason = reason;
  }
}

async function annexSymlinks({ root, oldRoot, sourceExists }: { root: string; oldRoot: string; sourceExists: boolean }): Promise<Array<{ relative: string; target: string }>> {
  const found: Array<{ relative: string; target: string }> = [];
  async function visit(current: string, relative: string): Promise<void> {
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) {
      const link = await fs.readlink(current);
      if (!path.isAbsolute(link)) {
        const currentTarget = path.resolve(path.dirname(current), link);
        // Recovery may be repeated after a previous attempt already repaired
        // this link. Its current target is authoritative in that case.
        if (!sourceExists && await isAnnexObjectPath(currentTarget, oldRoot)) return;
        // During explicit recovery, the link is already at `root`, but its
        // unchanged relative text still describes the target from `oldRoot`.
        const base = path.join(oldRoot, relative);
        const target = sourceExists ? currentTarget : path.resolve(path.dirname(base), link);
        if (await isAnnexObjectPath(target, oldRoot)) found.push({ relative, target });
      }
      return;
    }
    if (!stat.isDirectory()) return;
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      await visit(path.join(current, entry.name), path.join(relative, entry.name));
    }
  }
  await visit(root, "");
  return found;
}

/** Move a file or directory while keeping relative git-annex object links valid.
 * If a previous attempt already renamed it, calling again repairs those links.
 */
export async function movePathPreservingAnnexSymlink(from: string, to: string): Promise<void> {
  let sourceExists = true;
  try { await fs.lstat(from); }
  catch (error) {
    if (errnoCode(error) !== "ENOENT") throw error;
    sourceExists = false;
  }
  let destinationExists = true;
  try { await fs.lstat(to); }
  catch (error) {
    if (errnoCode(error) !== "ENOENT") throw error;
    destinationExists = false;
  }
  if (sourceExists && destinationExists) throw new AnnexPreservingMoveError({ from, to, reason: "destination-exists" });
  if (!sourceExists && !destinationExists) throw new AnnexPreservingMoveError({ from, to, reason: "paths-missing" });

  const links = await annexSymlinks({ root: sourceExists ? from : to, oldRoot: from, sourceExists });
  if (sourceExists) {
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
  }
  for (const { relative, target } of links) {
    const movedLink = path.join(to, relative);
    const temporaryLink = path.join(path.dirname(movedLink), `.${path.basename(movedLink)}.${randomUUID()}.tmp`);
    await fs.symlink(path.relative(path.dirname(movedLink), target), temporaryLink);
    try {
      await fs.rename(temporaryLink, movedLink);
    } catch (error) {
      await fs.rm(temporaryLink, { force: true }).catch(() => {
        // Preserve the rename error if temporary-link cleanup also fails.
      });
      throw error;
    }
  }
}

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
 * Rename a file and (if present) its sibling `<basename>.attach/`
 * directory in separate renames — the Phase-2 analogue of what cardworks'
 * `loader.move()` does for XML cards. Returns the list of moved
 * file paths in the same `{from, to}` shape cardworks emits.
 */
export async function movePhase2CardFiles(
  sourcePath: string,
  destPath: string,
): Promise<Array<{ from: string; to: string }>> {
  const moved: Array<{ from: string; to: string }> = [];
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await movePathPreservingAnnexSymlink(sourcePath, destPath);
  moved.push({ from: sourcePath, to: destPath });
  // Only a card has an attach scope; a plain `.md` file moves alone.
  if (!isCardFile(sourcePath)) return moved;
  const oldAttach = attachDirFor(sourcePath);
  const newAttach = attachDirFor(destPath);
  if (oldAttach !== newAttach) {
    try {
      await fs.lstat(oldAttach);
      await movePathPreservingAnnexSymlink(oldAttach, newAttach);
      moved.push({ from: oldAttach, to: newAttach });
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") throw new AttachDirRenameError({ from: oldAttach, to: newAttach, cause: e });
      // No attach dir to move; fine.
    }
  }
  return moved;
}
