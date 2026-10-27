/**
 * The scheduler pass's job check (`checkWaitingJobs`).
 *
 * Every scheduled wakeup is connector-scoped, so a job with no `connector:`
 * (a question follow-up, scan or capture intake, a job an agent wrote) runs
 * only in a full wakeup, which nothing used to start. Once per pass, after
 * the tick, this check looks for waiting jobs (unscoped, normal priority, the
 * card's working copy its committed content: a connector's job belongs to its
 * scoped wakeup, a low one rides along, an uncommitted card is a write in
 * progress) and starts one full wakeup when one is due (`./rules.ts`) and no
 * wakeup is running. A job that keeps
 * failing is retried at +1 h, +6 h, then daily, and given up 7 days after the
 * check first saw it; the card stays, and the `stalled-jobs` health check
 * names it. See docs/plans/on-demand-job-triggers.md, Track B.
 *
 * Each decision that starts, skips for the bound, fails to start, or gives up
 * is a `job-check` line in the box's `scheduler.jsonl`. An idle box (no
 * unscoped normal job) costs one directory read and no log line.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { findJobCards } from "../../reactor/job-discovery.js";
import { getBoxDir } from "../../../lib/paths/core.js";
import { changedFiles } from "../../../lib/git/core/operations.js";
import { isRepo } from "../../../lib/git/repo.js";
import { inspectLock, LockHeldError, withFileLock } from "../../../lib/file-lock.js";
import { withCardLock } from "../../../lib/card-lock.js";
import { wakeupCycleLockPath } from "../../../cli/commands/wakeup/cycle-lock.js";
import { getBoxTime } from "../../../lib/time.js";
import { boxLocalDay } from "../../box/local-day.js";
import { errorMessage } from "../../../shared/error-guards.js";
import { writeBoxLog } from "../box-log.js";
import { dueJobs, stampStarted, underDailyBound, type JobCheckState, type WaitingJob } from "./rules.js";
import { jobCheckLockPath, jobCheckStatePath, readJobCheckState, writeJobCheckState } from "./state.js";
import { jobCheckStarter, type JobCheckStart } from "./start.js";

// The box server's `wakeup.start` starts the same run; it reaches the starter through here.
export { startJobCheckWakeup, type JobCheckStart } from "./start.js";

type StateWriter = (boxRoot: string, state: JobCheckState) => Promise<void>;

/** Starts one full wakeup and answers once its child holds the cycle lock (`./start.ts`). */
export type JobCheckStarter = (boxRoot: string) => Promise<JobCheckStart>;

export type JobCheckResult =
  | { kind: "idle" }
  | { kind: "wakeup-running" }
  | { kind: "check-running" }
  | { kind: "none-due" }
  | { kind: "state-unreadable" }
  | { kind: "daily-bound" }
  | { kind: "not-started"; state: JobCheckStart["state"]; detail: string }
  | { kind: "started"; files: string[] };

interface Candidate {
  file: string;
  /** Relative to the box root, as `git status` names it. */
  relPath: string;
  absPath: string;
}

async function log(boxRoot: string, fields: Record<string, unknown>): Promise<void> {
  await writeBoxLog(boxRoot, { ts: new Date().toISOString(), event: "job-check", box: boxRoot, ...fields });
}

/** A wakeup (full or scoped), `bbx reactor`, or scan's or filing's own wakeup holds one of these. */
async function wakeupRunning(boxRoot: string): Promise<boolean> {
  return (await inspectLock(wakeupCycleLockPath(boxRoot))) !== null || (await inspectLock(path.join(boxRoot, ".bbx-reactor.lock"))) !== null;
}

/** One transition at a time per box: the in-process card lock and the cross-process file lock, never waiting. */
async function underCheckLock<T>(boxRoot: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = jobCheckLockPath(boxRoot);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  return withCardLock(lockPath, () => withFileLock({ lockPath, metadata: { purpose: "job-check" }, waitMs: 0 }, fn));
}

async function hashFile(absPath: string): Promise<string> {
  return createHash("sha256").update(await fs.readFile(absPath)).digest("hex");
}

/** The candidates whose working copy is their committed content, with their hashes. */
async function waitingJobs(boxRoot: string, candidates: Candidate[]): Promise<WaitingJob[]> {
  if (!(await isRepo(boxRoot))) return [];
  const dirty = new Set(await changedFiles(boxRoot, candidates.map((c) => c.relPath)));
  const waiting: WaitingJob[] = [];
  for (const c of candidates) {
    if (dirty.has(c.relPath)) continue;
    waiting.push({ file: c.file, hash: await hashFile(c.absPath) });
  }
  return waiting;
}

