/**
 * The {@link FolderSyncDeps} a `.gfolder.card` mirror pass runs on, built once
 * from a card scan and a Drive service.
 *
 * Two callers build the same bundle: the connector's `sync()` (every mount on
 * the box) and `cb drive mount` (the one mount it just wrote). Sharing the
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
 * A minimal command context for the mirror's `cb rm`.
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
  return {
    boxRoot,
    service,
    claimed: claimedDriveIds(tracking),
    visitedFolders: new Set<string>(),
    liveCards: tracking.liveCards,
    budget: { foldersMirrored: 0 },
    syncFile: (opts) =>
      syncDriveFile({ driveId: opts.driveId, cardPath: opts.cardPath, boxRoot, service, state }),
    forgetFileState: (driveId) => {
      delete state.files[driveId];
    },
    trashCard: async (cardPath) => {
      const receipt = await moveCardsToTrash(silentCommandContext(boxRoot), [cardPath]);
      return receipt.gitPaths;
    },
  };
}
