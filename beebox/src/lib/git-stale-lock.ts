/**
 * Recovery for an ABANDONED `.git/index.lock`.
 *
 * ## The condition
 *
 * `git` takes the index by creating `.git/index.lock` with `O_CREAT|O_EXCL`,
 * writing the new index into it, and `rename()`ing it over `.git/index`. It
 * removes the lock on normal exit, on error, and on SIGTERM/SIGINT (its
 * `lockfile.c` signal handlers). What it cannot do is clean up after SIGKILL —
 * and then the file survives with no owner, forever. Every subsequent writer
 * gets `fatal: Unable to create '<repo>/.git/index.lock': File exists`, which
 * is byte-for-byte what LIVE contention looks like, so `git-lock.ts` and
 * `isContendedFailure` read it as "someone else is committing right now" and
 * keep reporting that indefinitely. A box wedges and nothing says why.
 *
 * SIGKILL is not hypothetical or rare here: the hub tears box children down
 * with a SIGKILL escalation, and the OOM killer has reached into the same
 * cgroup on the production server. Recovery is therefore not a bandage over a
 * preventable bug — some of the routes to a killed `git` are not ours to
 * close.
 *
 * ## The staleness test, and why each part is there
 *
 * Removing a lock that is genuinely held makes the holding `git` fail its
 * final `rename()` with ENOENT. That is a FAILED operation rather than a
 * corrupted repository — git never writes `.git/index` in place — but with two
 * racing writers it can still cost one index update, so the test is built to
 * have no plausible false positive:
 *
 * 1. **Age.** The lock's mtime must be older than {@link INDEX_LOCK_STALE_MS}.
 *    This is the load-bearing signal. Our own writers hold the index for well
 *    under a second, the box git lock's whole wait budget is 60s, and even the
 *    11GB `estate` repo commits in seconds.
 * 2. **No process has it open, and no git is working in this repository.** The
 *    descriptor check is a veto, not proof: git closes the lock's fd in some
 *    flows (`close_lock_file_gently`) and holds the lock as a NAME until the
 *    rename, so "unopened" alone would be unsound. That window is normally
 *    microseconds but lasts as long as the editor in an interactive
 *    `git commit`, which is why a git-family process whose cwd is inside the
 *    working tree vetoes removal too. Identity is settled by device+inode
 *    rather than path text, so a symlinked or bind-mounted `.git` cannot hide
 *    a real holder.
 * 3. **Fail closed on an unusable probe.** If we cannot enumerate processes,
 *    cannot read a process's descriptors, or cannot place a possible git, the
 *    verdict is `unknown-holder` and we do not remove. A probe that could not
 *    answer must never read as "nobody holds it".
 * 4. **Settle, then re-verify.** After the probe we wait
 *    {@link SETTLE_MS} and re-stat: same inode, same mtime, still unopened. A
 *    lock being actively written moves its mtime; one being replaced changes
 *    its inode.
 * 5. **Remove under the box git lock, inode-checked.** The unlink runs inside
 *    `withBoxGitLock` so none of OUR writers can be inside a git span, and
 *    re-stats immediately beforehand — if the inode or mtime moved since the
 *    verdict, we abort rather than delete a lock that just became live.
 *
 * ## Scope
 *
 * One machine, one repository. A network filesystem shared between hosts would
 * defeat the holder probe; boxes are local, and `file-lock.ts` scopes itself
 * the same way.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveGitDir, withBoxGitLock } from "./git-lock.js";
import { isRecord } from "./is-record.js";

const execFileAsync = promisify(execFile);

/**
 * How old an unheld `.git/index.lock` must be before we call it abandoned.
 *
 * Deliberately far above anything legitimate: our writers hold the index for
 * milliseconds, `withBoxGitLock`'s entire wait budget is 60s, and the largest
 * production box (an 11GB repository) commits in seconds. Fifteen minutes
 * leaves two orders of magnitude of headroom, and the cost of waiting longer
 * than necessary is only that the box stays wedged a little longer — the cost
 * of being too eager is someone else's failed commit.
 */
export const INDEX_LOCK_STALE_MS = 15 * 60 * 1000;

/** Pause between the first verdict and the confirming re-stat. */
const SETTLE_MS = 2000;

