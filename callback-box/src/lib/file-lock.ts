/**
 * Machine-local file lock primitive.
 *
 * This is the canonical lock for the project. All cross-process locks
 * (wakeup mutex in cli/lib/lock.ts, scheduled-script + lock-group locks
 * in core/schedule-state.ts, reactor mutex in core/reactor/engine.ts) sit
 * on top of it. Don't add a new lock surface elsewhere — extend or wrap
 * this instead.
 *
 * ## How it works
 *
 * The lock *is* a single JSON file at the caller-chosen path. Acquisition
 * is atomic *against its own content*: the fully-serialized holder JSON is
 * written to a unique temp sibling, then hard-`link()`ed into place. `link`
 * fails EEXIST if the lock already exists (O_EXCL semantics), and the target
 * name only becomes visible once it already points at fully-written content —
 * so a contender can NEVER observe the lock file in an empty, mid-publication
 * state. (The previous `fs.open(path, "wx")`-then-write approach left an empty
 * file visible between the open and the write; a racing reader saw "no holder"
 * and both callers acquired. See the file-lock-empty-window-race issue.) The
 * file body carries the holder's identity:
 *
 *   { pid, bootEpochSeconds, hostname, acquiredAt, token, metadata }
 *
 * `token` is a per-acquisition random value. It is the strong ownership
 * identity: `releaseLock` deletes the file only when the on-disk token matches
 * the token this process recorded when it acquired (held in an in-process
 * map). PID/host/boot alone can't distinguish two acquisitions from the *same*
 * process, so without the token a racing co-PID release could delete a live
 * sibling holder's lock. A dead/malformed holder is still reclaimed by the
 * liveness check; only a *live foreign* holder is protected from deletion.
 *
 * Liveness is checked directly with `process.kill(pid, 0)` plus a
 * boot-epoch comparison (`Date.now()/1000 - os.uptime()`, ±30s tolerance
 * for NTP jitter). PID-reuse after a reboot is caught by the boot-epoch
 * mismatch. Different hostname → treated as live and never reclaimed.
 *
 * Dead holders self-heal: any read path that finds a holder whose PID is
 * gone (or whose boot epoch differs by more than the tolerance) deletes
 * the file and proceeds. Malformed JSON / missing required fields are
 * treated the same way.
 *
 * ## Why not proper-lockfile / mtime staleness?
 *
 * The previous implementation used `proper-lockfile`, which detects stale
 * locks via mtime heartbeats. Two failure modes drove the rewrite:
 *
 *   1. macOS sleep paused the heartbeat, so live locks looked stale on
 *      wake and got stolen.
 *   2. SIGKILL (e.g. a per-script timeout firing) left orphaned
 *      `.lock.lock` directories that no code path cleaned up.
 *
 * PID-based liveness is immune to both: process state is the source of
 * truth, no clocks involved.
 *
 * ## Scope
 *
 * Single machine. The state directories that consume this primitive
 * (`config/schedules/.state/`, `.cb-lock`, `.cb-reactor.lock`) are
 * gitignored, so cross-machine contention is out of scope. The hostname
 * field is recorded for inspectability and to defensively skip cleanup
 * of locks owned by another host.
 *
 * In-process async serialization (e.g. capture.ts's per-session promise
 * chain) is a different problem — there's no other process to coordinate
 * with, only concurrent async tasks within one Node process. Use a
 * `Map<id, Promise>` for that, not file locks (see `card-lock.ts` and
 * `core/capture/staging-store.ts`).
 *
 * ## Lock table (every lock in the system)
 *
 * Consult this before adding a lock so the new one has an ordering
 * convention to fit into. "cross-proc" = this file's PID-based file lock;
 * "in-proc" = a `Map<key, Promise>` chain within one Node process.
 *
 * | Lock | Kind | Path / key | Scope (what it guards) | Held by | Typical hold |
 * |------|------|-----------|------------------------|---------|-------------|
 * | Reactor mutex | cross-proc | `<box>/.cb-reactor.lock` | one reactor cycle per box | reactor engine (`cb wakeup`) | one cycle (s–min) |
 * | Scheduled-script | cross-proc | `<box>/config/schedules/.state/<script>.lock` (+ lock-group ids) | one run per script / lock-group | scheduler (`cb tick`, `scheduler.trigger`) | one script run |
 * | Chat-active | cross-proc | `<box>/.callback-box/active-chats/<runId>.lock` | signals a live SDK chat run so tick/housekeeping defer | `ChatSession` run | one SDK chat turn |
 * | Push store | cross-proc | `<pushStoreDir>/push-subscriptions.json.lock` | server-wide subscription store RMW | push subscribe/unsubscribe | single RMW (ms) |
 * | Search index | cross-proc | `<box>/.callback-box/<lock file>` | index refresh serialization | `search/refresh.ts` | one index rebuild |
 * | Capture staging | in-proc (`withStagingLock`) | session id | per-`session.json` RMW (concurrent uploads) | capture upload route; entry dropped by `cleanupStagingSession` | single RMW |
 * | Card write | in-proc (`withCardLock`) | `path.resolve(file)` | per-file card/config read-modify-write within one process | tRPC mutations (todos/scheduler/admin), connector thread writes, `answer`/`transcription` core; map self-drains | single RMW |
 * | Git index | git-owned | `<box>/.git/index.lock` | staging/commit | any `git commit` (not ours) | retried once on collision (`lib/git.ts`) |
 *
 * Ordering notes. The cross-process and in-process tiers are orthogonal —
 * different failure models, no shared key space. In-process: `withCardLock`
 * is per file; never nest it on the *same* path (it throws
 * `ReentrantCardLockError` rather than deadlock). A `withCardLock` critical
 * section deliberately spans the git stage+commit that follows the write, so
 * it briefly touches the whole-repo git index — but `withCardLock` only
 * serializes same-file racers, so two *different* cards committing at once
 * can still race on `.git/index.lock` (handled by git.ts's retry, not by
 * these locks; the git-commit race is a separate concern). Avoid holding two
 * `withCardLock` locks on different files in inconsistent order across call
 * sites.
 *
 * ## API
 *
 * - `acquireLock(path, metadata)` — atomic; throws LockHeldError if a
 *   live holder owns it. Reclaims dead/malformed holders automatically.
 * - `releaseLock(path)` — idempotent; only deletes the file if the on-disk
 *   holder's token matches the one this process recorded on acquire.
 * - `inspectLock(path)` — read holder; returns null if not held or dead
 *   (cleans up dead as a side effect).
 * - `forceAcquireLock(path, metadata)` — steal whoever owns it.
 * - `scanLocks(dir, suffix)` — read all matching lock files; returns a
 *   map of name → holder for live ones, deletes dead ones.
 */

