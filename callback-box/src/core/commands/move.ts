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
  /** Path to the card to move (relative to box root or absolute) */
  from: string;
  /** Destination path (relative to box root or absolute) */
  to: string;
  /** Whether to commit the change */
  commit?: boolean;
  /** Show what would happen without doing it */
  dryRun?: boolean;
}

/**
 * Execute the move command.
 */
async function executeMove(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const moveArgs = args as unknown as MoveArgs;

  if (!moveArgs.from || !moveArgs.to) {
    return { success: false, error: "Both 'from' and 'to' paths are required" };
  }

  // Resolve source path
  let sourcePath: string;
  if (path.isAbsolute(moveArgs.from)) {
    sourcePath = moveArgs.from;
  } else {
    sourcePath = boxPath(ctx.boxRoot, moveArgs.from);
  }

  // Resolve destination path
  let destPath: string;
  if (path.isAbsolute(moveArgs.to)) {
    destPath = moveArgs.to;
  } else {
    destPath = boxPath(ctx.boxRoot, moveArgs.to);
  }

  // Validate source is a card file
  if (!isCardFile(sourcePath)) {
    return { success: false, error: "Source must be a .card file" };
  }

  // If destination is a directory, move the file into it with same name
  if (destPath.endsWith("/") || !destPath.includes(".card")) {
    const basename = path.basename(sourcePath);
    destPath = path.join(destPath, basename);
  }

  // Validate destination is a card file
  if (!isCardFile(destPath)) {
    return { success: false, error: "Destination must be a .card file" };
  }

  const relSourcePath = path.relative(ctx.boxRoot, sourcePath);
  const relDestPath = path.relative(ctx.boxRoot, destPath);

  if (moveArgs.dryRun) {
    ctx.writeLine(`Would move: ${relSourcePath} → ${relDestPath}`);
    ctx.writeLine("(dry run - no changes made)");
    return {
      success: true,
      data: { dryRun: true, from: relSourcePath, to: relDestPath },
    };
  }

  // Use cardworks loader to move the card and update references
  const loader = new CardLoader(ctx.boxRoot);

  try {
    const card = await loader.load(sourcePath);
    const { card: newCard, result } = await loader.move(card, destPath);

    // Report what was moved
    ctx.writeLine(`Moved: ${relSourcePath} → ${relDestPath}`);

    for (const file of result.movedFiles) {
      if (file.from !== sourcePath) {
        const relFrom = path.relative(ctx.boxRoot, file.from);
        const relTo = path.relative(ctx.boxRoot, file.to);
        ctx.writeLine(`  Also moved: ${relFrom} → ${relTo}`);
      }
    }

    // Report reference updates
    if (result.updatedCards.length > 0) {
      ctx.writeLine(`Updated references in ${result.updatedCards.length} card(s):`);
      for (const update of result.updatedCards) {
        const relPath = path.relative(ctx.boxRoot, update.path);
        ctx.writeLine(`  ${relPath} (${update.refsUpdated} ref${update.refsUpdated > 1 ? "s" : ""})`);
      }
    }

    // Optionally commit
    if (moveArgs.commit) {
      // Stage all the moved files and updated cards
      const filesToStage: string[] = [];

      // Old paths (deletions)
      for (const file of result.movedFiles) {
        filesToStage.push(path.relative(ctx.boxRoot, file.from));
      }

      // New paths (additions)
      for (const file of result.movedFiles) {
        filesToStage.push(path.relative(ctx.boxRoot, file.to));
      }

      // Updated cards
      for (const update of result.updatedCards) {
        filesToStage.push(path.relative(ctx.boxRoot, update.path));
      }

      await stageFiles(ctx.boxRoot, filesToStage);

      const basename = path.basename(relSourcePath);
      await commit(ctx.boxRoot, {
        message: `Move card: ${basename}\n\n${relSourcePath} → ${relDestPath}`,
        trailers: {
          "Moved-By": "cb move",
        },
      });
      ctx.writeLine("Committed.");
    }

    return {
      success: true,
      data: {
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
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to move card: ${(error as Error).message}`,
    };
  }
}

// Register the command
registerCommand({
  name: "move",
  description: "Move/rename a card and update all references",
  args: [
    {
      name: "from",
      description: "Path to the card to move",
      required: true,
      type: "string",
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
