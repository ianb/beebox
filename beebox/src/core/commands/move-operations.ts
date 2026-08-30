/**
 * Core move operations: relocating a single card or an entire directory
 * and rewriting every affected cross-card reference.
 *
 * Beyond what cardworks' built-in move handles (card file + same-basename
 * siblings, including the `<basename>.attach/` directory, plus cross-card
 * refs that point at the moved card), these run a resolution-based ref
 * rewrite (rewrite-card-refs.ts) over every other card *and plain `.md`
 * dossier*. That covers what cardworks misses: refs written relative to the
 * referring file, refs into the moved attach scope, body Markdoc tag refs,
 * inline markdown links (including in non-card dossiers), and Phase-2
 * frontmatter cards cardworks can't parse.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { CommandContext } from "../command-runner.js";
import { attachDirFor } from "../../shared/attach-path.js";
import { listBoxCardFiles, listBoxMarkdownFiles, listBoxViewFiles } from "../list-cards.js";
import {
  rewriteReferrerRefs,
  rewriteMovedCardRefs,
  rewriteViewRefs,
  type Remap,
} from "../rewrite-card-refs.js";
import { movePhase2CardFiles } from "./move-phase2.js";

export interface MoveOneResult {
  from: string;
  to: string;
  movedFiles: Array<{ from: string; to: string }>;
  updatedCards: Array<{ path: string; refsUpdated: number }>;
  filesToStage: string[];
}

interface MoveDirResult {
  from: string;
  to: string;
  filesToStage: string[];
  updatedCards: Array<{ path: string; refsUpdated: number }>;
}

interface MoveDirParams {
  ctx: CommandContext;
  sourcePath: string;
  destPath: string;
}

interface MoveOneParams {
  ctx: CommandContext;
  sourcePath: string;
  destPath: string;
}

/**
 * Remove empty ancestor directories up to (but not including) stopAt.
 * Walks up from dirPath, removing each directory if empty, stopping
 * when it reaches stopAt or a non-empty directory.
 */
async function removeEmptyAncestors(
  dirPath: string,
  stopAt: string
): Promise<void> {
  let current = dirPath;
  while (current !== stopAt && current.startsWith(stopAt + "/")) {
    try {
      const entries = await fs.readdir(current);
      if (entries.length > 0) break;
      await fs.rmdir(current);
    } catch (e) {
      console.warn(`Stopping ancestor cleanup at ${current}:`, e);
      break;
    }
    current = path.dirname(current);
  }
}

/**
 * Move an entire directory (e.g., a capture session) and update external references.
 */
export async function moveDir(params: MoveDirParams): Promise<MoveDirResult> {
  const { ctx, sourcePath, destPath } = params;
  const relSourcePath = path.relative(ctx.boxRoot, sourcePath);
  const relDestPath = path.relative(ctx.boxRoot, destPath);

  // Move the directory
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.rename(sourcePath, destPath);
  ctx.writeLine(`Moved directory: ${relSourcePath} → ${relDestPath}`);

  const filesToStage: string[] = [];
  const updatedCards: Array<{ path: string; refsUpdated: number }> = [];

  // Anything that resolved under the old directory now lives under the new one.
  const remap: Remap = (abs) => {
    if (abs === sourcePath) return destPath;
    if (abs.startsWith(sourcePath + path.sep)) {
      return destPath + abs.slice(sourcePath.length);
    }
    return null;
  };

  // Rewrite refs from documents *outside* the moved directory that point into
  // it (relative or absolute), and recompute the moved documents' own
  // *outgoing* relative refs to targets that stayed outside. Plain `.md`
  // dossiers are walked alongside cards for the same reason `moveOne` walks
  // them: a dossier linking into a directory that moved is exactly how those
  // links went stale.
  const referrers = [
    ...(await listBoxCardFiles(ctx.boxRoot)),
    ...(await listBoxMarkdownFiles(ctx.boxRoot)),
  ];
  for (const filePath of referrers) {
    const inside = filePath === destPath || filePath.startsWith(destPath + path.sep);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const result = inside
        ? rewriteMovedCardRefs({
            boxRoot: ctx.boxRoot,
            oldCardAbs: sourcePath + filePath.slice(destPath.length),
            newCardAbs: filePath,
            text: content,
            remap,
          })
        : rewriteReferrerRefs({
            boxRoot: ctx.boxRoot,
            cardAbsPath: filePath,
            text: content,
            remap,
          });
      if (result.count === 0 || result.text === content) continue;
      await fs.writeFile(filePath, result.text);
      const relPath = path.relative(ctx.boxRoot, filePath);
      updatedCards.push({ path: relPath, refsUpdated: result.count });
      filesToStage.push(relPath);
      ctx.writeLine(`  Updated ${result.count} ref${result.count > 1 ? "s" : ""} in ${relPath}`);
    } catch (e) {
      console.warn(`File unreadable during ref rewrite, skipped: ${filePath}:`, e);
    }
  }

  // Box-authored views that point into the moved directory via `cardRef="…"`.
  for (const viewPath of await listBoxViewFiles(ctx.boxRoot)) {
    try {
      const content = await fs.readFile(viewPath, "utf-8");
      const result = rewriteViewRefs({ boxRoot: ctx.boxRoot, viewAbsPath: viewPath, text: content, remap });
      if (result.count === 0 || result.text === content) continue;
      await fs.writeFile(viewPath, result.text);
      const relPath = path.relative(ctx.boxRoot, viewPath);
      updatedCards.push({ path: relPath, refsUpdated: result.count });
      filesToStage.push(relPath);
      ctx.writeLine(`  Updated ${result.count} ref${result.count > 1 ? "s" : ""} in ${relPath}`);
    } catch (e) {
      console.warn(`Skipping view that can't be read during ref rewrite: ${viewPath}:`, e);
    }
  }

  // Clean up empty parent of source directory
  await removeEmptyAncestors(path.dirname(sourcePath), ctx.boxRoot);

  // Stage old directory removal and new directory addition
  // git add with the old path marks it as deleted, new path as added
  filesToStage.push(relSourcePath);
  filesToStage.push(relDestPath);

  return {
    from: relSourcePath,
    to: relDestPath,
    filesToStage,
    updatedCards,
  };
}

