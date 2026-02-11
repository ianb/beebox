/**
 * Move command - Move/rename a card and update all references.
 *
 * Uses cardworks' move functionality to handle:
 * - Moving the card file itself
 * - Moving related files (attachments with same basename)
 * - Updating all references from other cards
 */

import * as path from "node:path";
import { CardLoader } from "cardworks";
import {
  registerCommand,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { isCardFile, boxPath } from "../../cli/lib/paths.js";
import { stageFiles, commit } from "../../cli/lib/git.js";

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
 * Move a single card, returning structured results.
 */
async function moveOne(
  ctx: CommandContext,
  sourcePath: string,
  destPath: string
): Promise<MoveOneResult> {
  const relSourcePath = path.relative(ctx.boxRoot, sourcePath);
  const relDestPath = path.relative(ctx.boxRoot, destPath);

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

  const filesToStage: string[] = [];
  for (const file of result.movedFiles) {
    filesToStage.push(path.relative(ctx.boxRoot, file.from));
    filesToStage.push(path.relative(ctx.boxRoot, file.to));
  }
  for (const update of result.updatedCards) {
    filesToStage.push(path.relative(ctx.boxRoot, update.path));
  }

  return {
    from: relSourcePath,
    to: relDestPath,
    movedFiles: result.movedFiles.map((f) => ({
      from: path.relative(ctx.boxRoot, f.from),
      to: path.relative(ctx.boxRoot, f.to),
    })),
    updatedCards: result.updatedCards.map((u) => ({
      path: path.relative(ctx.boxRoot, u.path),
      refsUpdated: u.refsUpdated,
    })),
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

    if (!isCardFile(sourcePath)) {
      errors.push(`Source must be a .card file: ${fromPath}`);
      ctx.writeLine(`Error: Source must be a .card file: ${fromPath}`);
      continue;
    }

    // Resolve final destination for this file
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
      const result = await moveOne(ctx, sourcePath, destPath);
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
      ? `Move card: ${path.basename(results[0]!.from)}\n\n${results[0]!.from} → ${results[0]!.to}`
      : `Move ${results.length} cards to ${path.relative(ctx.boxRoot, rawDestPath)}`;
    await commit(ctx.boxRoot, {
      message: summary,
      trailers: {
        "Moved-By": "cb move",
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
  description: "Move/rename one or more cards and update all references",
  args: [
    {
      name: "from",
      description: "Path(s) to the card(s) to move",
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
