/**
 * One synced Drive file, pushed then pulled.
 *
 * Lifted out of the connector so the folder mirror and the CLI mount commands
 * can run the same file sync without holding a connector instance: the only
 * state it needs is the box root, a Drive service, and the per-file transient
 * hashes.
 */

import { attachDirFor } from "../../shared/attach-path.js";
import type { GoogleDriveService } from "../../services/google-drive/core.js";
import { getHandlerForMimeType } from "./handlers.js";
import type { DriveTransientState } from "./state.js";
import type { SyncPaths } from "./folder-types.js";
import type { DocsApiOutcome } from "./handlers/docs/api-failure.js";

export async function syncDriveFile(opts: {
  driveId: string;
  cardPath: string;
  boxRoot: string;
  service: GoogleDriveService;
  state: DriveTransientState;
  /** This pass's Docs API outcomes; the pull's is appended (see `docs-api-status.ts`). */
  docsApiOutcomes: DocsApiOutcome[];
}): Promise<SyncPaths> {
  const { driveId, cardPath, boxRoot, service, state, docsApiOutcomes } = opts;

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
  if (pullResult.docsApi !== undefined) docsApiOutcomes.push(pullResult.docsApi);

  return {
    created: isNew && pullResult.changed ? pullResult.written : [],
    updated: !isNew && pullResult.changed ? pullResult.written : [],
    pushed: pushResult.pushed,
  };
}
