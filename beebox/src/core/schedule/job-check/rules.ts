/**
 * The job check's rules, pure: which jobs are waiting, which are due, the
 * backoff, the lifetime, and the daily bound. `./core.ts` reads the disk and
 * applies them. See docs/plans/on-demand-job-triggers.md, Track B.
 */

const HOUR_MS = 60 * 60 * 1000;

/** At most this many runs started by the check per box per box-local day. */
export const JOB_CHECK_RUNS_PER_DAY = 24;

/** A job is retried for this long from when the check first saw it, then given up. */
export const JOB_LIFETIME_MS = 7 * 24 * HOUR_MS;

/** What the check records per job file path. */
export interface JobEntry {
  /** When the check first saw it waiting (ISO). Edits never move it. */
  firstSeenAt: string;
  /** The content hash at the last attempt, or at first sight. */
  hash: string;
  /** Runs started for it since `hash`. */
  attempts: number;
  /** When it is next due (ISO); null when due now. */
  nextAt: string | null;
  givenUp: boolean;
}

/** `.beebox/job-check.json`. */
export interface JobCheckState {
  /** The box-local day `runsToday` counts (`YYYY-MM-DD`). */
  day: string | null;
  runsToday: number;
  /** The day the daily bound was last logged, so it is logged once a day. */
  boundLoggedDay: string | null;
  jobs: Record<string, JobEntry>;
}

export const EMPTY_STATE: JobCheckState = { day: null, runsToday: 0, boundLoggedDay: null, jobs: {} };

/**
 * A waiting job: unscoped (a connector's job belongs to its scoped wakeup),
 * normal priority (a low one rides along with any run), and its working copy
 * is its committed content (anything else is a write in progress or a
 * rejected commit).
 */
export function isWaitingJob(job: { connector: string | undefined; priority: "normal" | "low"; clean: boolean }): boolean {
  return job.connector === undefined && job.priority === "normal" && job.clean;
}

/** When a job that has had `attempts` runs is next due: +1 h, +6 h, then daily. */
export function nextAttemptAt(attempts: number, now: Date): Date {
  const delayHours = attempts <= 1 ? 1 : attempts === 2 ? 6 : 24;
  return new Date(now.getTime() + delayHours * HOUR_MS);
}

/** Past its lifetime: 7 days from first sight, whatever its edits or attempts. */
export function givenUp(firstSeenAt: Date, now: Date): boolean {
  return now.getTime() - firstSeenAt.getTime() >= JOB_LIFETIME_MS;
}

/** One waiting job as the check found it. */
export interface WaitingJob {
  file: string;
  hash: string;
}

export interface DueDecision {
  /** The state's job entries after this look: new entries recorded, edits reset, lifetimes ended. */
  jobs: Record<string, JobEntry>;
  /** The files a run would be started for. */
  due: string[];
  /** Files given up by this look (logged once). */
  newlyGivenUp: string[];
}

function entryFor(job: WaitingJob, opts: { previous: JobEntry | undefined; now: Date }): JobEntry {
  const { previous, now } = opts;
  if (previous === undefined) return { firstSeenAt: now.toISOString(), hash: job.hash, attempts: 0, nextAt: null, givenUp: false };
  // An edit (an appended item, an agent's rewrite) is due at once, with a
  // fresh attempt count, inside the same lifetime.
  if (previous.hash !== job.hash) return { ...previous, hash: job.hash, attempts: 0, nextAt: null };
  return previous;
}

/**
 * Decide which waiting jobs are due. A job is due when it is not given up
 * and it is new, its content changed, or its `nextAt` has passed. Entries
 * for files that are no longer in `present` are dropped; entries for files
 * still present but not waiting this minute (an uncommitted edit) are kept.
 */
export function dueJobs(state: JobCheckState, opts: { waiting: WaitingJob[]; present: ReadonlySet<string>; now: Date }): DueDecision {
  const { waiting, present, now } = opts;
  const jobs = Object.fromEntries(Object.entries(state.jobs).filter(([file]) => present.has(file)));
  const due: string[] = [];
  const newlyGivenUp: string[] = [];
  for (const job of waiting) {
    const previous = jobs[job.file];
    if (previous?.givenUp === true) continue;
    const entry = entryFor(job, { previous, now });
    if (givenUp(new Date(entry.firstSeenAt), now)) {
      jobs[job.file] = { ...entry, givenUp: true };
      newlyGivenUp.push(job.file);
      continue;
    }
    jobs[job.file] = entry;
    if (entry.nextAt === null || now.getTime() >= Date.parse(entry.nextAt)) due.push(job.file);
  }
  return { jobs, due, newlyGivenUp };
}

/** Runs the check has started today, counting from zero on a new box-local day. */
export function runsOn(state: JobCheckState, today: string): number {
  return state.day === today ? state.runsToday : 0;
}

/** Whether the check may start another run today. */
export function underDailyBound(state: JobCheckState, today: string): boolean {
  return runsOn(state, today) < JOB_CHECK_RUNS_PER_DAY;
}

/**
 * The state after a run started for `due`: each due job's attempt counted and
 * its next time set by the backoff, and today's count raised by one.
 */
export function stampStarted(state: JobCheckState, opts: { due: string[]; today: string; now: Date }): JobCheckState {
  const { due, today, now } = opts;
  const jobs = { ...state.jobs };
  for (const file of due) {
    const entry = jobs[file];
    if (entry === undefined) continue;
    const attempts = entry.attempts + 1;
    jobs[file] = { ...entry, attempts, nextAt: nextAttemptAt(attempts, now).toISOString() };
  }
  return { ...state, day: today, runsToday: runsOn(state, today) + 1, jobs };
}