/**
 * Process names that can legitimately hold a repository's index lock, as
 * `/proc/<pid>/comm` reports them — truncated to 15 characters, which is why
 * `git-remote-https` appears in its cut form.
 */
const GIT_PROCESS_NAMES = new Set(["git", "git-lfs", "git-annex", "git-remote-http"]);

/** How long the macOS `lsof` probe may take before we call the answer unknown. */
const LSOF_TIMEOUT_MS = 5000;

/**
 * What we know about a repository's `.git/index.lock` right now.
 *
 * - `absent` — no lock file; nothing to do.
 * - `fresh` — a lock younger than {@link INDEX_LOCK_STALE_MS}. Ordinary
 *   contention; wait it out.
 * - `held` — a `git` process has the file open. Live, whatever its age.
 * - `unknown-holder` — old enough, but we could not determine whether anything
 *   holds it. Reportable, never removable.
 * - `stale` — old, unheld, and stable across the settle window. Abandoned.
 */
export type IndexLockState = "absent" | "fresh" | "held" | "unknown-holder" | "stale";

export interface IndexLockStatus {
  state: IndexLockState;
  /** Absolute path to the lock file, or null when `dir` is not in a repository. */
  lockPath: string | null;
  /** Age of the lock in milliseconds, or null when there is no lock. */
  ageMs: number | null;
}

const NOT_A_REPO: IndexLockStatus = { state: "absent", lockPath: null, ageMs: null };

/** The `.git/index.lock` path for the repository containing `dir`, or null. */
async function indexLockPath(dir: string): Promise<string | null> {
  const gitDir = await resolveGitDir(dir);
  return gitDir === null ? null : path.join(gitDir, "index.lock");
}

interface LockStat {
  dev: bigint;
  ino: bigint;
  mtimeMs: number;
}

/** `stat` the lock, or null if it is gone (or was never there). */
async function statLock(lockPath: string): Promise<LockStat | null> {
  try {
    const st = await fs.stat(lockPath, { bigint: true });
    return { dev: st.dev, ino: st.ino, mtimeMs: Number(st.mtimeMs) };
  } catch (_e) {
    return null;
  }
}

/**
 * Whether any process has `lockPath` open.
 *
 * `null` means UNDETERMINED — the caller must treat that as "possibly held".
 */
async function processHoldsFile(lockPath: string, lock: LockStat): Promise<boolean | null> {
  return process.platform === "linux" ? procHoldsFile(lockPath, lock) : lsofHoldsFile(lockPath);
}

/**
 * Linux: look for `lockPath` among open descriptors in `/proc`.
 *
 * Two tiers, because an unprivileged process can read its OWN descriptors but
 * not another user's. Every process whose `/proc/<pid>/fd` we can read is
 * inspected outright, whatever it is called — that covers the holders that
 * actually matter here, since the git we care about is one we spawned. A
 * process we may NOT inspect is judged by its name: git-family means the
 * answer is unknown and nothing may be removed; anything else is disregarded,
 * because nothing but git opens a repository's index lock and treating every
 * unreadable stranger as a possible holder would make the verdict permanently
 * unknown on a shared machine.
 */
