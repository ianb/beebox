/**
 * Move command - Move/rename a card and update all references.
 *
 * Uses cardworks' move functionality to handle:
 * - Moving the card file itself
 * - Moving related files (attachments with same basename)
 * - Updating all references from other cards
 *
 * The heavy lifting (single-card and directory relocation plus the
 * resolution-based ref rewrite) lives in ./move-operations.ts; Phase-2
 * card file detection/moving lives in ./move-phase2.ts. This module owns
 * argument parsing, source/destination resolution, the dry-run path, and
 * the optional commit.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import {
  registerCommand,
  parseCommandArgs,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { isCardFile, boxPath } from "../../cli/lib/paths.js";
import { stageFiles, commit } from "../../lib/git.js";
import { moveDir, moveOne, type MoveOneResult } from "./move-operations.js";

/**
 * Arguments for the move command.
 */
const MoveArgsSchema = z.object({
  /** Path(s) to the card(s) to move (relative to box root or absolute) */
  from: z.union([z.string(), z.array(z.string())]).optional(),
  /** Destination path (relative to box root or absolute) */
  to: z.string().optional(),
  /** Whether to commit the change */
  commit: z.boolean().optional(),
  /** Show what would happen without doing it */
  dryRun: z.boolean().optional(),
});
export type MoveArgs = z.infer<typeof MoveArgsSchema>;

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

function resolveBoxRelative(ctx: CommandContext, p: string): string {
  return path.isAbsolute(p) ? p : boxPath(ctx.boxRoot, p);
}

interface MoveSourceState {
  results: MoveOneResult[];
  allFilesToStage: string[];
  errors: string[];
}

/**
 * Relocate a single directory source, recording results or errors in `state`.
 */
async function handleDirectorySource({
  ctx,
  moveArgs,
  fromPath,
  sourcePath,
  rawDestPath,
  state,
}: {
  ctx: CommandContext;
  moveArgs: MoveArgs;
  fromPath: string;
  sourcePath: string;
  rawDestPath: string;
  state: MoveSourceState;
}): Promise<void> {
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
    return;
  }

  try {
    const dirResult = await moveDir({ ctx, sourcePath, destPath });
    state.results.push({
      from: dirResult.from,
      to: dirResult.to,
      movedFiles: [{ from: dirResult.from, to: dirResult.to }],
      updatedCards: dirResult.updatedCards,
      filesToStage: dirResult.filesToStage,
    });
    state.allFilesToStage.push(...dirResult.filesToStage);
  } catch (err) {
    state.errors.push(`Failed to move directory ${fromPath}: ${(err as Error).message}`);
    ctx.writeLine(`Error: Failed to move directory ${fromPath}: ${(err as Error).message}`);
  }
}

/**
 * Relocate a single card-file source, recording results or errors in `state`.
 */
async function handleCardSource({
  ctx,
  moveArgs,
  fromPath,
  sourcePath,
  rawDestPath,
  destIsDir,
  state,
}: {
  ctx: CommandContext;
  moveArgs: MoveArgs;
  fromPath: string;
  sourcePath: string;
  rawDestPath: string;
  destIsDir: boolean;
  state: MoveSourceState;
}): Promise<void> {
  let destPath = rawDestPath;
  if (destIsDir) {
    destPath = path.join(rawDestPath, path.basename(sourcePath));
  }

  if (!isCardFile(destPath)) {
    state.errors.push(`Destination must be a .card file: ${destPath}`);
    ctx.writeLine(`Error: Destination must be a .card file: ${destPath}`);
    return;
  }

  if (moveArgs.dryRun) {
    const relSource = path.relative(ctx.boxRoot, sourcePath);
    const relDest = path.relative(ctx.boxRoot, destPath);
    ctx.writeLine(`Would move: ${relSource} → ${relDest}`);
    return;
  }

  try {
    const result = await moveOne({ ctx, sourcePath, destPath });
    state.results.push(result);
    state.allFilesToStage.push(...result.filesToStage);
  } catch (err) {
    state.errors.push(`Failed to move ${fromPath}: ${(err as Error).message}`);
    ctx.writeLine(`Error: Failed to move ${fromPath}: ${(err as Error).message}`);
  }
}

/**
 * Relocate one source path (directory or card file), recording outcomes.
 */
async function handleSource({
  ctx,
  moveArgs,
  fromPath,
  rawDestPath,
  destIsDir,
  state,
}: {
  ctx: CommandContext;
  moveArgs: MoveArgs;
  fromPath: string;
  rawDestPath: string;
  destIsDir: boolean;
  state: MoveSourceState;
}): Promise<void> {
  const sourcePath = resolveBoxRelative(ctx, fromPath);
  const sourceIsDir = await isDirectory(sourcePath);

  if (!isCardFile(sourcePath) && !sourceIsDir) {
    state.errors.push(`Source must be a .card file or directory: ${fromPath}`);
    ctx.writeLine(`Error: Source must be a .card file or directory: ${fromPath}`);
    return;
  }

  if (sourceIsDir) {
    await handleDirectorySource({ ctx, moveArgs, fromPath, sourcePath, rawDestPath, state });
    return;
  }

  await handleCardSource({ ctx, moveArgs, fromPath, sourcePath, rawDestPath, destIsDir, state });
}

/**
 * Stage and commit all moved files in one commit.
 */
async function commitMoves({
  ctx,
  results,
  allFilesToStage,
  rawDestPath,
}: {
  ctx: CommandContext;
  results: MoveOneResult[];
  allFilesToStage: string[];
  rawDestPath: string;
}): Promise<void> {
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

/**
 * Execute the move command (supports single or multiple source paths).
 */
async function executeMove(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const moveArgs = parseCommandArgs(args, MoveArgsSchema);

  if (!moveArgs.from || !moveArgs.to) {
    return { success: false, error: "Both 'from' and 'to' paths are required" };
  }

  const fromPaths = Array.isArray(moveArgs.from) ? moveArgs.from : [moveArgs.from];
  const rawDestPath = resolveBoxRelative(ctx, moveArgs.to);
  const destIsDir = isDirectoryDest(rawDestPath);

  // Multiple sources require a directory destination
  if (fromPaths.length > 1 && !destIsDir) {
    return { success: false, error: "Moving multiple cards requires a directory destination" };
  }

  const state: MoveSourceState = { results: [], allFilesToStage: [], errors: [] };
  for (const fromPath of fromPaths) {
    await handleSource({ ctx, moveArgs, fromPath, rawDestPath, destIsDir, state });
  }
  const { results, allFilesToStage, errors } = state;

  if (moveArgs.dryRun) {
    ctx.writeLine("(dry run - no changes made)");
    return { success: true, data: { dryRun: true } };
  }

  if (results.length === 0) {
    return { success: false, error: errors.join("; ") };
  }

  if (moveArgs.commit) {
    await commitMoves({ ctx, results, allFilesToStage, rawDestPath });
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
