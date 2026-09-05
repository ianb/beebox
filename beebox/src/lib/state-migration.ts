/**
 * One-shot migration of state directories whose names are part of Bee Box's
 * persisted identity.  A rename is deliberately a filesystem rename: it is
 * atomic on the same filesystem, preserves every file and mode, and is
 * idempotent once the new path exists.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { withFileLock } from "./file-lock.js";

/** Compatibility names live here so the rest of the runtime has no scattered
 * retired-vocabulary literals. These values are read-only migration inputs. */
export const LEGACY_PACKAGE_NAME = "callback-box";
export const LEGACY_BOX_MARKER = ".cb-box";
export const LEGACY_STATE_DIR = path.join(os.homedir(), ".local/share/cb");
export const LEGACY_CONFIG_DIR = path.join(os.homedir(), ".config/cb");

export class PersistedStateConflictError extends Error {
  readonly oldPath: string;
  readonly newPath: string;

  constructor(oldPath: string, newPath: string) {
    super(`Cannot migrate persisted state: both ${oldPath} and ${newPath} exist; refusing to merge them.`);
    this.name = "PersistedStateConflictError";
    this.oldPath = oldPath;
    this.newPath = newPath;
  }
}

/**
 * An empty `newPath` directory is not a second generation of state, just a
 * directory something created ahead of the migration (a hub child booting, a
 * `mkdir -p` on the canonical path). Treating it as a conflict left boxes and
 * the machine state directory refusing every command until someone deleted it
 * by hand (2026-09-03, two local boxes and one launch). Remove it and let the
 * rename proceed; anything non-empty is still the conflict it always was.
 */
async function removeIfEmptyDir(dirPath: string): Promise<boolean> {
  let entries: string[];
  try {
    entries = await fs.readdir(dirPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return false;
    throw error;
  }
  if (entries.length > 0) return false;
  await fs.rmdir(dirPath);
  return true;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

const MIGRATION_WAIT_MS = 15_000;

/** Use a stable lock outside the paths being renamed, so acquisition never
 * creates one side of the state pair and concurrent processes serialize. */
function migrationLockPath(identity: string): string {
  const digest = createHash("sha256").update(path.resolve(identity)).digest("hex").slice(0, 32);
  return path.join(os.tmpdir(), "bbx-state-migration-locks", `${digest}.lock`);
}

async function withMigrationLock<T>(identity: string, fn: () => Promise<T>): Promise<T> {
  return withFileLock(
    {
      lockPath: migrationLockPath(identity),
      metadata: { purpose: "state-migration", identity: path.resolve(identity) },
      waitMs: MIGRATION_WAIT_MS,
    },
    fn,
  );
}

/** Move one legacy persisted path to its canonical path, or do nothing. */
async function migratePersistedPath(oldPath: string, newPath: string): Promise<"migrated" | "unchanged"> {
  return withMigrationLock(newPath, async () => {
    const oldExists = await exists(oldPath);
    const newExists = await exists(newPath) && !(oldExists && await removeIfEmptyDir(newPath));
    if (oldExists && newExists) throw new PersistedStateConflictError(oldPath, newPath);
    if (!oldExists) return "unchanged";
    await fs.mkdir(path.dirname(newPath), { recursive: true });
    await fs.rename(oldPath, newPath);
    return "migrated";
  });
}

/** Migrate one box's hidden state directory before any state reader runs. */
export async function migrateBoxState(boxRoot: string): Promise<"migrated" | "unchanged"> {
  return withMigrationLock(boxRoot, () => migrateBoxStateLocked(boxRoot));
}

async function migrateBoxStateLocked(boxRoot: string): Promise<"migrated" | "unchanged"> {
  const oldState = path.join(boxRoot, ".callback-box");
  const newState = path.join(boxRoot, ".beebox");
  const oldMarker = path.join(boxRoot, LEGACY_BOX_MARKER);
  const newMarker = path.join(newState, "box.json");
  const [oldStateExists, oldMarkerExists, newMarkerExists] = await Promise.all([
    exists(oldState), exists(oldMarker), exists(newMarker),
  ]);
  const newStateExists = await exists(newState) && !(oldStateExists && await removeIfEmptyDir(newState));

  // Never combine state from two generations. The only exception is a
  // partial migration we can identify unambiguously: the old state directory
  // has already moved, but its marker has not yet moved into it.
  if (oldStateExists && newStateExists) throw new PersistedStateConflictError(oldState, newState);
  if (oldMarkerExists && newMarkerExists) throw new PersistedStateConflictError(oldMarker, newMarker);
  if (oldMarkerExists && newStateExists && !newMarkerExists) {
    await fs.rename(oldMarker, newMarker);
    return "migrated";
  }
  if (!oldStateExists && !oldMarkerExists) return "unchanged";
  if (oldStateExists) {
    await fs.rename(oldState, newState);
  } else {
    await fs.mkdir(newState, { recursive: true });
  }
  if (oldMarkerExists) await fs.rename(oldMarker, newMarker);
  return "migrated";
}

/** Migrate a machine-level state directory. */
export async function migrateUserState(oldDir: string, newDir: string): Promise<"migrated" | "unchanged"> {
  return migratePersistedPath(oldDir, newDir);
}
