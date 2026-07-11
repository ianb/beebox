/**
 * Trash command - Move a card to the trash directory.
 *
 * Cards in trash can be restored manually if needed, but are
 * generally considered deleted from the working state.
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
import { getBoxDir, isCardFile, boxPath, parseCardName } from "../../lib/paths.js";
import { stageAndCommitPaths } from "../../lib/git.js";
import { attachDirFor } from "../../shared/attach-path.js";
import { NotFoundError } from "../../lib/errors.js";
import { invariant } from "../../lib/invariant.js";
import { errorMessage } from "../../lib/error-guards.js";

class NotACardFileError extends Error {
  readonly cardPath: string;
  constructor(cardPath: string) {
    super(`Path must be a .card file: ${cardPath}`);
    this.name = "NotACardFileError";
    this.cardPath = cardPath;
  }
}

class InvalidCardNameError extends Error {
  readonly basename: string;
  constructor(basename: string) {
    super(`Invalid card name format: ${basename}`);
    this.name = "InvalidCardNameError";
    this.basename = basename;
  }
}

/**
 * Arguments for the trash command.
 */
const TrashArgsSchema = z.object({
  /** Path(s) to the card(s) to trash (relative to box root or absolute) */
  path: z.string().optional(),
  paths: z.array(z.string()).optional(),
  /** Whether to commit the change */
  commit: z.boolean().optional(),
  /** Reason for trashing (recorded in commit message) */
  reason: z.string().optional(),
  /** Show what would happen without doing it */
  dryRun: z.boolean().optional(),
});
export type TrashArgs = z.infer<typeof TrashArgsSchema>;

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
    throw new NotACardFileError(cardPath);
  }

  // Check source exists
  try {
    await fs.access(sourcePath);
  } catch (_e) {
    // access() only fails here when the card is missing/unreadable; the
    // underlying ENOENT carries no detail beyond the path we already report.
    throw new NotFoundError(cardPath, "Card");
  }

  // Parse card name
  const basename = path.basename(sourcePath);
  const parsed = parseCardName(basename);
  if (!parsed) {
    throw new InvalidCardNameError(basename);
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
  } catch (_e) {
    // access() throwing means the destination doesn't exist — the normal
    // case. Nothing to inspect; keep the un-timestamped destination path.
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
    } catch (_e) {
      // access() throwing means no collision at the attach destination —
      // the normal case. Nothing to inspect; keep the plain destination.
    }
    await fs.rename(sourceAttachDir, finalAttachDest);
    const relAttachSource = path.relative(ctx.boxRoot, sourceAttachDir);
    const relAttachDest = path.relative(ctx.boxRoot, finalAttachDest);
    relatedFiles.push(path.basename(sourceAttachDir));
    movedFiles.push(relAttachSource);
    ctx.writeLine(`  Also moved attach scope: ${relAttachSource} → ${relAttachDest}`);
  } catch (_e) {
    // The initial access() throwing means this card has no attach scope —
    // the common case. Nothing to move and nothing actionable to inspect.
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
  const trashArgs = parseCommandArgs(args, TrashArgsSchema);

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

  // Dry run: validate each path and report what would move, mutating nothing.
  // (`cb rm --dry-run` advertised this flag but the command never read it —
  // a dry-run invocation actually trashed files.)
  if (trashArgs.dryRun) {
    const wouldTrash: string[] = [];
    const dryErrors: string[] = [];
    for (const cardPath of allPaths) {
      const sourcePath = path.isAbsolute(cardPath) ? cardPath : boxPath(ctx.boxRoot, cardPath);
      if (!isCardFile(sourcePath)) {
        dryErrors.push(`Not a card file: ${cardPath}`);
        continue;
      }
      try {
        await fs.access(sourcePath);
      } catch (_e) {
        // access() only fails here when the card is missing/unreadable.
        dryErrors.push(`Card not found: ${cardPath}`);
        continue;
      }
      const relSourcePath = path.relative(ctx.boxRoot, sourcePath);
      wouldTrash.push(relSourcePath);
      ctx.writeLine(`Would trash: ${relSourcePath}`);
    }
    for (const err of dryErrors) ctx.writeLine(`Error: ${err}`);
    ctx.writeLine("(dry run - no changes made)");
    if (wouldTrash.length === 0) {
      return { success: false, error: dryErrors.join("; ") };
    }
    return { success: true, data: { dryRun: true, wouldTrash, errors: dryErrors } };
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
      errors.push(errorMessage(err));
      ctx.writeLine(`Error: ${errorMessage(err)}`);
    }
  }

  if (results.length === 0) {
    return { success: false, error: errors.join("; ") };
  }

  // Optionally commit all at once
  if (trashArgs.commit) {
    const reason = trashArgs.reason ? `: ${trashArgs.reason}` : "";
    let summary: string;
    if (results.length === 1) {
      const [only] = results;
      invariant(only !== undefined, "checked results.length === 1 above");
      summary = `Trash card: ${path.basename(only.sourcePath)}${reason}`;
    } else {
      summary = `Trash ${results.length} cards${reason}`;
    }
    await stageAndCommitPaths(ctx.boxRoot, {
      paths: [...allMovedFiles, ...allAdditions],
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
