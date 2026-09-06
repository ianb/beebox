/**
 * Trash command - Move a card to the trash directory.
 *
 * Cards in trash can be restored manually if needed, but are
 * generally considered deleted from the working state.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { registerCommand, parseCommandArgs, type CommandContext, type CommandResult } from "../command-runner.js";
import { getBoxDir, isCardFile, parseCardName } from "../../lib/paths.js";
import { BoxPathArgError, resolveCliTargetPath } from "../../cli/lib/cli-target-path.js";
import { stageAndCommitPaths } from "../../lib/git.js";
import { attachDirFor } from "../../shared/attach-path.js";
import { NotFoundError } from "../../lib/errors.js";
import { invariant } from "../../lib/invariant.js";
import { errnoCode, errorMessage } from "../../lib/error-guards.js";
import { assertSafeTrashDestination } from "./trash-namespace-guard.js";
import { findInboundCardRefs, type InboundCardRef } from "../find-inbound-card-refs.js";

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

export interface TrashMove {
  sourcePath: string;
  destPath: string;
  relatedFiles: string[];
  fileMoves: Array<{ sourcePath: string; destPath: string }>;
}

export interface TrashReceipt {
  moves: TrashMove[];
  gitPaths: string[];
}

async function reportInboundRefs(
  ctx: CommandContext,
  cardPaths: string[],
): Promise<Record<string, InboundCardRef[]>> {
  const inboundRefs: Record<string, InboundCardRef[]> = {};
  for (const cardPath of cardPaths) {
    const relPath = path.relative(
      ctx.boxRoot,
      resolveCliTargetPath({ boxRoot: ctx.boxRoot, raw: cardPath, relativeTo: ctx.boxRoot }),
    );
    const refs = await findInboundCardRefs({ boxRoot: ctx.boxRoot, cardPath: relPath });
    inboundRefs[relPath] = refs;
    for (const referrer of refs) {
      ctx.writeLine(`Inbound ref: ${referrer.path} (${referrer.refs}) → ${relPath}`);
    }
  }
  return inboundRefs;
}

async function pathExists(target: string): Promise<boolean> {
  // Deliberately stricter than lib/file-exists: an unreadable destination
  // cannot safely be treated as absent before a destructive rename.
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return false;
    throw error;
  }
}

/**
 * Trash a single card and its attachments. Returns info about what was moved.
 */
async function trashOne(
  ctx: CommandContext,
  cardPath: string,
): Promise<{
  relSourcePath: string;
  relDestPath: string;
  relatedFiles: string[];
  gitPaths: string[];
  fileMoves: Array<{ sourcePath: string; destPath: string }>;
}> {
  // Resolve source path
  const sourcePath = resolveCliTargetPath({ boxRoot: ctx.boxRoot, raw: cardPath, relativeTo: ctx.boxRoot });

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
  if (await pathExists(destPath)) {
    const timestamp = new Date().toISOString().replace(/[.:]/g, "-");
    const newName = `${parsed.name}_${timestamp}.${parsed.type}.card`;
    finalDestPath = path.join(trashDir, newName);
  }

  // Ensure trash directory exists
  await fs.mkdir(trashDir, { recursive: true });

  const sourceAttachDir = attachDirFor(sourcePath);
  const destAttachDir = attachDirFor(finalDestPath);
  const hasAttachments = await pathExists(sourceAttachDir);
  let finalAttachDest = destAttachDir;
  if (hasAttachments && (await pathExists(destAttachDir))) {
    const timestamp = new Date().toISOString().replace(/[.:]/g, "-");
    finalAttachDest = `${destAttachDir}_${timestamp}`;
  }

  // Round-8 hardening finding 4: resolve both destinations through the
  // box-namespace fence before touching disk — see `trash-namespace-guard.ts`.
  await assertSafeTrashDestination(ctx.boxRoot, finalDestPath);
  if (hasAttachments) await assertSafeTrashDestination(ctx.boxRoot, finalAttachDest);

  // Move the card, then its attachment scope. If the second move fails, put
  // the card back so callers never lose the receipt for a partial card move.
  await fs.rename(sourcePath, finalDestPath);
  try {
    if (hasAttachments) await fs.rename(sourceAttachDir, finalAttachDest);
  } catch (error) {
    await fs.rename(finalDestPath, sourcePath);
    throw error;
  }
  const relSourcePath = path.relative(ctx.boxRoot, sourcePath);
  const relDestPath = path.relative(ctx.boxRoot, finalDestPath);
  ctx.writeLine(`Trashed: ${relSourcePath} → ${relDestPath}`);

  // Move the card's attach scope (if it exists) — the whole directory tree,
  // including nested cards and their attach scopes.
  const relatedFiles: string[] = [];
  const fileMoves = [{ sourcePath: relSourcePath, destPath: relDestPath }];
  const gitPaths: string[] = [relSourcePath, relDestPath];

  if (hasAttachments) {
    const relAttachSource = path.relative(ctx.boxRoot, sourceAttachDir);
    const relAttachDest = path.relative(ctx.boxRoot, finalAttachDest);
    relatedFiles.push(path.basename(sourceAttachDir));
    fileMoves.push({ sourcePath: relAttachSource, destPath: relAttachDest });
    gitPaths.push(relAttachSource, relAttachDest);
    ctx.writeLine(`  Also moved attach scope: ${relAttachSource} → ${relAttachDest}`);
  }

  return { relSourcePath, relDestPath, relatedFiles, gitPaths, fileMoves };
}

