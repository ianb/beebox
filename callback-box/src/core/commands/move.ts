/**
 * Move command - Move/rename a card and update all references.
 *
 * Uses cardworks' move functionality to handle:
 * - Moving the card file itself
 * - Moving related files (attachments with same basename)
 * - Updating all references from other cards
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CardLoader } from "cardworks";
import {
  registerCommand,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { isCardFile, boxPath } from "../../cli/lib/paths.js";
import { stageFiles, commit } from "../../cli/lib/git.js";
import { attachDirFor } from "../../lib/attach-path.js";
import { cardSchemas } from "../../schemas/registry.js";
import {
  rewriteReferrerRefs,
  rewriteMovedCardRefs,
  type Remap,
} from "../rewrite-card-refs.js";

/**
 * Cardworks' `loader.load()` parses card bodies as XML — fine for the
 * legacy XML schemas (procedure, guide, landmark, capture-session,
 * procedure-run) but not for Phase-2 frontmatter+markdown cards
 * (doc, briefing, memo, recipe, …). For Phase-2 cards we have to do
 * the move ourselves; the substring rewrite pass below picks up ref
 * updates in every other card regardless of card kind.
 *
 * Detect by extracting the type from the filename and checking it
 * against the registered Phase-2 card schemas. Anything else (XML
 * card, plain file, unknown type) falls through to the cardworks
 * loader path.
 */
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

function isPhase2CardPath(p: string): boolean {
  const type = cardTypeFromPath(p);
  return type !== undefined && PHASE2_TYPES.has(type);
}

/**
 * Rename a file and (if present) its sibling `<basename>.attach/`
 * directory atomically — the Phase-2 analogue of what cardworks'
 * `loader.move()` does for XML cards. Returns the list of moved
 * file paths in the same `{from, to}` shape cardworks emits.
 */
async function movePhase2CardFiles(
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
 * Arguments for the move command.
 */
export interface MoveArgs {
  /** Path(s) to the card(s) to move (relative to box root or absolute) */
  from: string | string[];
  /** Destination path (relative to box root or absolute) */
  to: string;
  /** Whether to commit the change */
  commit?: boolean;
  /** Show what would happen without doing it */
  dryRun?: boolean;
}

interface MoveOneResult {
  from: string;
  to: string;
  movedFiles: Array<{ from: string; to: string }>;
  updatedCards: Array<{ path: string; refsUpdated: number }>;
  filesToStage: string[];
}

/**
 * Check if a destination path looks like a directory (not a specific card file).
 */
function isDirectoryDest(destPath: string): boolean {
  return destPath.endsWith("/") || !destPath.includes(".card");
}

/**
 * Check if a path is an existing directory.
 */
async function isDirectory(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isDirectory();
  } catch (_e) {
    // stat throws ENOENT when the path doesn't exist; "not a directory"
    // is the correct answer and the specific error carries nothing useful.
    return false;
  }
}

interface MoveDirResult {
  from: string;
  to: string;
  filesToStage: string[];
  updatedCards: Array<{ path: string; refsUpdated: number }>;
}

/**
 * Parameters for moveDir
 */
interface MoveDirParams {
  ctx: CommandContext;
  sourcePath: string;
  destPath: string;
}

/**
 * Move an entire directory (e.g., a capture session) and update external references.
 */