/**
 * Perform the actual file relocation for a single card: rename the `.card`
 * file and its sibling `<basename>.attach/` directory. Every card is
 * frontmatter, so the substring ref-rewrite pass (rewriteOtherReferrers) handles
 * all referrer updates — there's nothing to re-serialize.
 */
async function relocateCardFiles({
  sourcePath,
  destPath,
}: {
  sourcePath: string;
  destPath: string;
}): Promise<{
  movedFiles: Array<{ from: string; to: string }>;
  updatedCards: Array<{ path: string; refsUpdated: number }>;
}> {
  return { movedFiles: await movePhase2CardFiles(sourcePath, destPath), updatedCards: [] };
}

/**
 * Rewrite refs in every *other* referrer — card or plain `.md` dossier — that
 * points at the moved card or into its attach directory. Resolution-based (see
 * rewrite-card-refs.ts), so refs written relative to the referring file are
 * caught — not just box-root paths — and refs sitting in body Markdoc tags,
 * inline markdown links, and frontmatter alike. Markdown dossiers (e.g. a
 * notebook character sheet that embeds `/store/.../images/...`) are included
 * because a `bbx mv` that didn't rewrite their links is exactly how those links
 * went stale; the rewrite touches only inline links since plain `.md` has no
 * frontmatter to re-serialize.
 */
async function rewriteOtherReferrers({
  ctx,
  destPath,
  newAttachAbsDir,
  remap,
}: {
  ctx: CommandContext;
  destPath: string;
  newAttachAbsDir: string;
  remap: Remap;
}): Promise<{
  extraStaged: string[];
  extraUpdated: Array<{ path: string; refsUpdated: number }>;
}> {
  const extraStaged: string[] = [];
  const extraUpdated: Array<{ path: string; refsUpdated: number }> = [];
  const referrers = [
    ...(await listBoxCardFiles(ctx.boxRoot)),
    ...(await listBoxMarkdownFiles(ctx.boxRoot)),
    ...(await listBoxViewFiles(ctx.boxRoot)),
  ];
  for (const referrerPath of referrers) {
    // Skip the moved card (handled separately) and files that just moved into
    // the new attach scope (their internal refs travelled with them intact).
    if (referrerPath === destPath) continue;
    if (referrerPath.startsWith(newAttachAbsDir + path.sep)) continue;
    try {
      const original = await fs.readFile(referrerPath, "utf-8");
      // Views carry refs only in `cardRef="…"` widget attributes; cards/markdown
      // carry them in frontmatter, markdown links, and body `ref=` tags.
      const { text: updated, count } = referrerPath.endsWith(".tsx")
        ? rewriteViewRefs({
            boxRoot: ctx.boxRoot,
            viewAbsPath: referrerPath,
            text: original,
            remap,
          })
        : rewriteReferrerRefs({
            boxRoot: ctx.boxRoot,
            cardAbsPath: referrerPath,
            text: original,
            remap,
          });
      if (count === 0 || updated === original) continue;
      await fs.writeFile(referrerPath, updated);
      const relPath = path.relative(ctx.boxRoot, referrerPath);
      extraUpdated.push({ path: relPath, refsUpdated: count });
      extraStaged.push(relPath);
      ctx.writeLine(`  Updated ${count} ref${count > 1 ? "s" : ""} in ${relPath}`);
    } catch (e) {
      console.warn(`Skipping file that can't be read during ref rewrite: ${referrerPath}:`, e);
    }
  }
  return { extraStaged, extraUpdated };
}

