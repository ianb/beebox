/**
 * One synced Drive file, pushed then pulled.
 *
 * Lifted out of the connector so the folder mirror and the CLI mount commands
 * can run the same file sync without holding a connector instance: the only
 * state it needs is the box root, a Drive service, and the per-file transient
 * hashes.
 */

import { attachDirFor } from "../shared/attach-path.js";
import type { GoogleDriveService } from "../services/google-drive.js";
import { getHandlerForMimeType } from "./drive-types.js";
import type { DriveTransientState } from "./google-drive-state.js";
import type { SyncPaths } from "./drive-folder-types.js";

export async function syncDriveFile(opts: {
  driveId: string;
  cardPath: string;
  boxRoot: string;
  service: GoogleDriveService;
  state: DriveTransientState;
}): Promise<SyncPaths> {
  const { driveId, cardPath, boxRoot, service, state } = opts;

  const file = await service.getFile(driveId);
  const handler = getHandlerForMimeType(file.mimeType);
  if (!handler) {
    console.warn(`[google-drive] No handler for ${file.mimeType} (${file.name})`);
    return { created: [], updated: [], pushed: [] };
  }

  if (!state.files[driveId]) {
    state.files[driveId] = { contentHashes: {}, lastModified: "", extra: {} };
  }
  const fileState = state.files[driveId];
  const localDir = attachDirFor(cardPath);
  const isNew = fileState.lastModified === "";

  const pushResult = await handler.push({
    file, localDir, cardPath, boxRoot, service, state: fileState,
  });
  const pullResult = await handler.pull({
    file, localDir, cardPath, boxRoot, service, state: fileState,
  });

  return {
    created: isNew && pullResult.changed ? pullResult.written : [],
    updated: !isNew && pullResult.changed ? pullResult.written : [],
    pushed: pushResult.pushed,
  };
}
