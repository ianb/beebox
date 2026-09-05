/**
 * The contract between a `.gfolder.card` mirror pass and the connector that
 * drives it: what a pass reports back, and what it needs handed in. A leaf
 * module so the mirror's shell (`drive-folder-sync.ts`) and its individual
 * steps (`drive-folder-steps.ts`) can share it without importing each other.
 */

import type { GoogleDriveService } from "../services/google-drive.js";
import type { TrackedDriveCard } from "./google-drive-tracking.js";

export interface SyncPaths {
  created: string[];
  updated: string[];
  pushed: string[];
}

export interface FolderSyncResult extends SyncPaths {
  /** Real failures — these make the whole sync unsuccessful. */
  failures: string[];
  /** Things a human should know that are not failures (a child left, a cap). */
  notes: string[];
}

/** Everything the mirror needs from the connector around it. */
export interface FolderSyncDeps {
  boxRoot: string;
  service: GoogleDriveService;
  /** Drive IDs claimed anywhere in the box; grows as this pass creates cards. */
  claimed: Set<string>;
  /** IDs whose only claim is a connector-made tombstone — see `FolderPlanInput`. */
  restorable: Set<string>;
  /** Folder IDs entered on this pass. The cycle guard, shared across mounts. */
  visitedFolders: Set<string>;
  /** The pre-pass card scan, used to read each mount's current membership. */
  liveCards: TrackedDriveCard[];
  /** Folders mirrored so far on this pass, weighed against the per-pass cap. */
  budget: { foldersMirrored: number };
  syncFile(opts: { driveId: string; cardPath: string }): Promise<SyncPaths>;
  /** Drop retained transient hashes before a fresh mount of an old Drive ID. */
  forgetFileState(driveId: string): void;
  /**
   * `bbx rm` for one card: moves it and its attach scope to `_bookkeeping/trash/`, and
   * records the Drive ID as connector-trashed so a restore on Drive brings the
   * card back (a `bbx rm` tombstone stays durable).
   */
  trashCard(card: { cardPath: string; driveId: string }): Promise<string[]>;
  /** This ID has a card again: it is no longer connector-trashed. */
  forgetDriveTrash(driveId: string): void;
}

/**
 * Children a pass could not account for, counted per mount. Both are ordinary
 * Drive shape rather than failures, and both mean the mirror is not the whole
 * folder — so they are stamped on the mount card and shown wherever a mount is
 * shown, not left to a console warning nobody reads.
 */
export interface FolderProblemCounts {
  /** Listed nowhere in this folder any more, but alive on Drive: left syncing. */
  notInFolder: number;
  /** `getFile` failed, so nothing is known: left exactly where it is. */
  unknown: number;
}

export interface FolderMount {
  driveId: string;
  /** Absolute path of the `.gfolder.card`. Its directory is the mount. */
  cardPath: string;
  /** Levels below the outermost folder card of this pass. */
  depth: number;
}

