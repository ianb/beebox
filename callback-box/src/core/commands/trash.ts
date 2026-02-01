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

/**
 * Arguments for the trash command.
 */
export interface TrashArgs {
  /** Path to the card to trash (relative to box root or absolute) */
  path: string;
  /** Whether to commit the change */
  commit?: boolean;
  /** Reason for trashing (recorded in commit message) */
  reason?: string;
}

/**
 * Execute the trash command.
 */
async function executeTrash(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const trashArgs = args as unknown as TrashArgs;

  if (!trashArgs.path) {
    return { success: false, error: "Path is required" };
  }

  // Resolve source path
  let sourcePath: string;
  if (path.isAbsolute(trashArgs.path)) {
    sourcePath = trashArgs.path;
  } else {
    sourcePath = boxPath(ctx.boxRoot, trashArgs.path);
  }

  // Validate it's a card file
  if (!isCardFile(sourcePath)) {
    return { success: false, error: "Path must be a .card file" };
  }

  // Check source exists
  try {
    await fs.access(sourcePath);
  } catch {
    return { success: false, error: `Card not found: ${sourcePath}` };
  }

  // Parse card name
  const basename = path.basename(sourcePath);
  const parsed = parseCardName(basename);
  if (!parsed) {
    return { success: false, error: "Invalid card name format" };
  }

  // Build destination path in trash
  const trashDir = getBoxDir(ctx.boxRoot, "trash");
  const destPath = path.join(trashDir, basename);

  // Check if destination already exists (add timestamp if so)
  let finalDestPath = destPath;
  try {
    await fs.access(destPath);
    // File exists, add timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const newName = `${parsed.name}_${timestamp}.${parsed.type}.card`;
    finalDestPath = path.join(trashDir, newName);
  } catch {
    // Destination doesn't exist, use as-is
  }

  // Ensure trash directory exists
  await fs.mkdir(trashDir, { recursive: true });

  // Find related files (attachments share the same basename prefix)
  const sourceDir = path.dirname(sourcePath);
  const cardBasename = basename.replace(/\.[^.]+\.card$/, "");
  const relatedFiles: string[] = [];

  try {
    const dirEntries = await fs.readdir(sourceDir);
    for (const entry of dirEntries) {
      if (entry.startsWith(cardBasename) && entry !== basename) {
        relatedFiles.push(entry);
      }
    }
  } catch {
    // Ignore errors reading directory
  }

  // Move the card file
  await fs.rename(sourcePath, finalDestPath);
  const relSourcePath = path.relative(ctx.boxRoot, sourcePath);
  const relDestPath = path.relative(ctx.boxRoot, finalDestPath);
  ctx.writeLine(`Trashed: ${relSourcePath} → ${relDestPath}`);

  // Move related files (attachments)
  const movedFiles: string[] = [relSourcePath];
  for (const relatedFile of relatedFiles) {
    const relatedSource = path.join(sourceDir, relatedFile);
    const relatedDest = path.join(trashDir, relatedFile);
    await fs.rename(relatedSource, relatedDest);
    movedFiles.push(path.relative(ctx.boxRoot, relatedSource));
    ctx.writeLine(`  Also moved: ${relatedFile}`);
  }

  // Optionally commit
  if (trashArgs.commit) {
    // Stage both removals and additions
    const additions = [relDestPath];
    for (const relatedFile of relatedFiles) {
      additions.push(path.relative(ctx.boxRoot, path.join(trashDir, relatedFile)));
    }

    // Git handles renames automatically when we stage both
    await stageFiles(ctx.boxRoot, [...movedFiles, ...additions]);

    const reason = trashArgs.reason ? `: ${trashArgs.reason}` : "";
    await commit(ctx.boxRoot, {
      message: `Trash ${parsed.type} card: ${parsed.name}${reason}`,
      trailers: {
        "Trashed-By": "cb trash",
      },
    });
    ctx.writeLine("Committed.");
  }

  return {
    success: true,
    data: {
      sourcePath: relSourcePath,
      destPath: relDestPath,
      relatedFiles,
    },
  };
}

// Register the command
registerCommand({
  name: "trash",
  description: "Move a card to the trash directory",
  args: [
    {
      name: "path",
      description: "Path to the card to trash",
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
      name: "reason",
      description: "Reason for trashing (recorded in commit message)",
      required: false,
      type: "string",
    },
  ],
  execute: executeTrash,
});

export { executeTrash };