import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { errnoCode } from "./error-guards.js";
import { isRecord } from "./is-record.js";

export interface LockHolder {
  pid: number;
  bootEpochSeconds: number;
  hostname: string;
  acquiredAt: string;
  /**
   * Per-acquisition random ownership token. Optional so a lock file written by
   * an older build (or a hand-constructed foreign holder) still parses and is
   * liveness-checked — a tokenless holder simply can't be matched by our
   * token-based `releaseLock`, which is the safe (never-delete) direction.
   */
  token?: string;
  metadata: Record<string, unknown>;
}

/**
 * Tokens of locks THIS process currently holds, keyed by lock path. Populated
 * on acquire, consulted by `releaseLock` so we only ever delete a lock whose
 * on-disk token still matches the one we wrote — never a racing co-PID
 * holder's live lock.
 */
const heldTokens = new Map<string, string>();

export class LockHeldError extends Error {
  readonly holder: LockHolder;
  constructor(holder: LockHolder) {
    super(`Lock held by pid ${holder.pid} on ${holder.hostname} (acquired ${holder.acquiredAt})`);
    this.name = "LockHeldError";
    this.holder = holder;
  }
}

class LockAcquireFailedError extends Error {
  constructor(readonly path: string) {
    super(`Failed to acquire lock at ${path} after retry`);
    this.name = "LockAcquireFailedError";
  }
}

