/**
 * Machine-local cross-process file lock primitive.
 *
 * This is the canonical lock for the project. All cross-process locks
 * (wakeup mutex in cli/lib/lock.ts, scheduled-script + lock-group locks
 * in core/schedule/state.ts, reactor mutex in core/reactor/engine.ts, the
 * mobile device-store revoke in core/mobile/pairing.ts, ...) sit on top of
 * it. Don't add a new lock surface elsewhere — extend or wrap this instead.
 *
 * ## How it works — the exclusion invariant
 *
 * Mutual exclusion is delegated entirely to **`proper-lockfile`**, a proven
 * pure-JS advisory lock. Its exclusion mechanism is a single atomic
 * `mkdir()` of a *guard directory* (`<path>.guard`): `mkdir` fails `EEXIST`
 * if the directory already exists, and on both POSIX and Windows at most one
 * caller can create it — so at most one process holds the lock. There is no
 * hand-rolled "read who owns it, then unlink, then recreate" reclaim path
 * anywhere in this module; that unconditional-unlink pattern is precisely the
 * reclaim/release race that the previous home-grown implementation shipped
 * (and that failed adversarial review twice — see the file-lock-empty-window
 * -race issue). Stale-holder reclaim is proper-lockfile's own mtime
 * compare-and-swap (steal only when the guard's mtime is older than the
 * `stale` threshold), never a delete-by-path.
 *
 * Alongside the guard directory we write a **diagnostic sidecar file at
 * `path`** carrying the holder's identity:
 *
 *   { pid, hostname, acquiredAt, metadata }
 *
 * The sidecar is written *after* the guard `mkdir` wins and is read *only*
 * for diagnostics (`LockHeldError.holder`, `inspectLock`, `scanLocks`). It
 * NEVER participates in the acquire decision, so no sidecar state — empty,
 * missing, torn, stale, or concurrently rewritten — can ever admit a second
 * holder. (This is what kills the old empty-publication window: exclusion no
 * longer depends on the lock file's *content* being present and parseable.)
 *
 * Every on-disk deletion of lock state happens in exactly one of two safe
 * ways: (1) proper-lockfile's own `release`, which cancels the refresh timer
 * and removes the guard dir; or (2) our reclaim path (`scanLocks`), which
 * removes a dead holder's sidecar+guard *only while atomically holding the
 * lock* via proper-lockfile. No code path deletes a live foreign holder's
 * guard directory (the one exception is the deliberate `forceAcquireLock`
 * steal, which is documented as such and has no production callers).
 *
 * ## Staleness, crash recovery, and the macOS-sleep tradeoff
 *
 * `stale` comes from the lock's **profile** ({@link LOCK_STALE_MS}), which
 * rides with the lock path: a bare path is the `default` profile (5 min);
 * `requestScopedLock(path)` is the `request` profile (15 s). The profile is a
 * property of the lock *class*, so every staleness surface — acquire, `check`
 * (`inspectLock`), `scanLocks`'s reclaim, and the `onCompromised` message —
 * reads the same number; acquisition and diagnostics can never disagree about
 * when a lock is stale. While the holding process is alive proper-lockfile
 * refreshes the guard's mtime every `stale/2`, so a live lock stays fresh for
 * an unbounded hold as long as the event loop runs — hold duration does NOT
 * need to fit under `stale`. The threshold governs two things:
 *
 *   - **Crash recovery.** A SIGKILL'd holder (e.g. `cb tick`'s 10-minute
 *     per-script timeout firing) leaves a guard dir that no exit handler
 *     cleaned up; the next acquirer reclaims it once its mtime is older than
 *     the profile's window. 5 min sits comfortably under that 10-min killer,
 *     so a wedged run's lock always clears before the run itself is
 *     force-killed. Request-scoped stores (mobile devices, local users,
 *     connector token/state stores, push subscriptions, question transitions)
 *     can't wait that long: a `cb serve` OOM once wedged mobile auth for
 *     minutes because every caller retries only ~5 s and then fails loud
 *     (prod incident 2026-08-01). Those declare the `request` profile, so a
 *     crashed holder blocks their store for ≤ ~15 s. Their retry budgets stay
 *     short deliberately — inside that window callers still fail *loud*
 *     (a thrown lock error) rather than hang or silently double-acquire.
 *
 *     The tradeoff: a *live* request-scoped holder paused past 15 s
 *     mid-critical-section (a long GC/event-loop stall, a laptop sleep)
 *     becomes stealable. These critical sections are milliseconds — a read,
 *     an object mutation, and a temp-file write + fsync + rename — nowhere
 *     near 15 s, and a steal still fires `onCompromised`, which logs LOUDLY.
 *     PID-liveness fast reclaim (steal immediately once the holder's pid is
 *     gone) would remove the wait entirely and was explicitly declined
 *     (boxholder decision, 2026-08-01): it adds a second liveness authority
 *     next to the mtime CAS. If it's ever revisited it must layer on the
 *     mkdir CAS, never become an independent unlink path.
 *
 *   - **Sleep tolerance.** proper-lockfile's refresh runs on a `setTimeout`,
 *     which on macOS is paused during system sleep (see the awake-timeout
 *     discipline in `src/lib/awake-timeout.ts`). A generous 5-min `stale`
 *     means a normal brief sleep (lid closed for a few minutes mid-hold) does
 *     NOT make a live holder's lock look stale to a contender on wake. A sleep
 *     LONGER than `stale` still can: a live-but-sleeping holder's guard is
 *     seen stale and may be stolen. When that happens the victim's refresh
 *     detects the theft on its next tick and fires `onCompromised`, which
 *     logs LOUDLY (`console.error`) — the degradation is always observable,
 *     never silent. These locks are held for seconds-to-minutes and released
 *     long before a machine idles into sleep, so surviving across a real sleep
 *     is not an expected steady state. This sleep-vs-crash-recovery tension is
 *     inherent to any mtime-freshness lock; the two profiles are the chosen
 *     balance — sleep tolerance for long holds, fast recovery for request
 *     paths that would rather be stolen from than stay wedged.
 *
 * ## Scope
 *
 * Single machine. The state directories that consume this primitive
 * (`config/schedules/.state/`, `.cb-lock`, `.cb-reactor.lock`, the device
 * store's `.lock`) are gitignored, so cross-machine contention is out of
 * scope. The hostname field is recorded for inspectability only.
 *
 * In-process async serialization (concurrent async tasks within ONE Node
 * process racing on the same file) is a different problem — use
 * `withCardLock` (`card-lock.ts`), not this. The two layers compose:
 * card-lock serializes same-process racers; file-lock arbitrates across
 * processes. See `card-lock.ts` for the full lock table.
 *
 * ## API
 *
 * Every lock-taking call takes a `LockTarget`: a bare path (default profile)
 * or `requestScopedLock(path)` (request profile).
 *
 * - `acquireLock(target, metadata)` — non-blocking; throws `LockHeldError` if a
 *   live holder owns it. Stale/crashed holders are reclaimed by proper-lockfile.
 * - `releaseLock(target)` — idempotent; releases only a lock THIS process holds
 *   (tracked per-path). Releasing one we don't hold is a no-op — it can never
 *   delete a foreign holder's lock.
 * - `inspectLock(target)` — read the current holder via proper-lockfile's
 *   `.check()`, or null if not held / stale.
 * - `forceAcquireLock(target, metadata)` — deliberately evict whoever owns it.
 * - `scanLocks(dir, { suffix, profile })` — map of name → live holder; reclaims
 *   dead ones (at the given profile's staleness).
 */

