/**
 * Google Drive connector transient state — the gitignored
 * `config/connectors/google-drive.state.json` file plus its serialized,
 * delta-merging writer.
 *
 * The state is written by TWO processes: the server (`google-drive.ts` `sync()`)
 * and the CLI (`cli/commands/drive.ts` `cb drive add`). Neither holds the
 * cross-process lock for its whole run — the server sync is a long multi-await
 * span and locking it would block the CLI for the full duration. Instead each
 * loads state at the start, threads it by reference through its work, and at the
 * save point delta-merges its accumulated changes into FRESHLY-loaded state
 * inside {@link updateTransientState} (which takes both the in-process and
 * cross-process locks). The merge is per `files` key — see
 * {@link commitDriveStateDelta}.
 */

import type { FileState } from "./drive-types.js";
import { updateTransientState } from "./transient-state.js";

export interface DriveTransientState {
  files: Record<string, FileState>;
}

export const DEFAULT_DRIVE_STATE: DriveTransientState = { files: {} };

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
  return { files };
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
  await updateTransientState<DriveTransientState>({
    boxRoot,
    connectorName: "google-drive",
    defaultValue: DEFAULT_DRIVE_STATE,
    update: (fresh) => mergeDriveState({ fresh, snapshot, working }),
  });
}