class LockForceAcquireFailedError extends Error {
  constructor(readonly path: string) {
    super(`Failed to force-acquire lock at ${path}`);
    this.name = "LockForceAcquireFailedError";
  }
}

// Tolerance window for boot-epoch comparison. NTP corrections at startup
// can shift Date.now()-os.uptime() by a few seconds; a real reboot is well
// outside this window, so we still detect it.
const BOOT_TOLERANCE_SECONDS = 30;

function currentBootEpochSeconds(): number {
  return Math.floor(Date.now() / 1000 - os.uptime());
}

function sameBoot(a: number, b: number): boolean {
  return Math.abs(a - b) <= BOOT_TOLERANCE_SECONDS;
}

function makeHolder(metadata: Record<string, unknown>): LockHolder {
  return {
    pid: process.pid,
    bootEpochSeconds: currentBootEpochSeconds(),
    hostname: os.hostname(),
    acquiredAt: new Date().toISOString(),
    token: randomBytes(16).toString("hex"),
    metadata,
  };
}

function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = errnoCode(err);
    if (code === "ESRCH") return false;
    // EPERM means the process exists but we can't signal it (different uid).
    // Anything unexpected — be conservative and treat as live.
    return true;
  }
}

/**
 * Decide whether a recorded lock holder is still alive on this machine.
 * Cross-host holders are always treated as alive (we can't introspect them).
 */
function isHolderLive(holder: LockHolder): boolean {
  if (holder.hostname !== os.hostname()) return true;
  if (!sameBoot(holder.bootEpochSeconds, currentBootEpochSeconds())) return false;
  return pidExists(holder.pid);
}

function isWellFormedHolder(value: unknown): value is LockHolder {
  if (!isRecord(value)) return false;
  const token = value["token"];
  return typeof value["pid"] === "number" &&
    typeof value["bootEpochSeconds"] === "number" &&
    typeof value["hostname"] === "string" &&
    typeof value["acquiredAt"] === "string" &&
    (token === undefined || typeof token === "string") &&
    typeof value["metadata"] === "object" && value["metadata"] !== null;
}

async function readHolder(path: string): Promise<LockHolder | null> {
  let content: string;
  try {
    content = await fs.readFile(path, "utf-8");
  } catch (err) {
    const code = errnoCode(err);
    if (code === "ENOENT") return null;
    return null;
  }
  const trimmed = content.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (_e) {
    // Malformed JSON — treat as no holder so it can be reclaimed.
    return null;
  }
  if (!isWellFormedHolder(parsed)) return null;
  return parsed;
}

/**
 * Publish the lock file atomically against its own content: write the fully
 * serialized holder to a unique temp sibling, then hard-`link()` it onto the
 * lock path. The lock name only ever appears already pointing at complete
 * content, and `link` fails EEXIST if the lock already exists — so this is both
 * O_EXCL against concurrent creators AND free of the empty-file publication
 * window that `fs.open(path, "wx")`-then-write had. Returns false on EEXIST
 * (someone else holds it), true on success. The temp is always unlinked.
 */
