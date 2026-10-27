// # The job check's rules
//
// Pure functions behind the scheduler pass's job check
// (`src/core/schedule/job-check/rules.ts`): which jobs are waiting, which are
// due, the backoff, the 7-day lifetime, and the daily bound. See
// docs/plans/on-demand-job-triggers.md, Track B.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  dueJobs,
  EMPTY_STATE,
  givenUp,
  isWaitingJob,
  JOB_CHECK_RUNS_PER_DAY,
  nextAttemptAt,
  stampStarted,
  underDailyBound,
  type JobCheckState,
} from "../../../../src/core/schedule/job-check/rules.js";

const HOUR = 60 * 60 * 1000;
const T0 = new Date("2026-10-27T12:00:00.000Z");
const at = (ms: number): Date => new Date(T0.getTime() + ms);

// ## Waiting
//
// Only an unscoped, normal-priority job whose working copy is its committed
// content starts a run. A connector's job belongs to its scoped wakeup; a low
// one rides along; an uncommitted card is a write in progress.
void test("Waiting: unscoped, normal, committed", async (t) => {
  t.check(
    [
      isWaitingJob({ connector: undefined, priority: "normal", clean: true }),
      isWaitingJob({ connector: "gmail", priority: "normal", clean: true }),
      isWaitingJob({ connector: undefined, priority: "low", clean: true }),
      isWaitingJob({ connector: undefined, priority: "normal", clean: false }),
    ],
    [true, false, false, false],
  );
});

// ## Backoff
//
// After the first attempt +1 h, after the second +6 h, then daily. The third
// attempt of a job first tried at t0 happens at t0+7h, so the fourth is due at
// t0+31h.
void test("Backoff: +1 h, +6 h, then daily", async (t) => {
  t.check(
    [nextAttemptAt(1, T0), nextAttemptAt(2, T0), nextAttemptAt(3, T0), nextAttemptAt(3, at(7 * HOUR)), nextAttemptAt(8, T0)],
    [at(HOUR), at(6 * HOUR), at(24 * HOUR), at(31 * HOUR), at(24 * HOUR)],
  );
});

// ## Due
//
// A job with no entry is due, and its first sight is recorded. One whose next
// time is in the future is not. One whose content changed is due at once, its
// attempts reset, its first sight kept. An entry for a file that is gone is
// dropped; one for a file still present but not waiting (an uncommitted edit)
// is kept.
void test("Due: new, waiting out its backoff, edited", async (t) => {
  const state: JobCheckState = {
    ...EMPTY_STATE,
    jobs: {
      "backing-off.job.card": { firstSeenAt: T0.toISOString(), hash: "a", attempts: 1, nextAt: at(2 * HOUR).toISOString(), givenUp: false },
      "edited.job.card": { firstSeenAt: T0.toISOString(), hash: "a", attempts: 2, nextAt: at(2 * HOUR).toISOString(), givenUp: false },
      "dirty.job.card": { firstSeenAt: T0.toISOString(), hash: "a", attempts: 1, nextAt: null, givenUp: false },
      "gone.job.card": { firstSeenAt: T0.toISOString(), hash: "a", attempts: 1, nextAt: null, givenUp: false },
    },
  };
  const now = at(HOUR);
  t.check(
    dueJobs(state, {
      waiting: [
        { file: "new.job.card", hash: "n" },
        { file: "backing-off.job.card", hash: "a" },
        { file: "edited.job.card", hash: "b" },
      ],
      present: new Set(["new.job.card", "backing-off.job.card", "edited.job.card", "dirty.job.card"]),
      now,
    }),
    {
      jobs: {
        "backing-off.job.card": { firstSeenAt: T0.toISOString(), hash: "a", attempts: 1, nextAt: at(2 * HOUR).toISOString(), givenUp: false },
        "edited.job.card": { firstSeenAt: T0.toISOString(), hash: "b", attempts: 0, nextAt: null, givenUp: false },
        "dirty.job.card": { firstSeenAt: T0.toISOString(), hash: "a", attempts: 1, nextAt: null, givenUp: false },
        "new.job.card": { firstSeenAt: now.toISOString(), hash: "n", attempts: 0, nextAt: null, givenUp: false },
      },
      due: ["new.job.card", "edited.job.card"],
      newlyGivenUp: [],
    },
  );
});

// ## Lifetime
//
// Seven days from first sight, whatever the hash or attempts. An entry edited
// at t0+6d23h is due at once; at t0+7d the same entry is given up, and a later
// edit does not revive it.
void test("Lifetime: seven days from first sight; edits do not extend it", async (t) => {
  const entry = { firstSeenAt: T0.toISOString(), hash: "a", attempts: 5, nextAt: at(200 * HOUR).toISOString(), givenUp: false };
  const state: JobCheckState = { ...EMPTY_STATE, jobs: { "x.job.card": entry } };
  const present = new Set(["x.job.card"]);
  const edited = dueJobs(state, { waiting: [{ file: "x.job.card", hash: "b" }], present, now: at(167 * HOUR) });
  const expired = dueJobs(state, { waiting: [{ file: "x.job.card", hash: "b" }], present, now: at(168 * HOUR) });
  const later = dueJobs({ ...state, jobs: expired.jobs }, { waiting: [{ file: "x.job.card", hash: "c" }], present, now: at(200 * HOUR) });
  t.check(
    {
      givenUp: [givenUp(T0, at(168 * HOUR - 1)), givenUp(T0, at(168 * HOUR))],
      edited: [edited.due, edited.newlyGivenUp],
      expired: [expired.due, expired.newlyGivenUp, expired.jobs["x.job.card"]?.givenUp],
      later: [later.due, later.newlyGivenUp],
    },
    {
      givenUp: [false, true],
      edited: [["x.job.card"], []],
      expired: [[], ["x.job.card"], true],
      later: [[], []],
    },
  );
});

// ## Daily bound and stamping
//
// A started run counts each due job's attempt, sets its next time by the
// backoff, and raises today's count. At 24 runs the check starts nothing more
// that day; a new box-local day starts the count again.
void test("Daily bound and stamping", async (t) => {
  const state: JobCheckState = {
    ...EMPTY_STATE,
    jobs: { "x.job.card": { firstSeenAt: T0.toISOString(), hash: "a", attempts: 0, nextAt: null, givenUp: false } },
  };
  t.check(stampStarted(state, { due: ["x.job.card"], today: "2026-10-27", now: T0 }), {
    day: "2026-10-27",
    runsToday: 1,
    boundLoggedDay: null,
    jobs: { "x.job.card": { firstSeenAt: T0.toISOString(), hash: "a", attempts: 1, nextAt: at(HOUR).toISOString(), givenUp: false } },
  });
  const full: JobCheckState = { ...EMPTY_STATE, day: "2026-10-27", runsToday: JOB_CHECK_RUNS_PER_DAY };
  t.check(
    [underDailyBound({ ...full, runsToday: 23 }, "2026-10-27"), underDailyBound(full, "2026-10-27"), underDailyBound(full, "2026-10-28")],
    [true, false, true],
  );
});
