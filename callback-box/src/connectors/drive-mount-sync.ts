/**
 * Running one mirror pass on demand, outside the connector's wakeup sync.
 *
 * Two callers want exactly this: `cb drive mount` (so a fresh mount's
 * directory is populated before the command returns) and the settings page's
 * "Sync now" (so the boxholder can reconcile without waiting for a wakeup).
 * Both go through {@link mirrorFolderOnce}, which builds the same dependency
 * bundle a wakeup sync builds — same cycle guard, same recursion budget, same
 * trash rule — so an on-demand pass is never a second implementation of the
 * mirror.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { stageAndCommitPaths } from "../lib/git.js";
import { parseFrontmatterObject } from "../cards/frontmatter.js";
import { errnoCode } from "../lib/error-guards.js";
import type { GoogleDriveService } from "../services/google-drive.js";
import { syncFolderCard } from "./drive-folder-sync.js";
import { withDriveMirrorLock } from "./drive-lock.js";
import type { FolderSyncResult } from "./drive-folder-types.js";
import { createFolderSyncDeps } from "./drive-sync-deps.js";
import { NotAFolderMountError } from "./drive-mount-errors.js";
import { resolveMountTarget } from "./drive-mount-path.js";
import {
  driveIdFromCardContent,
  findDriveCardTracking,
  GFOLDER_CARD_TYPE,
} from "./google-drive-tracking.js";
import { loadTransientState } from "./transient-state.js";
import {
  DEFAULT_DRIVE_STATE,
  commitDriveStateDelta,
  type DriveTransientState,
} from "./google-drive-state.js";

/**
 * One mirror pass over a mount card, with its transient state merged back the
 * same way a connector sync merges it. A mount whose first sync waited for the
 * next wakeup would show an empty directory and no status for hours.
 */
export async function mirrorFolderOnce(opts: {
  boxRoot: string;
  service: GoogleDriveService;
  driveId: string;
  cardPath: string;
}): Promise<FolderSyncResult> {
  // One Drive writer per box: a wakeup sync in another process would otherwise
  // be discovering and pushing the same children this pass is. Reentrant, so
  // `syncFolderMount` and `cb drive mount` can hold it around this call too.
  return withDriveMirrorLock(opts.boxRoot, () => mirrorUnderLock(opts));
}

async function mirrorUnderLock(opts: {
  boxRoot: string;
  service: GoogleDriveService;
  driveId: string;
  cardPath: string;
}): Promise<FolderSyncResult> {
  const { boxRoot, service, driveId, cardPath } = opts;
  const state = await loadTransientState<DriveTransientState>({
    boxRoot,
    connectorName: "google-drive",
    defaultValue: DEFAULT_DRIVE_STATE,
  });
  const snapshot: DriveTransientState = structuredClone(state);
  // Re-scan after the card write so the new mount is in its own tracking —
  // that is what makes its Drive ID claimed and its directory's membership
  // visible to the planner.
  const tracking = await findDriveCardTracking(boxRoot);
  const deps = createFolderSyncDeps({ boxRoot, service, state, tracking });
  const mirror = await syncFolderCard({ driveId, cardPath, depth: 0 }, deps);
  await commitDriveStateDelta({ boxRoot, snapshot, working: state });
  return mirror;
}

export interface SyncFolderMountResult extends FolderSyncResult {
  /** Box-relative path of the mount card that was mirrored. */
  cardPath: string;
}

/**
 * Mirror one existing `.gfolder.card` now and commit what changed.
 *
 * `target` names the card itself, not its directory: this is the "sync this
 * mount" action, and a directory could hold no mount at all.
 */
export async function syncFolderMount(options: {
  boxRoot: string;
  service: GoogleDriveService;
  target: string;
}): Promise<SyncFolderMountResult> {
  const { boxRoot, service, target } = options;
  const cardPath = resolveMountTarget(boxRoot, { raw: target, label: "The mount card" });
  const relCard = path.relative(boxRoot, cardPath);
  if (!cardPath.endsWith(`.${GFOLDER_CARD_TYPE}.card`)) {
    throw new NotAFolderMountError(relCard);
  }

  // The card read, the mirror, and the commit are one span: an unmount landing
  // between the read and the mirror would otherwise have this pass re-create
  // what it just trashed.
  return withDriveMirrorLock(boxRoot, () => syncMountUnderLock({ boxRoot, service, cardPath }));
}

async function syncMountUnderLock(opts: {
  boxRoot: string;
  service: GoogleDriveService;
  cardPath: string;
}): Promise<SyncFolderMountResult> {
  const { boxRoot, service, cardPath } = opts;
  const relCard = path.relative(boxRoot, cardPath);

  let content: string;
  try {
    content = await fs.readFile(cardPath, "utf-8");
  } catch (e) {
    // A card that is not there is the ordinary way this is asked wrongly — a
    // stale settings page, a mount someone unmounted in between.
    if (errnoCode(e) === "ENOENT") throw new NotAFolderMountError(relCard);
    throw e;
  }
  const driveId = driveIdFromCardContent(content);
  if (driveId === null) throw new NotAFolderMountError(relCard);

  const mirror = await mirrorFolderOnce({ boxRoot, service, driveId, cardPath });
  const paths = [...new Set([relCard, ...mirror.created, ...mirror.updated, ...mirror.pushed])];
  await stageAndCommitPaths(boxRoot, {
    paths,
    message: `Sync Drive folder: ${folderName(content) ?? path.basename(cardPath)}`,
  });

  return { ...mirror, cardPath: relCard };
}

/** The Drive name stamped on a mount card, when it has been synced before. */
function folderName(content: string): string | null {
  const name = parseFrontmatterObject(content)?.["name"];
  return typeof name === "string" && name !== "" ? name : null;
}