async function writeLockAtomic(path: string, holder: LockHolder): Promise<boolean> {
  const tmp = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  // "wx" on the temp: unique name, so a collision is a real anomaly worth throwing on.
  await fs.writeFile(tmp, JSON.stringify(holder, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  try {
    await fs.link(tmp, path);
    return true;
  } catch (err) {
    const code = errnoCode(err);
    if (code === "EEXIST") return false;
    throw err;
  } finally {
    await unlinkIgnoringMissing(tmp);
  }
}

async function unlinkIgnoringMissing(path: string): Promise<void> {
  try {
    await fs.unlink(path);
  } catch (err) {
    const code = errnoCode(err);
    if (code !== "ENOENT") throw err;
  }
}

/**
 * Atomically acquire a lock. Throws LockHeldError if a live holder owns it.
 * Dead holders (crashed, killed, post-reboot) are reclaimed automatically.
 */
export async function acquireLock(
  path: string,
  metadata: Record<string, unknown>,
): Promise<LockHolder> {
  const holder = makeHolder(metadata);

  if (await writeLockAtomic(path, holder)) return recordHeld(path, holder);

  // File exists. Check who owns it.
  const existing = await readHolder(path);
  if (existing && isHolderLive(existing)) {
    throw new LockHeldError(existing);
  }

  // Existing is dead or malformed. Reclaim and retry once.
  await unlinkIgnoringMissing(path);
  if (await writeLockAtomic(path, holder)) return recordHeld(path, holder);

  // Race: someone else acquired between our unlink and write.
  const winner = await readHolder(path);
  if (winner && isHolderLive(winner)) {
    throw new LockHeldError(winner);
  }
  throw new LockAcquireFailedError(path);
}

/** Record our ownership token for a freshly-acquired lock and return the holder. */
function recordHeld(path: string, holder: LockHolder): LockHolder {
  if (holder.token !== undefined) heldTokens.set(path, holder.token);
  return holder;
}

/**
 * Release a lock previously acquired by this process. Idempotent.
 * If the lock is now owned by someone else (we crashed, they reclaimed),
 * we leave their lock alone.
 */
export async function releaseLock(path: string): Promise<void> {
  const ourToken = heldTokens.get(path);
  heldTokens.delete(path);
  // We only ever recorded a token for a lock we successfully acquired, so no
  // record means it isn't ours to delete (idempotent no-op / foreign holder).
  if (ourToken === undefined) return;
  const existing = await readHolder(path);
  if (existing === null) return;
  // A co-PID racer may have reclaimed and re-published under a new token; only
  // delete the file if it still carries OUR token.
  if (existing.token !== ourToken) return;
  await unlinkIgnoringMissing(path);
}

/**
 * Read the current holder of a lock, or null if not held.
 * Dead holders are cleaned up as a side effect.
 */
export async function inspectLock(path: string): Promise<LockHolder | null> {
  const existing = await readHolder(path);
  if (existing === null) return null;
  if (!isHolderLive(existing)) {
    await unlinkIgnoringMissing(path);
    return null;
  }
  return existing;
}

/**
 * Forcefully take a lock, evicting whatever is there (live or dead).
 * Use only when the caller has decided to override an active holder.
 */
export async function forceAcquireLock(
  path: string,
  metadata: Record<string, unknown>,
): Promise<LockHolder> {
  await unlinkIgnoringMissing(path);
  const holder = makeHolder(metadata);
  if (await writeLockAtomic(path, holder)) return recordHeld(path, holder);
  // Race with another acquirer; one more shot.
  await unlinkIgnoringMissing(path);
  if (await writeLockAtomic(path, holder)) return recordHeld(path, holder);
  throw new LockForceAcquireFailedError(path);
}

/**
 * Scan a directory for lock files matching the given suffix. Returns a map
 * of name (filename without suffix) to live holder. Dead holders are cleaned
 * up as a side effect.
 */
export async function scanLocks(
  dir: string,
  suffix: string,
): Promise<Map<string, LockHolder>> {
  const result = new Map<string, LockHolder>();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    const code = errnoCode(err);
    if (code === "ENOENT") return result;
    throw err;
  }
  for (const entry of entries) {
    if (!entry.endsWith(suffix)) continue;
    const fullPath = `${dir}/${entry}`;
    const holder = await readHolder(fullPath);
    if (holder === null) {
      await unlinkIgnoringMissing(fullPath);
      continue;
    }
    if (!isHolderLive(holder)) {
      await unlinkIgnoringMissing(fullPath);
      continue;
    }
    const name = entry.slice(0, -suffix.length);
    result.set(name, holder);
  }
  return result;
}
