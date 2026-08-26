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
  /** Folder IDs entered on this pass. The cycle guard, shared across mounts. */
  visitedFolders: Set<string>;
  /** The pre-pass card scan, used to read each mount's current membership. */
  liveCards: TrackedDriveCard[];
  /** Folders mirrored so far on this pass, weighed against the per-pass cap. */
  budget: { foldersMirrored: number };
  syncFile(opts: { driveId: string; cardPath: string }): Promise<SyncPaths>;
  /** Drop retained transient hashes before a fresh mount of an old Drive ID. */
  forgetFileState(driveId: string): void;
  /** `cb rm` for one card: moves it and its attach scope to `store/trash/`. */
  trashCard(cardPath: string): Promise<string[]>;
}

export interface FolderMount {
  driveId: string;
  /** Absolute path of the `.gfolder.card`. Its directory is the mount. */
  cardPath: string;
  /** Levels below the outermost folder card of this pass. */
  depth: number;
}

