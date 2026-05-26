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
    } catch {
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
  } catch {
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

  // Scan all cards outside the moved directory for references to the old path
  const loader = new CardLoader(ctx.boxRoot);
  const allCards = await loader.listCards();
  const externalCards = allCards.filter((c) => !c.startsWith(destPath + "/"));

  for (const cardPath of externalCards) {
    try {
      const content = await fs.readFile(cardPath, "utf-8");
      // Check if this card references anything under the old directory
      if (!content.includes(relSourcePath)) continue;

      // Replace old path references with new path references
      const updatedContent = content.replaceAll(relSourcePath, relDestPath);
      if (updatedContent !== content) {
        await fs.writeFile(cardPath, updatedContent);
        const refsUpdated = (content.split(relSourcePath).length - 1);
        updatedCards.push({ path: path.relative(ctx.boxRoot, cardPath), refsUpdated });
        filesToStage.push(path.relative(ctx.boxRoot, cardPath));
        ctx.writeLine(`  Updated references in ${path.relative(ctx.boxRoot, cardPath)} (${refsUpdated} ref${refsUpdated > 1 ? "s" : ""})`);
      }
    } catch {
      // Skip cards that can't be read
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
 * refs that point at the moved card), this also rewrites refs from OTHER
 * cards that point at non-card files inside the moved attach scope. Those
 * refs use full paths (not the `attach/` virtual prefix, which is scoped to
 * the owning card) and aren't picked up by cardworks' card-ref handler.
 */
async function moveOne(params: MoveOneParams): Promise<MoveOneResult> {
  const { ctx, sourcePath, destPath } = params;
  const relSourcePath = path.relative(ctx.boxRoot, sourcePath);
  const relDestPath = path.relative(ctx.boxRoot, destPath);

  const oldAttachAbsDir = attachDirFor(sourcePath);
  const newAttachAbsDir = attachDirFor(destPath);
  const oldAttachRel = path.relative(ctx.boxRoot, oldAttachAbsDir);
  const newAttachRel = path.relative(ctx.boxRoot, newAttachAbsDir);

  const loader = new CardLoader(ctx.boxRoot);
  const card = await loader.load(sourcePath);
  const { result } = await loader.move(card, destPath);

  ctx.writeLine(`Moved: ${relSourcePath} → ${relDestPath}`);

  for (const file of result.movedFiles) {
    if (file.from !== sourcePath) {
      const relFrom = path.relative(ctx.boxRoot, file.from);
      const relTo = path.relative(ctx.boxRoot, file.to);
      ctx.writeLine(`  Also moved: ${relFrom} → ${relTo}`);
    }
  }

  if (result.updatedCards.length > 0) {
    ctx.writeLine(`Updated references in ${result.updatedCards.length} card(s):`);
    for (const update of result.updatedCards) {
      const relPath = path.relative(ctx.boxRoot, update.path);
      ctx.writeLine(`  ${relPath} (${update.refsUpdated} ref${update.refsUpdated > 1 ? "s" : ""})`);
    }
  }

  // Rewrite refs that pointed into the old attach scope (from cards outside
  // the moved subtree). cardworks already handled refs to cards; here we
  // catch refs to non-card files like `<source ref="/box/.../photo.jpg">`.
  // Crude but reliable: substring replace of the old attach-rel path in
  // every other card's content.
  const extraStaged: string[] = [];
  const extraUpdated: Array<{ path: string; refsUpdated: number }> = [];
  if (oldAttachRel !== newAttachRel) {
    const allCards = await loader.listCards();
    for (const cardPath of allCards) {
      // Skip cards inside the new attach scope (just moved there) and the
      // moved card itself.
      if (cardPath === destPath) continue;
      if (cardPath.startsWith(newAttachAbsDir + "/")) continue;
      try {
        const content = await fs.readFile(cardPath, "utf-8");
        if (!content.includes(oldAttachRel)) continue;
        const updated = content.replaceAll(oldAttachRel, newAttachRel);
        if (updated === content) continue;
        await fs.writeFile(cardPath, updated);
        const refsUpdated = content.split(oldAttachRel).length - 1;
        const relPath = path.relative(ctx.boxRoot, cardPath);
        extraUpdated.push({ path: relPath, refsUpdated });
        extraStaged.push(relPath);
        ctx.writeLine(`  Updated attach-scope refs in ${relPath} (${refsUpdated})`);
      } catch {
        // Skip cards that can't be read
      }
    }
  }

  // Clean up empty source directory
  await removeEmptyAncestors(path.dirname(sourcePath), ctx.boxRoot);

  const filesToStage: string[] = [];
  for (const file of result.movedFiles) {
    filesToStage.push(path.relative(ctx.boxRoot, file.from));
    filesToStage.push(path.relative(ctx.boxRoot, file.to));
  }
  for (const update of result.updatedCards) {
    filesToStage.push(path.relative(ctx.boxRoot, update.path));
  }
  filesToStage.push(...extraStaged);

  return {
    from: relSourcePath,
    to: relDestPath,
    movedFiles: result.movedFiles.map((f) => ({
      from: path.relative(ctx.boxRoot, f.from),
      to: path.relative(ctx.boxRoot, f.to),
    })),
    updatedCards: [
      ...result.updatedCards.map((u) => ({
        path: path.relative(ctx.boxRoot, u.path),
        refsUpdated: u.refsUpdated,
      })),
      ...extraUpdated,
    ],
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
