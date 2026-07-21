/**
 * Transient connector state — machine-local, gitignored.
 *
 * Files use the pattern `<name>.state.json` (dot before "state")
 * vs the persistent `<name>-state.json` (dash before "state").
 * The `.state.*` pattern is gitignored.
 *
 * Use this for timestamps, sync tokens, and other ephemeral data
 * that would create noisy git diffs if committed.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../lib/error-guards.js";

import { withCardLock } from "../lib/card-lock.js";
import { acquireLock, releaseLock, LockHeldError } from "../lib/file-lock.js";

/**
 * Build the transient state file path for a connector.
 * e.g. "gmail" → "config/connectors/gmail.state.json"
 */
export function transientStatePath(boxRoot: string, connectorName: string): string {
  return path.join(boxRoot, `config/connectors/${connectorName}.state.json`);
}

interface LoadOptions<T> {
  boxRoot: string;
  connectorName: string;
  defaultValue: T;
}

/**
 * Load transient state, returning defaultValue if file doesn't exist.
 */
export async function loadTransientState<T>(opts: LoadOptions<T>): Promise<T> {
  try {
    const content = await fs.readFile(transientStatePath(opts.boxRoot, opts.connectorName), "utf-8");
    return JSON.parse(content);
  } catch (e) {
    // Transient state is gitignored and absent on first run — a missing file is
    // the normal path to defaultValue. Log so a corrupt/unreadable state file
    // isn't silently reset to defaults.
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`Could not load transient state for ${opts.connectorName}, using default:`, e);
    }
    return opts.defaultValue;
  }
}

interface SaveOptions {
  boxRoot: string;
  connectorName: string;
  data: unknown;
}

/**
 * Save transient state.
 */
export async function saveTransientState(opts: SaveOptions): Promise<void> {
  const filePath = transientStatePath(opts.boxRoot, opts.connectorName);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(opts.data, null, 2) + "\n");
}

const LOCK_RETRIES = 50;
const LOCK_RETRY_MS = 100;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Thrown when a transient-state file stays cross-process-locked past the retry
 * budget. Signals real contention (another process holding the lock for
 * seconds), not a transient collision — those are absorbed by the retry loop.
 */
export class TransientStateLockError extends Error {
  readonly lockPath: string;
  constructor(lockPath: string) {
    super(`transient state lock could not be acquired: ${lockPath}`);
    this.name = "TransientStateLockError";
    this.lockPath = lockPath;
  }
}

interface UpdateOptions<T> {
  boxRoot: string;
  connectorName: string;
  defaultValue: T;
  /**
   * Receives FRESHLY-loaded state (loaded inside the lock, never a snapshot the
   * caller captured earlier) and returns the updated state. Express the change
   * as a delta against `state`, so overlapping updates compose instead of
   * clobbering. May be sync or async.
   */
  update: (state: T) => T | Promise<T>;
}

/**
 * Serialized read-modify-write for a connector's transient state file.
 *
 * The eight RMW spans over `<name>.state.json` used to run unlocked, so two
 * overlapping spans both read the pre-mutation bytes and the last writer
 * silently dropped the other's change. This funnels every RMW through two
 * locks, layered deliberately:
 *
 *   - **`withCardLock` (in-process) is the OUTER lock**, keyed on the resolved
 *     state-file path. Two modules mutating the same file (e.g. `telegram.ts`
 *     and `telegram-outbound.ts` both on `telegram.state.json`) share one
 *     lock. It must be outer because the cross-process lock cannot distinguish
 *     two racers in the *same* process — both would see a live holder with our
 *     own PID and spin until the retry budget throws. Serializing in-process
 *     first guarantees only one task per process ever contends for the file
 *     lock, so that lock only ever arbitrates *across* processes.
 *   - **The cross-process file lock (`file-lock.ts`) is the INNER lock**, on a
 *     SIBLING `<state-file>.lock` path — NEVER the state file itself, because
 *     `acquireLock()` writes a diagnostic holder sidecar AT the lock path (and
 *     a `<lock>.guard` dir beside it), which would overwrite real state if the
 *     state file were used as the lock path. `google-drive.state.json` is written by both the server and
 *     the CLI, so the cross-process half is load-bearing; we take it uniformly
 *     for every connector (one lockfile touch per RMW, all low-frequency
 *     paths). `acquireLock()` throws `LockHeldError` immediately rather than
 *     queueing, so we retry with backoff (~50 × 100ms) to turn contention into
 *     a wait, not a connector error.
 *
 * Fresh state is loaded INSIDE both locks and passed to `update`; its return
 * is saved and returned. Returns the updated state.
 */
export async function updateTransientState<T>(opts: UpdateOptions<T>): Promise<T> {
  const { boxRoot, connectorName, defaultValue, update } = opts;
  const statePath = transientStatePath(boxRoot, connectorName);
  const lockPath = `${statePath}.lock`;

  // withCardLock is OUTER (see the doc comment): serialize same-process racers
  // before either one reaches the cross-process lock.
  return withCardLock(statePath, async () => {
    // acquireLock's guard-dir mkdir needs the containing dir to exist; on first
    // run config/connectors/ may be absent. (acquireLock also mkdirs defensively,
    // but keep this explicit for the OUTER lock's own reasoning.)
    await fs.mkdir(path.dirname(lockPath), { recursive: true });

    for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
      try {
        await acquireLock(lockPath, { purpose: "transient-state", connectorName });
      } catch (e) {
        if (e instanceof LockHeldError) {
          // Held by ANOTHER process (a same-process holder is impossible here —
          // withCardLock already serialized us). Wait and retry.
          await delay(LOCK_RETRY_MS);
          continue;
        }
        throw e;
      }
      try {
        const state = await loadTransientState({ boxRoot, connectorName, defaultValue });
        const updated = await update(state);
        await saveTransientState({ boxRoot, connectorName, data: updated });
        return updated;
      } finally {
        await releaseLock(lockPath);
      }
    }
    throw new TransientStateLockError(lockPath);
  });
}