import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as lockfile from "proper-lockfile";
import { errnoCode } from "./error-guards.js";
import { isRecord } from "./is-record.js";

/**
 * Diagnostic identity of a lock holder. Written to the sidecar file at the
 * lock path AFTER exclusion is won; consumed only for diagnostics (never for
 * the acquire decision). Liveness is owned by proper-lockfile, so this no
 * longer carries the old `bootEpochSeconds`/`token` liveness fields.
 */
export interface LockHolder {
  pid: number;
  hostname: string;
  acquiredAt: string;
  metadata: Record<string, unknown>;
}

/**
 * Which stale profile a lock class uses. `"default"` suits long-held locks
 * (scheduled scripts, the reactor); `"request"` is for the short
 * read-modify-write critical sections behind an HTTP request. See the module
 * comment's staleness section.
 */
export type LockProfile = "default" | "request";

/**
 * Stale threshold per profile, in milliseconds — the age at which a guard
 * dir's mtime makes its holder reclaimable. Exported so tests can assert the
 * recovery SLO without sleeping through it.
 */
export const LOCK_STALE_MS: Record<LockProfile, number> = {
  default: 5 * 60 * 1000,
  request: 15 * 1000,
};

/** A lock path together with its lock class's stale profile. */
export interface LockRef {
  lockPath: string;
  profile: LockProfile;
}