async function procHoldsFile(lockPath: string, lock: LockStat): Promise<boolean | null> {
  let pids: string[];
  try {
    pids = (await fs.readdir("/proc")).filter((entry) => /^\d+$/.test(entry));
  } catch (_e) {
    return null;
  }

  const lockName = path.basename(lockPath);
  // The working tree the lock belongs to. `.git/index.lock` sits one level
  // inside the git directory's parent for an ordinary repository; if the layout
  // is something else this prefix simply never matches, which weakens the veto
  // below rather than misapplying it.
  const repoRoot = path.dirname(path.dirname(lockPath));

  let inconclusive = false;
  for (const pid of pids) {
    // A git working IN THIS REPOSITORY vetoes removal even when it has no
    // descriptor on the lock. git closes the lock's fd in some flows and holds
    // the lock as a NAME until it renames it into place — briefly in most
    // paths, but for as long as an editor stays open in an interactive
    // `git commit`. That window is the one case age and descriptors both miss,
    // and a git whose cwd is in this tree is the cheap signal for it.
    if (await isGitInRepo(pid, repoRoot)) {
      inconclusive = true;
      continue;
    }
    let fds: string[];
    try {
      fds = await fs.readdir(`/proc/${pid}/fd`);
    } catch (e) {
      // ENOENT is an exit between the readdir and now — it holds nothing.
      // Anything else is permission: we cannot see this process's descriptors,
      // so fall back to its name.
      if (isErrnoCode(e, "ENOENT")) continue;
      if (await mayBeGitProcess(pid)) inconclusive = true;
      continue;
    }
    for (const fd of fds) {
      const fdPath = `/proc/${pid}/fd/${fd}`;
      let target: string;
      try {
        target = await fs.readlink(fdPath);
      } catch (_e) {
        continue; // fd closed underneath us
      }
      // The readlink text is a cheap PREFILTER, not the test. The same file can
      // appear under different path strings (a symlinked or bind-mounted `.git`,
      // a different mount namespace), so matching text would miss a real holder;
      // the basename survives all of those, and identity is then settled by
      // device+inode. `stat` through `/proc/<pid>/fd/<n>` follows the descriptor,
      // so it answers even for a path that has since been replaced.
      if (path.basename(target) !== lockName) continue;
      try {
        const st = await fs.stat(fdPath, { bigint: true });
        if (st.dev === lock.dev && st.ino === lock.ino) return true;
      } catch (_e) {
        continue; // fd or target gone
      }
    }
  }
  return inconclusive ? null : false;
}

/** Whether `pid` is a git-family process whose cwd is inside `repoRoot`. */
async function isGitInRepo(pid: string, repoRoot: string): Promise<boolean> {
  if (!(await mayBeGitProcess(pid))) return false;
  let cwd: string;
  try {
    cwd = await fs.readlink(`/proc/${pid}/cwd`);
  } catch (_e) {
    // Exited, or its cwd is unreadable. `mayBeGitProcess` already said this
    // could be a git; not being able to place it is a reason to be careful.
    return true;
  }
  return cwd === repoRoot || cwd.startsWith(`${repoRoot}${path.sep}`);
}

/**
 * Whether `pid` might be a git-family process — used both to place a git in
 * this repository and as the fallback for a process whose descriptors we could
 * not read.
 *
 * Fails CLOSED: `comm` is world-readable, so the only reasons a read fails are
 * that the process exited (ENOENT — it holds nothing) or something unforeseen.
 * The unforeseen case answers "maybe", because the caller turns a maybe into
 * `unknown-holder` and removes nothing.
 */
async function mayBeGitProcess(pid: string): Promise<boolean> {
  try {
    return GIT_PROCESS_NAMES.has((await fs.readFile(`/proc/${pid}/comm`, "utf-8")).trim());
  } catch (e) {
    return !isErrnoCode(e, "ENOENT");
  }
}

/** Everything else (macOS dev machines): ask `lsof` about the one file. */
async function lsofHoldsFile(lockPath: string): Promise<boolean | null> {
  try {
    const { stdout } = await execFileAsync("lsof", ["-t", "-w", "--", lockPath], {
      timeout: LSOF_TIMEOUT_MS,
    });
    return stdout.trim() !== "";
  } catch (e) {
    // `lsof -t` exits 1 with empty output when nothing has the file open —
    // that is the answer "unheld", not a failure. Any other exit (lsof
    // missing, timed out, refused) leaves us genuinely unable to tell.
    if (isExecFailureWithEmptyStdout(e)) return false;
    return null;
  }
}

function isErrnoCode(e: unknown, code: string): boolean {
  return isRecord(e) && e["code"] === code;
}

function isExecFailureWithEmptyStdout(e: unknown): boolean {
  if (!isRecord(e)) return false;
  if (e["killed"] === true) return false;
  const stdout = e["stdout"];
  return e["code"] === 1 && typeof stdout === "string" && stdout.trim() === "";
}

/**
 * Classify the repository's index lock without touching anything.
 *
 * Cheap enough for a health check: one `stat`, and a process scan only when
 * the lock is old enough to matter.
 */