/** Move cards and attachment scopes, returning a receipt even before git commit. */
export async function moveCardsToTrash(ctx: CommandContext, cardPaths: string[]): Promise<TrashReceipt> {
  const moves: TrashMove[] = [];
  const gitPaths: string[] = [];
  for (const cardPath of cardPaths) {
    const result = await trashOne(ctx, cardPath);
    moves.push({
      sourcePath: result.relSourcePath,
      destPath: result.relDestPath,
      relatedFiles: result.relatedFiles,
      fileMoves: result.fileMoves,
    });
    gitPaths.push(...result.gitPaths);
  }
  return { moves, gitPaths };
}

/** Commit one completed trash move receipt with standard attribution. */
export async function commitTrashReceipt(boxRoot: string, options: { receipt: TrashReceipt; reason?: string | undefined }): Promise<string | null> {
  const { receipt, reason } = options;
  const suffix = reason === undefined ? "" : `: ${reason}`;
  const message =
    receipt.moves.length === 1 ? `Trash card: ${path.basename(receipt.moves[0]?.sourcePath ?? "card")}${suffix}` : `Trash ${String(receipt.moves.length)} cards${suffix}`;
  return stageAndCommitPaths(boxRoot, {
    paths: receipt.gitPaths,
    message,
    trailers: { "Trashed-By": "bbx rm" },
  });
}

/**
 * Execute the trash command (supports single or multiple paths).
 */
async function executeTrash(ctx: CommandContext, args: Record<string, unknown>): Promise<CommandResult> {
  try {
    return await executeTrashUnguarded(ctx, args);
  } catch (e) {
    // Path-guard rejection (display-form leak or nested reserved area name):
    // reported as an ordinary CommandResult failure, matching every other
    // user-input rejection in this command — not an uncaught throw.
    // (`runCommand`'s own catch-all would do this too for a CLI-dispatched
    // call, but this function is also called directly, bypassing that
    // wrapper.)
    if (e instanceof BoxPathArgError) return { success: false, error: e.message };
    throw e;
  }
}

async function executeTrashUnguarded(ctx: CommandContext, args: Record<string, unknown>): Promise<CommandResult> {
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

  const inboundRefs = await reportInboundRefs(ctx, allPaths);

  // Dry run: validate each path and report what would move, mutating nothing.
  // (`bbx rm --dry-run` advertised this flag but the command never read it —
  // a dry-run invocation actually trashed files.)
  if (trashArgs.dryRun) {
    const wouldTrash: string[] = [];
    const dryErrors: string[] = [];
    for (const cardPath of allPaths) {
      const sourcePath = resolveCliTargetPath({ boxRoot: ctx.boxRoot, raw: cardPath, relativeTo: ctx.boxRoot });
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
    return {
      success: true,
      data: { dryRun: true, wouldTrash, errors: dryErrors, inboundRefs },
    };
  }

  const results: Array<{
    sourcePath: string;
    destPath: string;
    relatedFiles: string[];
  }> = [];
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
      allMovedFiles.push(...result.gitPaths);
      allAdditions.push(result.relDestPath);
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
        "Trashed-By": "bbx rm",
      },
    });
    ctx.writeLine("Committed.");
  }

  if (errors.length > 0) {
    ctx.writeLine(`\nTrashed ${results.length} card(s), ${errors.length} error(s)`);
  }

  return {
    success: true,
    data: results.length === 1
      ? { ...results[0], inboundRefs: inboundRefs[results[0]?.sourcePath ?? ""] ?? [] }
      : { results, errors, inboundRefs },
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