/**
 * A lock to operate on: a bare path (the default profile) or a profiled ref
 * from {@link requestScopedLock}. The profile rides with the path because
 * staleness is a property of the lock *class*, not of one call — every
 * surface (acquire, release, inspect, scan-reclaim, the compromised log) must
 * agree about when that lock is stale.
 */
export type LockTarget = string | LockRef;

/**
 * Declare a request-scoped lock: one whose critical section is a few
 * milliseconds inside an HTTP request, so a crashed holder must clear in
 * seconds rather than minutes. Wrap the path once where it's computed, then
 * pass the ref to `acquireLock`/`releaseLock`/`inspectLock`.
 */
export function requestScopedLock(lockPath: string): LockRef {
  return { lockPath, profile: "request" };
}

function lockRef(target: LockTarget): LockRef {
  return typeof target === "string" ? { lockPath: target, profile: "default" } : target;
}

/** The stale window of a lock's class — the single source every staleness
 *  surface (acquire, check, reclaim, the compromised log) reads. */
function staleMs(ref: LockRef): number {
  return LOCK_STALE_MS[ref.profile];
}

/**
 * Release functions for locks THIS process currently holds, keyed by lock
 * path. Populated on acquire, consulted by `releaseLock` so we only ever
 * release a lock we actually hold — proper-lockfile's release also verifies
 * continued ownership before removing the guard dir, so this can never delete
 * a foreign holder's lock.
 */
const heldReleases = new Map<string, () => Promise<void>>();

export class LockHeldError extends Error {
  readonly holder: LockHolder;
  constructor(holder: LockHolder) {
    super(`Lock held by pid ${holder.pid} on ${holder.hostname} (acquired ${holder.acquiredAt})`);
    this.name = "LockHeldError";
    this.holder = holder;
  }
}

class LockForceAcquireFailedError extends Error {
  constructor(readonly lockPath: string) {
    super(`Failed to force-acquire lock at ${lockPath}`);
    this.name = "LockForceAcquireFailedError";
  }
}

/** The guard-directory path proper-lockfile mkdir-locks for a given lock path.
 *  Deliberately does NOT end in the caller's `.lock` suffix, so `scanLocks`'s
 *  suffix match enumerates only sidecar files, never guard directories. */
function guardPath(lockPath: string): string {
  return `${lockPath}.guard`;
}

function lockOptions(ref: LockRef): lockfile.LockOptions {
  return {
    // Our lock path is not a real resource file (and may not exist), so skip
    // proper-lockfile's realpath resolution, which would ENOENT on it.
    realpath: false,
    stale: staleMs(ref),
    lockfilePath: guardPath(ref.lockPath),
    onCompromised: makeOnCompromised(ref),
  };
}

function checkOptions(ref: LockRef): lockfile.CheckOptions {
  return { realpath: false, stale: staleMs(ref), lockfilePath: guardPath(ref.lockPath) };
}

/**
 * proper-lockfile calls this on the holder's refresh timer when it can no
 * longer prove it still owns the guard dir (mtime no longer ours — a long
 * event-loop stall, a system sleep past `stale`, or another process stealing
 * the stale lock). The default handler THROWS, which would surface as an
 * unhandled rejection; ours logs loudly instead. This is a real degradation:
 * any critical section still running under this lock is no longer excluded.
 */
function makeOnCompromised(ref: LockRef): (err: Error) => void {
  return (err) => {
    heldReleases.delete(ref.lockPath);
    console.error(
      `[file-lock] COMPROMISED: lost cross-process lock ${ref.lockPath} we believed we held. ` +
        `proper-lockfile could not refresh its guard within the ${ref.profile} profile's ` +
        `${staleMs(ref)}ms stale window ` +
        "(likely a long event-loop stall, a system sleep, or another process stealing the " +
        "stale lock). Any critical section still running under this lock is NO LONGER " +
        "mutually excluded — investigate for a possible lost update.",
      err,
    );
  };
}

