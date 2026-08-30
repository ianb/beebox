/**
 * The {@link FolderSyncDeps} a `.gfolder.card` mirror pass runs on, built once
 * from a card scan and a Drive service.
 *
 * Two callers build the same bundle: the connector's `sync()` (every mount on
 * the box) and `bbx drive mount` (the one mount it just wrote). Sharing the
 * builder is what makes a fresh mount behave exactly like a wakeup sync —
 * same cycle guard, same recursion budget, same trash rule.
 */

import type { GoogleDriveService } from "../services/google-drive.js";
import { moveCardsToTrash } from "../core/commands/trash.js";
import type { CommandContext } from "../core/command-runner.js";
import { syncDriveFile } from "./drive-file-sync.js";
import type { FolderSyncDeps } from "./drive-folder-types.js";
import type { DriveCardTracking } from "./google-drive-tracking.js";
import type { DriveTransientState } from "./google-drive-state.js";

/** Every Drive ID some card on the box already speaks for. */
function claimedDriveIds(tracking: DriveCardTracking): Set<string> {
  return new Set([
    ...tracking.liveCards.map((card) => card.driveId),
    ...tracking.duplicates.map((duplicate) => duplicate.driveId),
    ...tracking.trashedDriveIds,
  ]);
}

/**
 * The IDs a listing may re-create: connector-made tombstones, and only those.
 *
 * Two conditions, both necessary. The tombstone must still BE a tombstone —
 * once the box has a live card again the state entry is just stale. And no live
 * card anywhere may hold the ID, or "restoring" it would fork a second card for
 * one Drive item.
 *
 * This is also where the set is pruned: an ID that is no longer tombstoned has
 * nothing left to say, so it leaves the state on this pass's delta merge rather
 * than accumulating for the life of the box.
 */
function restorableDriveIds(opts: {
  state: DriveTransientState;
  tracking: DriveCardTracking;
}): Set<string> {
  const { state, tracking } = opts;
  const live = new Set([
    ...tracking.liveCards.map((card) => card.driveId),
    ...tracking.duplicates.map((duplicate) => duplicate.driveId),
  ]);
  const restorable = new Set(
    state.driveTrashed.filter((id) => tracking.trashedDriveIds.has(id) && !live.has(id)),
  );
  state.driveTrashed = [...restorable];
  return restorable;
}

/**
 * A minimal command context for the mirror's `bbx rm`.
 *
 * The trash move is already reported through the pass's notes, so the command's
 * own narration would be duplicate output on a wakeup.
 */
function silentCommandContext(boxRoot: string): CommandContext {
  return { boxRoot, write: () => {}, writeLine: () => {} };
}

export function createFolderSyncDeps(options: {
  boxRoot: string;
  service: GoogleDriveService;
  state: DriveTransientState;
  tracking: DriveCardTracking;
}): FolderSyncDeps {
  const { boxRoot, service, state, tracking } = options;
  const restorable = restorableDriveIds({ state, tracking });
  return {
    boxRoot,
    service,
    claimed: claimedDriveIds(tracking),
    restorable,
    visitedFolders: new Set<string>(),
    liveCards: tracking.liveCards,
    budget: { foldersMirrored: 0 },
    syncFile: (opts) =>
      syncDriveFile({ driveId: opts.driveId, cardPath: opts.cardPath, boxRoot, service, state }),
    forgetFileState: (driveId) => {
      delete state.files[driveId];
    },
    forgetDriveTrash: (driveId) => {
      state.driveTrashed = state.driveTrashed.filter((id) => id !== driveId);
      restorable.delete(driveId);
    },
    trashCard: async (card) => {
      const receipt = await moveCardsToTrash(silentCommandContext(boxRoot), [card.cardPath]);
      // Whose tombstone this is decides whether a Drive restore can undo it,
      // and the tombstone card itself cannot say. Recorded here, at the one
      // place the connector does the trashing.
      if (!state.driveTrashed.includes(card.driveId)) state.driveTrashed.push(card.driveId);
      return receipt.gitPaths;
    },
  };
}
