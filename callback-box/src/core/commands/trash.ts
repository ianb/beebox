/**
 * Trash command - Move a card to the trash directory.
 *
 * Cards in trash can be restored manually if needed, but are
 * generally considered deleted from the working state.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  registerCommand,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { getBoxDir, isCardFile, boxPath, parseCardName } from "../../cli/lib/paths.js";
import { stageFiles, commit } from "../../cli/lib/git.js";
import { attachDirFor } from "../../lib/attach-path.js";

/**
 * Arguments for the trash command.
 */
export interface TrashArgs {
  /** Path(s) to the card(s) to trash (relative to box root or absolute) */
  path?: string;
  paths?: string[];
  /** Whether to commit the change */
  commit?: boolean;
  /** Reason for trashing (recorded in commit message) */
  reason?: string;
}

/**
 * Trash a single card and its attachments. Returns info about what was moved.
 */
async function trashOne(
  ctx: CommandContext,
  cardPath: string
): Promise<{ relSourcePath: string; relDestPath: string; relatedFiles: string[]; movedFiles: string[] }> {
  // Resolve source path
  let sourcePath: string;
  if (path.isAbsolute(cardPath)) {
    sourcePath = cardPath;
  } else {
    sourcePath = boxPath(ctx.boxRoot, cardPath);
  }

  // Validate it's a card file
  if (!isCardFile(sourcePath)) {
    throw new Error(`Path must be a .card file: ${cardPath}`);
  }

  // Check source exists
  try {
    await fs.access(sourcePath);
  } catch {
    throw new Error(`Card not found: ${cardPath}`);
  }

  // Parse card name
  const basename = path.basename(sourcePath);
  const parsed = parseCardName(basename);
  if (!parsed) {
    throw new Error(`Invalid card name format: ${basename}`);
  }

  // Build destination path in trash
  const trashDir = getBoxDir(ctx.boxRoot, "trash");
  const destPath = path.join(trashDir, basename);

  // Check if destination already exists (add timestamp if so)
  let finalDestPath = destPath;
  try {
    await fs.access(destPath);
    const timestamp = new Date().toISOString().replace(/[.:]/g, "-");
    const newName = `${parsed.name}_${timestamp}.${parsed.type}.card`;
    finalDestPath = path.join(trashDir, newName);
  } catch {
    // Destination doesn't exist, use as-is
  }

  // Ensure trash directory exists
  await fs.mkdir(trashDir, { recursive: true });

  // Move the card file
  await fs.rename(sourcePath, finalDestPath);
  const relSourcePath = path.relative(ctx.boxRoot, sourcePath);
  const relDestPath = path.relative(ctx.boxRoot, finalDestPath);
  ctx.writeLine(`Trashed: ${relSourcePath} → ${relDestPath}`);

  // Move the card's attach scope (if it exists) — the whole directory tree,
  // including nested cards and their attach scopes.
  const sourceAttachDir = attachDirFor(sourcePath);
  const destAttachDir = attachDirFor(finalDestPath);
  const relatedFiles: string[] = [];
  const movedFiles: string[] = [relSourcePath];

  try {
    await fs.access(sourceAttachDir);
    // Resolve a non-colliding destination (in case the trash already holds one).
    let finalAttachDest = destAttachDir;
    try {
      await fs.access(destAttachDir);
      const timestamp = new Date().toISOString().replace(/[.:]/g, "-");
      finalAttachDest = `${destAttachDir}_${timestamp}`;
    } catch {
      // No collision
    }
    await fs.rename(sourceAttachDir, finalAttachDest);
    const relAttachSource = path.relative(ctx.boxRoot, sourceAttachDir);
    const relAttachDest = path.relative(ctx.boxRoot, finalAttachDest);
    relatedFiles.push(path.basename(sourceAttachDir));
    movedFiles.push(relAttachSource);
    ctx.writeLine(`  Also moved attach scope: ${relAttachSource} → ${relAttachDest}`);
  } catch {
    // No attach scope — nothing to move
  }

  return { relSourcePath, relDestPath, relatedFiles, movedFiles };
}

/**
 * Execute the trash command (supports single or multiple paths).
 */
async function executeTrash(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const trashArgs = args as unknown as TrashArgs;

  // Collect all paths (support both single `path` and array `paths`)
  const allPaths: string[] = [];
  if (trashArgs.paths && Array.isArray(trashArgs.paths)) {
    allPaths.push(...trashArgs.paths);
  }
  if (trashArgs.path) {
    allPaths.push(trashArgs.path);
  }
  if (allPaths.length === 0) {
    return { success: false, error: "At least one path is required" };
  }

  const results: Array<{ sourcePath: string; destPath: string; relatedFiles: string[] }> = [];
  const allMovedFiles: string[] = [];
  const allAdditions: string[] = [];
  const errors: string[] = [];

  for (const cardPath of allPaths) {
    try {
      const result = await trashOne(ctx, cardPath);
      results.push({
        sourcePath: result.relSourcePath,
        destPath: result.relDestPath,
        relatedFiles: result.relatedFiles,
      });
      allMovedFiles.push(...result.movedFiles);
      allAdditions.push(result.relDestPath);
      for (const relatedFile of result.relatedFiles) {
        const trashDir = getBoxDir(ctx.boxRoot, "trash");
        allAdditions.push(path.relative(ctx.boxRoot, path.join(trashDir, relatedFile)));
      }
    } catch (err) {
      errors.push((err as Error).message);
      ctx.writeLine(`Error: ${(err as Error).message}`);
    }
  }

  if (results.length === 0) {
    return { success: false, error: errors.join("; ") };
  }

  // Optionally commit all at once
  if (trashArgs.commit) {
    await stageFiles(ctx.boxRoot, [...allMovedFiles, ...allAdditions]);

    const reason = trashArgs.reason ? `: ${trashArgs.reason}` : "";
    const summary = results.length === 1
      ? `Trash card: ${path.basename(results[0]!.sourcePath)}${reason}`
      : `Trash ${results.length} cards${reason}`;
    await commit(ctx.boxRoot, {
      message: summary,
      trailers: {
        "Trashed-By": "cb rm",
      },
    });
    ctx.writeLine("Committed.");
  }

  if (errors.length > 0) {
    ctx.writeLine(`\nTrashed ${results.length} card(s), ${errors.length} error(s)`);
  }

  return {
    success: true,
    data: results.length === 1 ? results[0] : { results, errors },
  };
}

// Register the command
registerCommand({
  name: "trash",
  description: "Move one or more cards to the trash directory",
  args: [
    {
      name: "paths",
      description: "Paths to the cards to trash",
      required: true,
      type: "string[]",
    },
    {
      name: "commit",
      description: "Commit the change",
      required: false,
      default: false,
      type: "boolean",
    },
    {
      name: "reason",
      description: "Reason for trashing (recorded in commit message)",
      required: false,
      type: "string",
    },
  ],
  execute: executeTrash,
});

export { executeTrash };