function isLockedError(e: unknown): boolean {
  return errnoCode(e) === "ELOCKED";
}

function makeHolder(metadata: Record<string, unknown>): LockHolder {
  return {
    pid: process.pid,
    hostname: os.hostname(),
    acquiredAt: new Date().toISOString(),
    metadata,
  };
}

function isWellFormedHolder(value: unknown): value is LockHolder {
  if (!isRecord(value)) return false;
  return (
    typeof value["pid"] === "number" &&
    typeof value["hostname"] === "string" &&
    typeof value["acquiredAt"] === "string" &&
    typeof value["metadata"] === "object" &&
    value["metadata"] !== null
  );
}

/**
 * A stand-in holder for the tiny window where a lock is genuinely held (guard
 * dir exists) but its diagnostic sidecar hasn't been written yet, or is torn.
 * Exclusion never depends on the sidecar, so a diagnostic read must still
 * report "held" rather than "free" here.
 */
function unknownHolder(): LockHolder {
  return { pid: -1, hostname: os.hostname(), acquiredAt: new Date().toISOString(), metadata: {} };
}

/** Read the diagnostic sidecar holder at `path`, or null if absent/unparseable.
 *  Never influences an acquire — only diagnostics. */
async function readHolder(lockPath: string): Promise<LockHolder | null> {
  let content: string;
  try {
    content = await fs.readFile(lockPath, "utf-8");
  } catch (_e) {
    return null;
  }
  const trimmed = content.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (_e) {
    return null;
  }
  return isWellFormedHolder(parsed) ? parsed : null;
}

/** Write the diagnostic sidecar atomically (temp + rename) so a concurrent
 *  diagnostic read never sees a torn file. Safe to rename over any prior
 *  sidecar: we hold the guard dir, so no other holder exists. */