/**
 * Recompute the moved card's own *relative* refs to cards that stayed put,
 * from its new location (absolute and `attach/` refs are unaffected).
 */
async function relocateMovedCardRefs({
  ctx,
  sourcePath,
  destPath,
  remap,
}: {
  ctx: CommandContext;
  sourcePath: string;
  destPath: string;
  remap: Remap;
}): Promise<void> {
  try {
    const movedText = await fs.readFile(destPath, "utf-8");
    const { text: relocated, count } = rewriteMovedCardRefs({
      boxRoot: ctx.boxRoot,
      oldCardAbs: sourcePath,
      newCardAbs: destPath,
      text: movedText,
      remap,
    });
    if (count > 0 && relocated !== movedText) {
      await fs.writeFile(destPath, relocated);
      ctx.writeLine(`  Rewrote ${count} relative ref${count > 1 ? "s" : ""} in the moved card`);
    }
  } catch (e) {
    console.warn(`Moved card unreadable; nothing to relocate: ${destPath}:`, e);
  }
}

function reportMove({
  ctx,
  relSourcePath,
  relDestPath,
  sourcePath,
  movedFiles,
  updatedCards,
}: {
  ctx: CommandContext;
  relSourcePath: string;
  relDestPath: string;
  sourcePath: string;
  movedFiles: Array<{ from: string; to: string }>;
  updatedCards: Array<{ path: string; refsUpdated: number }>;
}): void {
  ctx.writeLine(`Moved: ${relSourcePath} → ${relDestPath}`);

  for (const file of movedFiles) {
    if (file.from !== sourcePath) {
      const relFrom = path.relative(ctx.boxRoot, file.from);
      const relTo = path.relative(ctx.boxRoot, file.to);
      ctx.writeLine(`  Also moved: ${relFrom} → ${relTo}`);
    }
  }

  if (updatedCards.length > 0) {
    ctx.writeLine(`Updated references in ${updatedCards.length} card(s):`);
    for (const update of updatedCards) {
      ctx.writeLine(`  ${update.path} (${update.refsUpdated} ref${update.refsUpdated > 1 ? "s" : ""})`);
    }
  }
}

/**
 * Move a single card, returning structured results. See module header and
 * the helper docstrings for the ref-rewrite strategy.
 */
export async function moveOne(params: MoveOneParams): Promise<MoveOneResult> {
  const { ctx, sourcePath, destPath } = params;
  const relSourcePath = path.relative(ctx.boxRoot, sourcePath);
  const relDestPath = path.relative(ctx.boxRoot, destPath);

  const oldAttachAbsDir = attachDirFor(sourcePath);
  const newAttachAbsDir = attachDirFor(destPath);

  const { movedFiles, updatedCards } = await relocateCardFiles({
    sourcePath,
    destPath,
  });

  reportMove({ ctx, relSourcePath, relDestPath, sourcePath, movedFiles, updatedCards });

  const remap: Remap = (abs) => {
    if (abs === sourcePath) return destPath;
    if (abs === oldAttachAbsDir) return newAttachAbsDir;
    if (abs.startsWith(oldAttachAbsDir + path.sep)) {
      return newAttachAbsDir + abs.slice(oldAttachAbsDir.length);
    }
    return null;
  };

  const { extraStaged, extraUpdated } = await rewriteOtherReferrers({
    ctx,
    destPath,
    newAttachAbsDir,
    remap,
  });

  await relocateMovedCardRefs({ ctx, sourcePath, destPath, remap });

  // Clean up empty source directory
  await removeEmptyAncestors(path.dirname(sourcePath), ctx.boxRoot);

  const filesToStage: string[] = [];
  for (const file of movedFiles) {
    filesToStage.push(path.relative(ctx.boxRoot, file.from));
    filesToStage.push(path.relative(ctx.boxRoot, file.to));
  }
  for (const update of updatedCards) {
    filesToStage.push(update.path);
  }
  filesToStage.push(...extraStaged);

  return {
    from: relSourcePath,
    to: relDestPath,
    movedFiles: movedFiles.map((f) => ({
      from: path.relative(ctx.boxRoot, f.from),
      to: path.relative(ctx.boxRoot, f.to),
    })),
    updatedCards: [...updatedCards, ...extraUpdated],
    filesToStage,
  };
}