async function moveDir(params: MoveDirParams): Promise<MoveDirResult> {
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
 * Parameters for moveOne
 */
interface MoveOneParams {
  ctx: CommandContext;
  sourcePath: string;
  destPath: string;
}

/**
 * Move a single card, returning structured results.
 *
 * Beyond what cardworks' built-in move handles (card file + same-basename
 * siblings, including the `<basename>.attach/` directory, plus cross-card
 * refs that point at the moved card), this runs a resolution-based ref
 * rewrite (rewrite-card-refs.ts) over every other card. That covers what
 * cardworks misses: refs written relative to the referring card, refs into
 * the moved attach scope, body Markdoc tag refs, inline markdown links, and
 * Phase-2 frontmatter cards cardworks can't parse. The moved card's own
 * relative refs are recomputed for its new location too.
 */
async function moveOne(params: MoveOneParams): Promise<MoveOneResult> {
  const { ctx, sourcePath, destPath } = params;
  const relSourcePath = path.relative(ctx.boxRoot, sourcePath);
  const relDestPath = path.relative(ctx.boxRoot, destPath);

  const oldAttachAbsDir = attachDirFor(sourcePath);
  const newAttachAbsDir = attachDirFor(destPath);

  // Phase-2 cards: cardworks' XML-only loader can't parse them, so handle
  // the file + attach-dir rename ourselves. Cross-card ref updates come
  // from the resolution-based rewrite pass below, which handles every card
  // kind. XML cards: delegate to cardworks for the file moves and referrer
  // re-serialization (the pass below is idempotent over what it already did).
  //
  // The loader is constructed unconditionally because `listCards()` is
  // needed for the ref rewrite pass below regardless of card kind.
  const loader = new CardLoader(ctx.boxRoot);
  let movedFiles: Array<{ from: string; to: string }>;
  let updatedCards: Array<{ path: string; refsUpdated: number }> = [];

  if (isPhase2CardPath(sourcePath)) {
    movedFiles = await movePhase2CardFiles(sourcePath, destPath);
  } else {
    const card = await loader.load(sourcePath);
    const { result } = await loader.move(card, destPath);
    movedFiles = result.movedFiles;
    updatedCards = result.updatedCards.map((u) => ({
      path: path.relative(ctx.boxRoot, u.path),
      refsUpdated: u.refsUpdated,
    }));
  }

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

  // Rewrite refs in every *other* card that points at the moved card or into
  // its attach directory. Resolution-based (see rewrite-card-refs.ts), so refs
  // written relative to the referring card are caught — not just box-root
  // paths — and refs sitting in body Markdoc tags, inline markdown links, and
  // frontmatter alike. cardworks already re-serialized card-to-card refs in
  // XML referrers; this pass is idempotent over those (the ref now resolves to
  // the new location, which `remap` leaves alone) and additionally covers
  // attach-scope refs and every Phase-2 card cardworks can't parse.
  const remap: Remap = (abs) => {
    if (abs === sourcePath) return destPath;
    if (abs === oldAttachAbsDir) return newAttachAbsDir;
    if (abs.startsWith(oldAttachAbsDir + path.sep)) {
      return newAttachAbsDir + abs.slice(oldAttachAbsDir.length);
    }
    return null;
  };

  const extraStaged: string[] = [];
  const extraUpdated: Array<{ path: string; refsUpdated: number }> = [];
  const allCards = await loader.listCards();
  for (const cardPath of allCards) {
    // Skip the moved card (handled below) and cards that just moved into the
    // new attach scope (their internal refs travelled with them intact).
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

  // The moved card relocated, so its own *relative* refs to cards that stayed
  // put must be recomputed from the new location (absolute and `attach/` refs
  // are unaffected and left as-is).
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

/**
 * Execute the move command (supports single or multiple source paths).
 */
async function executeMove(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const moveArgs = args as unknown as MoveArgs;

  if (!moveArgs.from || !moveArgs.to) {
    return { success: false, error: "Both 'from' and 'to' paths are required" };
  }

  // Normalize from to an array
  const fromPaths = Array.isArray(moveArgs.from) ? moveArgs.from : [moveArgs.from];

  // Resolve destination path
  let rawDestPath: string;
  if (path.isAbsolute(moveArgs.to)) {
    rawDestPath = moveArgs.to;
  } else {
    rawDestPath = boxPath(ctx.boxRoot, moveArgs.to);
  }

  const destIsDir = isDirectoryDest(rawDestPath);

  // Multiple sources require a directory destination
  if (fromPaths.length > 1 && !destIsDir) {
    return { success: false, error: "Moving multiple cards requires a directory destination" };
  }

  const results: MoveOneResult[] = [];
  const allFilesToStage: string[] = [];
  const errors: string[] = [];

  for (const fromPath of fromPaths) {
    // Resolve source path
    let sourcePath: string;
    if (path.isAbsolute(fromPath)) {
      sourcePath = fromPath;
    } else {
      sourcePath = boxPath(ctx.boxRoot, fromPath);
    }

    const sourceIsDir = await isDirectory(sourcePath);

    if (!isCardFile(sourcePath) && !sourceIsDir) {
      errors.push(`Source must be a .card file or directory: ${fromPath}`);
      ctx.writeLine(`Error: Source must be a .card file or directory: ${fromPath}`);
      continue;
    }

    if (sourceIsDir) {
      // Directory rename vs move-into: if dest already exists as a directory,
      // move source inside it. Otherwise treat dest as the new name.
      const destExists = await isDirectory(rawDestPath);
      const destPath = destExists
        ? path.join(rawDestPath, path.basename(sourcePath))
        : rawDestPath;

      if (moveArgs.dryRun) {
        const relSource = path.relative(ctx.boxRoot, sourcePath);
        const relDest = path.relative(ctx.boxRoot, destPath);
        ctx.writeLine(`Would move directory: ${relSource} → ${relDest}`);
        continue;
      }

      try {
        const dirResult = await moveDir({ ctx, sourcePath, destPath });
        results.push({
          from: dirResult.from,
          to: dirResult.to,
          movedFiles: [{ from: dirResult.from, to: dirResult.to }],
          updatedCards: dirResult.updatedCards,
          filesToStage: dirResult.filesToStage,
        });
        allFilesToStage.push(...dirResult.filesToStage);
      } catch (err) {
        errors.push(`Failed to move directory ${fromPath}: ${(err as Error).message}`);
        ctx.writeLine(`Error: Failed to move directory ${fromPath}: ${(err as Error).message}`);
      }
      continue;
    }

    // Card file move
    let destPath = rawDestPath;
    if (destIsDir) {
      destPath = path.join(rawDestPath, path.basename(sourcePath));
    }

    if (!isCardFile(destPath)) {
      errors.push(`Destination must be a .card file: ${destPath}`);
      ctx.writeLine(`Error: Destination must be a .card file: ${destPath}`);
      continue;
    }

    if (moveArgs.dryRun) {
      const relSource = path.relative(ctx.boxRoot, sourcePath);
      const relDest = path.relative(ctx.boxRoot, destPath);
      ctx.writeLine(`Would move: ${relSource} → ${relDest}`);
      continue;
    }

    try {
      const result = await moveOne({ ctx, sourcePath, destPath });
      results.push(result);
      allFilesToStage.push(...result.filesToStage);
    } catch (err) {
      errors.push(`Failed to move ${fromPath}: ${(err as Error).message}`);
      ctx.writeLine(`Error: Failed to move ${fromPath}: ${(err as Error).message}`);
    }
  }

  if (moveArgs.dryRun) {
    ctx.writeLine("(dry run - no changes made)");
    return { success: true, data: { dryRun: true } };
  }

  if (results.length === 0) {
    return { success: false, error: errors.join("; ") };
  }

  // Optionally commit all at once
  if (moveArgs.commit) {
    await stageFiles(ctx.boxRoot, allFilesToStage);

    const summary = results.length === 1
      ? `Move ${results[0]!.from} → ${results[0]!.to}`
      : `Move ${results.length} item(s) to ${path.relative(ctx.boxRoot, rawDestPath)}`;
    await commit(ctx.boxRoot, {
      message: summary,
      trailers: {
        "Moved-By": "cb mv",
      },
    });
    ctx.writeLine("Committed.");
  }

  if (errors.length > 0) {
    ctx.writeLine(`\nMoved ${results.length} card(s), ${errors.length} error(s)`);
  }

  return {
    success: true,
    data: results.length === 1 ? results[0] : { results, errors },
  };
}

// Register the command
registerCommand({
  name: "move",
  description: "Move/rename cards or directories and update all references",
  args: [
    {
      name: "from",
      description: "Path(s) to the card(s) or directory to move",
      required: true,
      type: "string[]",
    },
    {
      name: "to",
      description: "Destination path (file or directory)",
      required: true,
      type: "string",
    },
    {
      name: "commit",
      description: "Commit the change",
      required: false,
      default: false,
      type: "boolean",
    },
    {
      name: "dryRun",
      description: "Show what would happen without doing it",
      required: false,
      default: false,
      type: "boolean",
    },
  ],
  execute: executeMove,
});

export { executeMove };