async function writeSidecar(lockPath: string, holder: LockHolder): Promise<void> {
  const tmp = `${lockPath}.${randomBytes(8).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(holder, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  await fs.rename(tmp, lockPath);
}

async function unlinkIgnoringMissing(target: string): Promise<void> {
  try {
    await fs.unlink(target);
  } catch (err) {
    if (errnoCode(err) !== "ENOENT") throw err;
  }
}

/**
 * Atomically acquire a lock. Throws `LockHeldError` if a live holder owns it.
 * Stale/crashed holders are reclaimed by proper-lockfile's mtime compare-and
 * -swap. Non-blocking (proper-lockfile `retries: 0` default).
 */
export async function acquireLock(
  target: LockTarget,
  metadata: Record<string, unknown>,
): Promise<LockHolder> {
  const ref = lockRef(target);
  const lockPath = ref.lockPath;
  // proper-lockfile mkdir's the guard dir; its parent (== the lock path's
  // parent) must exist. Callers generally mkdir their state dir already; do it
  // defensively so acquisition is robust on a cold first run.
  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  let release: () => Promise<void>;
  try {
    release = await lockfile.lock(lockPath, lockOptions(ref));
  } catch (e) {
    if (isLockedError(e)) {
      throw new LockHeldError((await readHolder(lockPath)) ?? unknownHolder());
    }
    throw e;
  }

  const holder = makeHolder(metadata);
  try {
    await writeSidecar(lockPath, holder);
  } catch (e) {
    // We hold the guard but couldn't publish the diagnostic sidecar (disk
    // full, permissions). Release so we don't leave a held-but-undiagnosable
    // lock, then fail the acquire.
    await release().catch((releaseErr: unknown) => {
      console.warn(`[file-lock] failed to release ${lockPath} after sidecar write error:`, releaseErr);
    });
    throw e;
  }
  heldReleases.set(lockPath, release);
  return holder;
}

/**
 * Release a lock previously acquired by this process. Idempotent, and
 * foreign-holder-safe: with no recorded release for `path` this is a no-op,
 * and proper-lockfile's release verifies continued ownership before removing
 * the guard dir — releasing a lock we no longer hold never deletes someone
 * else's.
 */
export async function releaseLock(target: LockTarget): Promise<void> {
  const lockPath = lockRef(target).lockPath;
  const release = heldReleases.get(lockPath);
  heldReleases.delete(lockPath);
  if (release === undefined) return;
  try {
    await release();
  } catch (e) {
    // ERELEASED (already released) / ECOMPROMISED (stolen while we slept) are
    // benign here — the lock isn't ours to remove anymore. Anything else is
    // unexpected and worth surfacing, but release must not throw to callers.
    console.warn(`[file-lock] release of ${lockPath} did not complete cleanly:`, e);
  }
  // The guard dir is gone (removed by release); drop the diagnostic sidecar
  // too. Best-effort — a lingering sidecar is harmless (reads gate on the
  // guard dir, not the sidecar).
  await unlinkIgnoringMissing(lockPath).catch((e: unknown) => {
    console.warn(`[file-lock] failed to remove sidecar ${lockPath} on release:`, e);
  });
}

/**
 * Read the current holder of a lock, or null if not held (or stale). Uses
 * proper-lockfile's `.check()` — no side effects, never blocks a concurrent
 * acquirer, never steals or deletes.
 */
export async function inspectLock(target: LockTarget): Promise<LockHolder | null> {
  const ref = lockRef(target);
  const lockPath = ref.lockPath;
  const held = await lockfile.check(lockPath, checkOptions(ref));
  if (!held) return null;
  return (await readHolder(lockPath)) ?? unknownHolder();
}

/**
 * Reclaim a lock if it has no live holder. Returns true when reclaimed (it was
 * free or stale/crashed — sidecar and guard dir are cleaned up), false when a
 * live holder owns it (`ELOCKED`, untouched). This is the ONLY cleanup path,
 * and it is race-free: it deletes on-disk state exclusively while atomically
 * holding the lock via proper-lockfile, so it can never remove a live
 * holder's guard dir.
 */
async function reclaimIfDead(ref: LockRef): Promise<boolean> {
  const lockPath = ref.lockPath;
  let release: () => Promise<void>;
  try {
    release = await lockfile.lock(lockPath, lockOptions(ref));
  } catch (e) {
    if (isLockedError(e)) return false; // live holder
    throw e;
  }
  // We hold it now → there was no live holder. Drop the stale sidecar, then
  // release (proper-lockfile removes the guard dir).
  try {
    await unlinkIgnoringMissing(lockPath);
  } finally {
    await release().catch((e: unknown) => {
      console.warn(`[file-lock] failed to release reclaimed lock ${lockPath}:`, e);
    });
  }
  return true;
}

/**
 * Forcefully take a lock, evicting whatever is there (live or dead). This is
 * the single deliberate exception to "never delete a foreign holder's guard":
 * the caller has decided to override an active holder. No production callers
 * today — used for administrative override.
 */
export async function forceAcquireLock(
  target: LockTarget,
  metadata: Record<string, unknown>,
): Promise<LockHolder> {
  const lockPath = lockRef(target).lockPath;
  for (let attempt = 0; attempt < 2; attempt++) {
    // Evict the current holder's guard dir + sidecar outright, then acquire.
    await fs.rm(guardPath(lockPath), { recursive: true, force: true });
    await unlinkIgnoringMissing(lockPath);
    try {
      return await acquireLock(target, metadata);
    } catch (e) {
      if (isLockedError(e) || e instanceof LockHeldError) continue; // raced another acquirer; retry
      throw e;
    }
  }
  throw new LockForceAcquireFailedError(lockPath);
}

/**
 * Scan a directory for lock sidecar files matching `suffix`. Returns a map of
 * name (filename without suffix) → live holder. Dead/stale holders are
 * reclaimed (sidecar + guard dir removed) as a side effect, via the race-free
 * `reclaimIfDead` path.
 */
export async function scanLocks(
  dir: string,
  { suffix, profile }: { suffix: string; profile: LockProfile },
): Promise<Map<string, LockHolder>> {
  const result = new Map<string, LockHolder>();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if (errnoCode(err) === "ENOENT") return result;
    throw err;
  }
  for (const entry of entries) {
    if (!entry.endsWith(suffix)) continue;
    const fullPath = path.join(dir, entry);
    // A single proper-lockfile acquire attempt decides live-vs-dead atomically:
    // reclaimed (dead) → skip; ELOCKED (live) → report the holder.
    if (await reclaimIfDead({ lockPath: fullPath, profile })) continue;
    const name = entry.slice(0, -suffix.length);
    result.set(name, (await readHolder(fullPath)) ?? unknownHolder());
  }
  return result;
}
