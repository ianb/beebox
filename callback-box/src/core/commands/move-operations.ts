/**
 * Core move operations: relocating a single card or an entire directory
 * and rewriting every affected cross-card reference.
 *
 * Beyond what cardworks' built-in move handles (card file + same-basename
 * siblings, including the `<basename>.attach/` directory, plus cross-card
 * refs that point at the moved card), these run a resolution-based ref
 * rewrite (rewrite-card-refs.ts) over every other card. That covers what
 * cardworks misses: refs written relative to the referring card, refs into
 * the moved attach scope, body Markdoc tag refs, inline markdown links, and
 * Phase-2 frontmatter cards cardworks can't parse.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CardLoader } from "cardworks";
import type { CommandContext } from "../command-runner.js";
import { attachDirFor } from "../../lib/attach-path.js";
import {
  rewriteReferrerRefs,
  rewriteMovedCardRefs,
  type Remap,
} from "../rewrite-card-refs.js";
import { isPhase2CardPath, movePhase2CardFiles } from "./move-phase2.js";

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

  // Rewrite refs from cards *outside* the moved directory that point into it
  // (relative or absolute), and recompute the moved cards' own *outgoing*
  // relative refs to targets that stayed outside.
  const loader = new CardLoader(ctx.boxRoot);
  const allCards = await loader.listCards();
  for (const cardPath of allCards) {
    const inside = cardPath === destPath || cardPath.startsWith(destPath + path.sep);
    try {
      const content = await fs.readFile(cardPath, "utf-8");
      const result = inside
        ? rewriteMovedCardRefs({
            boxRoot: ctx.boxRoot,
            oldCardAbs: sourcePath + cardPath.slice(destPath.length),
            newCardAbs: cardPath,
            text: content,
            remap,
          })
        : rewriteReferrerRefs({
            boxRoot: ctx.boxRoot,
            cardAbsPath: cardPath,
            text: content,
            remap,
          });
      if (result.count === 0 || result.text === content) continue;
      await fs.writeFile(cardPath, result.text);
      const relPath = path.relative(ctx.boxRoot, cardPath);
      updatedCards.push({ path: relPath, refsUpdated: result.count });
      filesToStage.push(relPath);
      ctx.writeLine(`  Updated ${result.count} ref${result.count > 1 ? "s" : ""} in ${relPath}`);
    } catch (e) {
      console.warn(`Skipping card that can't be read during ref rewrite: ${cardPath}:`, e);
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
 * Perform the actual file relocation for a single card, returning the moved
 * files and any references cardworks itself re-serialized.
 */
async function relocateCardFiles({
  ctx,
  loader,
  sourcePath,
  destPath,
}: {
  ctx: CommandContext;
  loader: CardLoader;
  sourcePath: string;
  destPath: string;
}): Promise<{
  movedFiles: Array<{ from: string; to: string }>;
  updatedCards: Array<{ path: string; refsUpdated: number }>;
}> {
  // Phase-2 cards: cardworks' XML-only loader can't parse them, so handle
  // the file + attach-dir rename ourselves. XML cards: delegate to cardworks
  // for the file moves and referrer re-serialization.
  if (isPhase2CardPath(sourcePath)) {
    return { movedFiles: await movePhase2CardFiles(sourcePath, destPath), updatedCards: [] };
  }
  const card = await loader.load(sourcePath);
  const { result } = await loader.move(card, destPath);
  return {
    movedFiles: result.movedFiles,
    updatedCards: result.updatedCards.map((u) => ({
      path: path.relative(ctx.boxRoot, u.path),
      refsUpdated: u.refsUpdated,
    })),
  };
}

/**
 * Rewrite refs in every *other* card that points at the moved card or into
 * its attach directory. Resolution-based (see rewrite-card-refs.ts), so refs
 * written relative to the referring card are caught — not just box-root
 * paths — and refs sitting in body Markdoc tags, inline markdown links, and
 * frontmatter alike. cardworks already re-serialized card-to-card refs in
 * XML referrers; this pass is idempotent over those and additionally covers
 * attach-scope refs and every Phase-2 card cardworks can't parse.
 */
async function rewriteOtherCards({
  ctx,
  loader,
  destPath,
  newAttachAbsDir,
  remap,
}: {
  ctx: CommandContext;
  loader: CardLoader;
  destPath: string;
  newAttachAbsDir: string;
  remap: Remap;
}): Promise<{
  extraStaged: string[];
  extraUpdated: Array<{ path: string; refsUpdated: number }>;
}> {
  const extraStaged: string[] = [];
  const extraUpdated: Array<{ path: string; refsUpdated: number }> = [];
  const allCards = await loader.listCards();
  for (const cardPath of allCards) {
    // Skip the moved card (handled separately) and cards that just moved into
    // the new attach scope (their internal refs travelled with them intact).
    if (cardPath === destPath) continue;
    if (cardPath.startsWith(newAttachAbsDir + path.sep)) continue;
    try {
      const original = await fs.readFile(cardPath, "utf-8");
      const { text: updated, count } = rewriteReferrerRefs({
        boxRoot: ctx.boxRoot,
        cardAbsPath: cardPath,
        text: original,
        remap,
      });
      if (count === 0 || updated === original) continue;
      await fs.writeFile(cardPath, updated);
      const relPath = path.relative(ctx.boxRoot, cardPath);
      extraUpdated.push({ path: relPath, refsUpdated: count });
      extraStaged.push(relPath);
      ctx.writeLine(`  Updated ${count} ref${count > 1 ? "s" : ""} in ${relPath}`);
    } catch (e) {
      console.warn(`Skipping card that can't be read during ref rewrite: ${cardPath}:`, e);
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

  // The loader is constructed unconditionally because `listCards()` is
  // needed for the ref rewrite pass below regardless of card kind.
  const loader = new CardLoader(ctx.boxRoot);
  const { movedFiles, updatedCards } = await relocateCardFiles({
    ctx,
    loader,
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

  const { extraStaged, extraUpdated } = await rewriteOtherCards({
    ctx,
    loader,
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
