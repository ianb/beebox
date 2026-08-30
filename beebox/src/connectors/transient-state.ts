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
import { writeFileAtomic } from "../lib/atomic-write.js";
import { errnoCode } from "../lib/error-guards.js";

import { withCardLock } from "../lib/card-lock.js";
import { acquireLock, releaseLock, requestScopedLock, LockHeldError } from "../lib/file-lock.js";

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
 * Thrown when a state file exists but can't be read or parsed. Fails CLOSED
 * rather than falling back to `defaultValue`, because for these files "missing"
 * and "corrupt" mean opposite things. Missing is first run: the default is
 * correct and the connector legitimately starts from scratch. Corrupt is a
 * truncated or damaged file — resolving it to the default would silently
 * discard sync tokens, Telegram thread mappings, and alert latches, and the
 * very next `updateTransientState` would write that loss back over the file.
 * A corrupt state file is a human problem: inspect it, or delete it to
 * deliberately choose the from-scratch resync.
 */
export class TransientStateCorruptError extends Error {
  readonly statePath: string;
  constructor(filePath: string, options: { cause: unknown }) {
    super(
      `Transient state at ${filePath} exists but could not be read or parsed. ` +
        "Refusing to fall back to defaults — inspect the file, or delete it to resync from scratch.",
      options,
    );
    this.name = "TransientStateCorruptError";
    this.statePath = filePath;
  }
}

/**
 * Load transient state, returning `defaultValue` when the file doesn't exist.
 * Any other read failure, and unparseable JSON, throw
 * {@link TransientStateCorruptError} — see there for why this doesn't degrade.
 */
export async function loadTransientState<T>(opts: LoadOptions<T>): Promise<T> {
  const filePath = transientStatePath(opts.boxRoot, opts.connectorName);
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch (e) {
    // Transient state is gitignored and absent on first run — a missing file is
    // the normal path to defaultValue.
    if (errnoCode(e) === "ENOENT") return opts.defaultValue;
    throw new TransientStateCorruptError(filePath, { cause: e });
  }
  try {
    return JSON.parse(content);
  } catch (e) {
    throw new TransientStateCorruptError(filePath, { cause: e });
  }
}

interface SaveOptions {
  boxRoot: string;
  connectorName: string;
  data: unknown;
}

/**
 * Save transient state, crash-safely (temp file + fsync + atomic rename). A
 * plain `writeFile` truncates first, so a kill mid-write would leave a
 * truncated file — which `loadTransientState` now (correctly) refuses to read,
 * wedging the connector until a human intervenes. Never leave that torn state
 * reachable in the first place.
 */
async function saveTransientState(opts: SaveOptions): Promise<void> {
  await writeFileAtomic(transientStatePath(opts.boxRoot, opts.connectorName), {
    content: JSON.stringify(opts.data, null, 2) + "\n",
  });
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
class TransientStateLockError extends Error {
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
  // Request-scoped: a short critical section whose callers fail fast (~5 s
  // retry budget), so a crashed holder must clear in seconds, not minutes.
  const lock = requestScopedLock(lockPath);

  // withCardLock is OUTER (see the doc comment): serialize same-process racers
  // before either one reaches the cross-process lock.
  return withCardLock(statePath, async () => {
    // acquireLock's guard-dir mkdir needs the containing dir to exist; on first
    // run config/connectors/ may be absent. (acquireLock also mkdirs defensively,
    // but keep this explicit for the OUTER lock's own reasoning.)
    await fs.mkdir(path.dirname(lockPath), { recursive: true });

    for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
      try {
        await acquireLock(lock, { purpose: "transient-state", connectorName });
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
        await releaseLock(lock);
      }
    }
    throw new TransientStateLockError(lockPath);
  });
}
