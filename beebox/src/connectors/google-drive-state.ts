/**
 * Google Drive connector transient state — the gitignored
 * `_bookkeeping/connectors/google-drive.state.json` file plus its serialized,
 * delta-merging writer.
 *
 * The state is written by TWO processes: the server (`google-drive.ts` `sync()`)
 * and the CLI (`cli/commands/drive.ts` `bbx drive add`). Neither holds the
 * cross-process lock for its whole run — the server sync is a long multi-await
 * span and locking it would block the CLI for the full duration. Instead each
 * loads state at the start, threads it by reference through its work, and at the
 * save point delta-merges its accumulated changes into FRESHLY-loaded state
 * inside {@link updateTransientState} (which takes both the in-process and
 * cross-process locks). The merge is per `files` key — see
 * {@link commitDriveStateDelta}.
 */

import type { FileState } from "./drive-types.js";
import { loadTransientState, updateTransientState } from "./transient-state.js";

export interface DriveTransientState {
  files: Record<string, FileState>;
  /**
   * Drive IDs the CONNECTOR trashed, because Drive said the child was trashed.
   * The tombstone in `_bookkeeping/trash/` cannot say who made it, and the two authors
   * mean opposite things: a `bbx rm` tombstone is a durable "not here", while a
   * connector one is only a mirror of Drive's own trash — so a file restored on
   * Drive must come back. Membership here is what tells them apart, and an ID
   * leaves the moment its card is re-created.
   */
  driveTrashed: string[];
}

export const DEFAULT_DRIVE_STATE: DriveTransientState = { files: {}, driveTrashed: [] };

/**
 * The state as it may actually be ON DISK: a file written before a field
 * existed simply lacks it, and `loadTransientState` hands back exactly what it
 * parsed. Every load goes through {@link normalizeDriveState}, so nothing past
 * this boundary has to defend against a missing key.
 */
interface StoredDriveState {
  files?: Record<string, FileState>;
  driveTrashed?: string[];
}

export function normalizeDriveState(stored: StoredDriveState): DriveTransientState {
  return { files: stored.files ?? {}, driveTrashed: stored.driveTrashed ?? [] };
}

/** Load the connector's state with every field present. */
export async function loadDriveState(boxRoot: string): Promise<DriveTransientState> {
  return normalizeDriveState(
    await loadTransientState<StoredDriveState>({
      boxRoot,
      connectorName: "google-drive",
      defaultValue: DEFAULT_DRIVE_STATE,
    }),
  );
}

export function emptyFileState(): FileState {
  return { contentHashes: {}, lastModified: "", extra: {} };
}

/**
 * Merge one writer's per-file changes onto freshly-loaded state.
 *
 * Field-by-field merge semantics (the `files` map is the only field):
 *   - **`files[driveId]`** — merged per key. For each driveId in `working`
 *     (the state this writer mutated in place): if this writer CREATED or
 *     MODIFIED that file's `FileState` (it differs from the `snapshot` this
 *     writer loaded), the writer's value wins — it just synced that file, so
 *     its complete `FileState` (`contentHashes` + `lastModified` + `extra`) is
 *     authoritative. If the writer merely READ the file (its `FileState` is
 *     byte-identical to the snapshot), the freshly-loaded value is kept — so a
 *     concurrent writer's update to a file THIS writer didn't touch (e.g. the
 *     CLI adding a brand-new mount while the server sync ran) survives.
 *   - A driveId present only in `fresh` (added concurrently) is preserved: the
 *     merge starts from a copy of `fresh.files`.
 *   - No deletions: the Drive sync only ever adds/updates `files` entries, so a
 *     key never needs removing.
 *   - **`driveTrashed`** — a set, merged as one: `fresh` plus whatever this
 *     writer ADDED, minus whatever this writer REMOVED (an ID it re-created a
 *     card for, or one whose tombstone is gone). Additions and removals are
 *     both meaningful here, so neither side can simply win.
 *
 * A file's `FileState` is taken wholesale (never sub-field merged): a single
 * Drive file is not synced by two processes in a way that would split its
 * sub-fields, so key-level granularity is the right resolution.
 */
export function mergeDriveState(opts: {
  fresh: DriveTransientState;
  snapshot: DriveTransientState;
  working: DriveTransientState;
}): DriveTransientState {
  const { fresh, snapshot, working } = opts;
  const files: Record<string, FileState> = { ...fresh.files };
  for (const [driveId, state] of Object.entries(working.files)) {
    const before = snapshot.files[driveId];
    if (!before || JSON.stringify(before) !== JSON.stringify(state)) {
      files[driveId] = state;
    }
  }
  return { files, driveTrashed: mergeDriveTrashed(opts) };
}

/** `fresh`, plus this writer's additions, minus this writer's removals. */
function mergeDriveTrashed(opts: {
  fresh: DriveTransientState;
  snapshot: DriveTransientState;
  working: DriveTransientState;
}): string[] {
  const before = new Set(opts.snapshot.driveTrashed);
  const after = new Set(opts.working.driveTrashed);
  const merged = new Set([...opts.fresh.driveTrashed, ...after]);
  for (const driveId of before) {
    if (!after.has(driveId)) merged.delete(driveId);
  }
  return [...merged].toSorted();
}

/**
 * Persist a writer's accumulated Drive-state changes under the serialized RMW
 * lock, delta-merging against freshly-loaded state via {@link mergeDriveState}.
 *
 * @param snapshot - state as loaded at the START of this writer's run (deep
 *   copy), the baseline for detecting which files this writer changed.
 * @param working - the same state object after the writer mutated it in place.
 */
export async function commitDriveStateDelta(opts: {
  boxRoot: string;
  snapshot: DriveTransientState;
  working: DriveTransientState;
}): Promise<void> {
  const { boxRoot, snapshot, working } = opts;
  await updateTransientState<StoredDriveState>({
    boxRoot,
    connectorName: "google-drive",
    defaultValue: DEFAULT_DRIVE_STATE,
    update: (fresh) => mergeDriveState({ fresh: normalizeDriveState(fresh), snapshot, working }),
  });
}