export async function inspectIndexLock(dir: string): Promise<IndexLockStatus> {
  const lockPath = await indexLockPath(dir);
  if (lockPath === null) return NOT_A_REPO;

  const stat = await statLock(lockPath);
  if (stat === null) return { state: "absent", lockPath, ageMs: null };

  const ageMs = Date.now() - stat.mtimeMs;
  if (ageMs < INDEX_LOCK_STALE_MS) return { state: "fresh", lockPath, ageMs };

  const held = await processHoldsFile(lockPath, stat);
  if (held === null) return { state: "unknown-holder", lockPath, ageMs };
  if (held) return { state: "held", lockPath, ageMs };
  return { state: "stale", lockPath, ageMs };
}

/**
 * Remove the repository's index lock if — and only if — it is abandoned.
 *
 * Returns the state that decided the outcome: `stale` when the lock was
 * removed, anything else when it was left alone. Never throws; a failure to
 * remove is reported as the state we last observed, because a caller reaching
 * this is already handling a git failure and must not be handed a second one.
 *
 * The full test (age, holder probe, settle, inode-checked unlink under the box
 * git lock) is described in this module's header.
 */
export async function recoverStaleIndexLock(dir: string): Promise<IndexLockStatus> {
  const first = await inspectIndexLock(dir);
  if (first.state !== "stale" || first.lockPath === null) return first;
  const lockPath = first.lockPath;

  const before = await statLock(lockPath);
  if (before === null) return { state: "absent", lockPath, ageMs: null };

  await delay(SETTLE_MS);

  const second = await inspectIndexLock(dir);
  if (second.state !== "stale") return second;
  const after = await statLock(lockPath);
  if (after === null) return { state: "absent", lockPath, ageMs: null };
  if (after.ino !== before.ino || after.mtimeMs !== before.mtimeMs) {
    // It moved during the settle window: something is alive in there.
    return { state: "held", lockPath, ageMs: Date.now() - after.mtimeMs };
  }

  // Inside the box git lock, so none of our own writers is in a git span while
  // we unlink. Reentrant, so a caller already holding it passes straight
  // through — which is the normal case, since the retry path runs under it.
  return withBoxGitLock(dir, async () => {
    const final = await statLock(lockPath);
    if (final === null) return { state: "absent", lockPath, ageMs: null };
    if (final.ino !== after.ino || final.mtimeMs !== after.mtimeMs) {
      return { state: "held", lockPath, ageMs: Date.now() - final.mtimeMs };
    }
    try {
      await fs.unlink(lockPath);
    } catch (e) {
      if (isErrnoCode(e, "ENOENT")) return { state: "absent", lockPath, ageMs: null };
      console.error(`[git-stale-lock] could not remove abandoned ${lockPath}: ${describe(e)}`);
      return { state: "unknown-holder", lockPath, ageMs: second.ageMs };
    }
    console.error(
      `[git-stale-lock] removed an abandoned ${lockPath} ` +
        `(${formatAge(second.ageMs)} old, no git process held it). A git process was killed ` +
        "mid-write here — check for an OOM kill, a mid-commit shutdown, or a full disk.",
    );
    return second;
  });
}

/**
 * Best-effort startup reclaim for one box: recover an abandoned lock, and say
 * something when one is present that we would not remove.
 *
 * Separate from {@link recoverStaleIndexLock} because a sweep is speculative —
 * it runs when nothing has failed yet, so silence is the right output for the
 * overwhelmingly common "no lock at all" case, while a lock we cannot clear is
 * worth a line even though nobody asked.
 */
export async function sweepStaleIndexLock(dir: string): Promise<void> {
  let status: IndexLockStatus;
  try {
    status = await recoverStaleIndexLock(dir);
  } catch (e) {
    console.warn(`[git-stale-lock] sweep of ${dir} failed (continuing): ${describe(e)}`);
    return;
  }
  if (status.state === "unknown-holder" && status.lockPath !== null) {
    console.warn(
      `[git-stale-lock] ${status.lockPath} is ${formatAge(status.ageMs)} old and could not be ` +
        "checked for a holder, so it was left in place. Nothing in this box can commit while it stands.",
    );
  }
}

/** Human-readable age for log and health-check text. */
export function formatAge(ageMs: number | null): string {
  if (ageMs === null) return "unknown age";
  const minutes = Math.round(ageMs / 60_000);
  if (minutes < 90) return `${String(minutes)}m`;
  const hours = Math.round(ageMs / 3_600_000);
  if (hours < 48) return `${String(hours)}h`;
  return `${String(Math.round(ageMs / 86_400_000))}d`;
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