/** Drop entries for job files that are gone. Skipped when another check holds the lock. */
async function pruneGone(boxRoot: string, present: ReadonlySet<string>): Promise<void> {
  const { state, problem } = await readJobCheckState(boxRoot);
  // An unreadable file is reported when a job is waiting; pruning leaves it alone.
  if (problem !== null || Object.keys(state.jobs).every((file) => present.has(file))) return;
  try {
    await underCheckLock(boxRoot, async () => {
      const current = await readJobCheckState(boxRoot);
      if (current.problem !== null) return;
      const jobs = Object.fromEntries(Object.entries(current.state.jobs).filter(([file]) => present.has(file)));
      await writeJobCheckState(boxRoot, { ...current.state, jobs });
    });
  } catch (e) {
    if (!(e instanceof LockHeldError)) throw e;
  }
}

async function decideAndStart(
  boxRoot: string,
  opts: { candidates: Candidate[]; present: ReadonlySet<string>; start: JobCheckStarter; writeState: StateWriter },
): Promise<JobCheckResult> {
  const { candidates, present, start, writeState } = opts;
  const read = await readJobCheckState(boxRoot);
  if (read.problem !== null) {
    // Fail closed: an unreadable file may hide today's count, so nothing starts
    // until a person repairs or deletes it.
    await log(boxRoot, { action: "state unreadable", file: jobCheckStatePath(boxRoot), error: read.problem });
    return { kind: "state-unreadable" };
  }
  const now = getBoxTime(boxRoot);
  const decision = dueJobs(read.state, { waiting: await waitingJobs(boxRoot, candidates), present, now });
  for (const file of decision.newlyGivenUp) await log(boxRoot, { action: "gave up", file });
  const seen: JobCheckState = { ...read.state, jobs: decision.jobs };

  if (decision.due.length === 0) {
    if (JSON.stringify(seen) !== JSON.stringify(read.state)) await writeState(boxRoot, seen);
    return { kind: "none-due" };
  }
  const today = await boxLocalDay(boxRoot, now);
  if (!underDailyBound(seen, today)) {
    if (seen.boundLoggedDay === today) return { kind: "daily-bound" };
    await log(boxRoot, { action: "daily bound", runsToday: seen.runsToday, files: decision.due });
    await writeState(boxRoot, { ...seen, boundLoggedDay: today });
    return { kind: "daily-bound" };
  }

  // Charge before launch: the attempt and today's count are on disk before a
  // child can run, so a failed write never lets runs repeat uncounted. A run
  // that skipped or never began is refunded.
  const charged = stampStarted(seen, { due: decision.due, today, now });
  await writeState(boxRoot, charged);
  let answer: JobCheckStart;
  try {
    answer = await start(boxRoot);
  } catch (e) {
    answer = { state: "failed", detail: errorMessage(e) };
  }
  if (answer.state !== "started") {
    await writeState(boxRoot, seen);
    await log(boxRoot, { action: "not started", state: answer.state, detail: answer.detail, files: decision.due });
    return { kind: "not-started", state: answer.state, detail: answer.detail };
  }
  await log(boxRoot, { action: "started", files: decision.due, runsToday: charged.runsToday });
  return { kind: "started", files: decision.due };
}

/**
 * Look for waiting jobs and start one full wakeup when one is due. Never
 * waits for the run: `start` answers once the run's child holds the cycle
 * lock, and later passes see what the run left. `start` defaults to the
 * host's starter (`jobCheckStarter`); a test injects one, and may inject
 * `writeState` to make the state write fail.
 */
export async function checkWaitingJobs(
  boxRoot: string,
  opts?: { start?: JobCheckStarter; writeState?: StateWriter },
): Promise<JobCheckResult> {
  const start = opts?.start ?? jobCheckStarter();
  const writeState = opts?.writeState ?? writeJobCheckState;
  const jobsDir = getBoxDir(boxRoot, "jobs");
  const jobs = await findJobCards(jobsDir);
  const present = new Set(jobs.map((job) => job.file));
  const candidates: Candidate[] = jobs
    .filter((job) => job.connector === undefined && job.priority === "normal")
    .map((job) => {
      const absPath = path.join(jobsDir, job.file);
      return { file: job.file, absPath, relPath: path.relative(boxRoot, absPath) };
    });
  if (candidates.length === 0) {
    await pruneGone(boxRoot, present);
    return { kind: "idle" };
  }
  if (await wakeupRunning(boxRoot)) return { kind: "wakeup-running" };
  try {
    return await underCheckLock(boxRoot, () => decideAndStart(boxRoot, { candidates, present, start, writeState }));
  } catch (e) {
    if (!(e instanceof LockHeldError)) throw e;
    await log(boxRoot, { action: "skipped", detail: "Another job check holds the lock." });
    return { kind: "check-running" };
  }
}
