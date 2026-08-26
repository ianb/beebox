/**
 * The individual steps of one `.gfolder.card` mirror pass — shortcut
 * resolution, the probe of a child that left the listing, and the occupant
 * guard on a derived card path. Split out of `drive-folder-sync.ts` so that
 * module stays the shape of a pass rather than the detail of every step.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode, errorMessage } from "../lib/error-guards.js";
import type { DriveFile, GoogleDriveService } from "../services/google-drive.js";
import { DRIVE_SHORTCUT_MIME, type ResolvedChild } from "./drive-folder-plan.js";
import type { FolderSyncDeps } from "./drive-folder-types.js";
import { driveIdFromCardContent } from "./google-drive-tracking.js";

/** Read a file, or `null` when it does not exist. Other errors propagate. */
async function readIfPresent(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (error: unknown) {
    if (errnoCode(error) === "ENOENT") return null;
    throw error;
  }
}

/**
 * Follow shortcuts so the planner sees targets, not the pointers to them. A
 * shortcut whose target cannot be read is reported and dropped from the
 * listing — it is not evidence that anything was removed.
 */
export async function resolveChildren(
  listing: DriveFile[],
  service: GoogleDriveService,
): Promise<{ children: ResolvedChild[]; files: Map<string, DriveFile>; failures: string[] }> {
  const children: ResolvedChild[] = [];
  const files = new Map<string, DriveFile>();
  const failures: string[] = [];
  for (const file of listing) {
    if (file.mimeType !== DRIVE_SHORTCUT_MIME) {
      files.set(file.id, file);
      children.push({ id: file.id, name: file.name, mimeType: file.mimeType, viaShortcutId: null });
      continue;
    }
    const targetId = file.shortcutDetails?.targetId;
    if (targetId === undefined) {
      failures.push(`Drive shortcut ${file.id} ("${file.name}") carries no target`);
      continue;
    }
    try {
      const target = await service.getFile(targetId);
      files.set(target.id, target);
      // The shortcut's name is the one the boxholder sees in the folder, so it
      // is the name the card takes; the identity is the target's.
      children.push({
        id: target.id,
        name: file.name,
        mimeType: target.mimeType,
        viaShortcutId: file.id,
      });
    } catch (err) {
      failures.push(
        `Drive shortcut ${file.id} ("${file.name}") target ${targetId} unreadable: ${errorMessage(err)}`,
      );
    }
  }
  return { children, files, failures };
}

/**
 * Decide what a card here whose Drive ID left the listing means. Only a
 * `getFile` that says `trashed` justifies trashing the box card; a moved-out
 * child and an unreadable one are both left exactly where they are.
 */
export async function probeAbsent(
  entry: { cardPath: string; driveId: string },
  deps: FolderSyncDeps,
): Promise<{ updated: string[]; notes: string[] }> {
  const relPath = path.relative(deps.boxRoot, entry.cardPath);
  let file: DriveFile;
  try {
    file = await deps.service.getFile(entry.driveId);
  } catch (err) {
    return {
      updated: [],
      notes: [`unknown: ${relPath} — Drive ${entry.driveId} could not be read (${errorMessage(err)}); left in place`],
    };
  }
  if (!file.trashed) {
    return {
      updated: [],
      notes: [`not-in-folder: ${relPath} — Drive ${entry.driveId} is no longer in this folder; left in place and still syncing`],
    };
  }
  const moved = await deps.trashCard(relPath);
  return {
    updated: moved,
    notes: [`trashed: ${relPath} — Drive ${entry.driveId} is in the Drive trash; moved to store/trash/`],
  };
}

/** Whether a derived card path is ours to write, and why not when it is not. */
export interface PathClaim {
  write: boolean;
  failure: string | null;
}

/**
 * The occupant guard, unchanged from the file-only mirror: two Drive children
 * can derive one safe name, so an occupied path is not necessarily ours.
 */
export async function claimPath(
  target: { cardPath: string; driveId: string; name: string },
  deps: FolderSyncDeps,
): Promise<PathClaim> {
  const occupant = await readIfPresent(target.cardPath);
  if (occupant === null) return { write: true, failure: null };
  const occupantId = driveIdFromCardContent(occupant);
  if (occupantId === target.driveId) {
    // Benign re-mount: the same file, already carded at this path.
    deps.claimed.add(target.driveId);
    return { write: false, failure: null };
  }
  const relCardPath = path.relative(deps.boxRoot, target.cardPath);
  return {
    write: false,
    failure:
      occupantId === null
        ? `Drive file ${target.driveId} ("${target.name}") maps to ${relCardPath}, which holds a card with no readable drive-id`
        : `Drive file ${target.driveId} ("${target.name}") maps to ${relCardPath}, already claimed by drive-id ${occupantId}`,
  };
}

