/**
 * The `todo-review` sweep (`docs/plans/todo-annotation.md` Track 5b): a
 * deterministic wakeup-housekeeping hook, following the `question-aging.ts`
 * precedent — resurfacing needs a call site, not just guidance.
 *
 * Runs the collector and computes three sets of *open* todos:
 * - **escalated** — past `due`.
 * - **stirring** — crossed `start` since the last sweep (a durable
 *   box-local-date baseline, persisted the same way the questions sweep
 *   persists its latch — see `question-alert.ts`'s `.callback-box/…json`
 *   precedent). Only this set needs a baseline: escalated and stale are
 *   recomputed fresh every pass, so re-running the sweep with nothing new
 *   correctly reports nothing new for THIS set without extra bookkeeping.
 * - **stale** — open, has `created`, is more than 45 days old, and has
 *   neither `start` nor `due` (so it never even entered the escalated/
 *   stirring math).
 *
 * When all three are empty, the sweep does nothing and injects nothing —
 * no job card, no console output. When any is nonempty, it queues a
 * `todo-review-job` card (mirroring the contains-backfill job's "wakeup
 * housekeeping step queues a job the reactor picks up" pattern — the
 * shipped precedent for getting a compact brief into the reactor's next
 * cycle without inventing a new channel) UNLESS a `todo-review` job is
 * already pending, so a slow-to-process brief doesn't get restated every
 * wakeup. The sweep only computes; the job's own instructions are what
 * tell the agent to judge and raise with the boxholder, never to silently
 * resolve anything (Track 5's "the sweep computes, the agent judges, the
 * human decides").
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { getBoxDir } from "../../lib/paths.js";
import { getBoxTime } from "../../lib/time.js";
import { loadBoxTimezone } from "../box/config.js";
import { errnoCode, errorMessage } from "../../lib/error-guards.js";
import { stageAndCommitPaths } from "../../lib/git.js";
import { acquireLock, releaseLock, LockHeldError } from "../../lib/file-lock.js";
import { sleep } from "../../lib/sleep.js";
import { findJobCards } from "../reactor/job-discovery.js";
import { collectTodos } from "./collect.js";
import { formatTodoLocation, type CollectedTodo } from "./collect-types.js";
import { resolveStartEpoch, parseIsoDate, boxLocalDateEpoch } from "../../shared/todo-model.js";
import { createTodoReviewJobTemplate, type TodoReviewJobItem } from "../../schemas/todo-review-job.js";

const SWEEP_STATE_PATH = ".callback-box/todo-review-sweep.json";
const SWEEP_LOCK_PATH = ".callback-box/todo-review-sweep.lock";
// Bounded retry against a concurrent sweep (another `cb wakeup`/`cb tick`
// run) — generous enough to outlast a normal sweep's own runtime (a
// collector pass + one job-card write), short enough that a genuinely stuck
// holder fails loud rather than wedging the caller indefinitely.
const LOCK_RETRIES = 20;
const LOCK_RETRY_MS = 250;
const STALE_DAYS = 45;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const JOB_SOURCE = "todo-review";

/** Thrown when the sweep's cross-process lock stays held by another process for the whole retry budget. */
class TodoReviewSweepLockError extends Error {
  constructor(lockPath: string) {
    super(`Could not acquire the todo-review sweep lock at ${lockPath} — another process held it too long`);
    this.name = "TodoReviewSweepLockError";
  }
}

const sweepStateSchema = z.object({
  // A box-local calendar-date epoch (see `boxLocalDateEpoch`), stored as a
  // number, NOT a wall-clock ISO instant — `start`/`due` are calendar dates,
  // and comparing a calendar epoch against a wall-clock timestamp would
  // undercount a `start` dated earlier the same day a sweep happens to run
  // mid-afternoon.
  lastSweepDateEpoch: z.number().optional(),
});

interface SweepState {
  lastSweepDateEpoch: number | null;
}

async function loadSweepState(boxRoot: string): Promise<SweepState> {
  try {
    const raw = await fs.readFile(path.join(boxRoot, SWEEP_STATE_PATH), "utf-8");
    const data = sweepStateSchema.parse(JSON.parse(raw));
    return { lastSweepDateEpoch: data.lastSweepDateEpoch ?? null };
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn("Could not read todo-review sweep state, treating as first run:", e);
    }
    return { lastSweepDateEpoch: null };
  }
}

async function saveSweepState(boxRoot: string, state: SweepState): Promise<void> {
  const absPath = path.join(boxRoot, SWEEP_STATE_PATH);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, `${JSON.stringify(state, null, 2)}\n`);
}

export interface TodoReviewSweepResult {
  escalated: CollectedTodo[];
  stirring: CollectedTodo[];
  stale: CollectedTodo[];
  /** Relative path of the job card created this pass, or null (empty sets, or a prior job is still pending). */
  jobPath: string | null;
}

/**
 * created-date age in whole days, from the todo's `created` attribute to the
 * box-local "today" — both sides are box-local calendar-date epochs
 * (`boxLocalDateEpoch`/`parseIsoDate`, UTC-midnight-of-that-date), never a
 * raw wall-clock instant. Comparing `created`'s calendar date against a
 * `now.getTime()` instant would, in a timezone far enough from UTC, count a
 * todo stale a day early or late relative to the box's own calendar (the
 * same class of bug the plan's plate-state truth table already avoids for
 * `start`/`due`). Unparseable `created` is treated as not-stale — `by="agent"`
 * requires it, but a human-authored todo (or hand-edited drift) may lack a
 * valid one, and the collector doesn't re-validate attribute shape.
 */
function ageInDays(created: string, todayEpoch: number): number | null {
  const epoch = parseIsoDate(created);
  if (epoch === null) return null;
  return Math.floor((todayEpoch - epoch) / MS_PER_DAY);
}

/** Split a box's open todos into escalated / stirring / stale, per the module doc's definitions. */
function computeSets(
  todos: CollectedTodo[],
  { todayEpoch, lastSweepEpoch }: { todayEpoch: number; lastSweepEpoch: number },
): Pick<TodoReviewSweepResult, "escalated" | "stirring" | "stale"> {
  const open = todos.filter((t) => t.status === "open");

  const escalated = open.filter((t) => t.plateState === "escalated");

  const stirring = open.filter((t) => {
    if (t.plateState !== "on-plate" || t.start === undefined) return false;
    const startEpoch = resolveStartEpoch(t.start, t.due);
    return startEpoch !== null && startEpoch > lastSweepEpoch;
  });

  const stale = open.filter((t) => {
    if (t.start !== undefined || t.due !== undefined || t.created === undefined) return false;
    const age = ageInDays(t.created, todayEpoch);
    return age !== null && age > STALE_DAYS;
  });

  return { escalated, stirring, stale };
}

/** One item's `detail` line — whichever date drove it into its set, human-readable. */
function detailFor(todo: CollectedTodo, kind: "escalated" | "stirring" | "stale"): string {
  switch (kind) {
    case "escalated":
      return `due ${todo.due ?? "?"}`;
    case "stirring":
      return `started ${todo.start ?? "?"}`;
    case "stale":
      return `created ${todo.created ?? "?"}`;
  }
}

function toJobItem(todo: CollectedTodo, kind: "escalated" | "stirring" | "stale"): TodoReviewJobItem {
  const item: TodoReviewJobItem = {
    locator: formatTodoLocation(todo),
    text: todo.text,
    detail: detailFor(todo, kind),
  };
  if (todo.assigned !== undefined) item.assigned = todo.assigned;
  return item;
}

/**
 * Run the todo-review sweep once, guarded by the standard cross-process lock
 * (`file-lock.ts`) so two concurrent wakeups (or a wakeup racing a manual
 * `cb tick`) can't both load the same `lastSweepDateEpoch` baseline, each
 * compute a job, and step on each other's write. Bounded retry against a
 * live holder, same shape as `withQuestionTransition`'s lock loop
 * (`core/commands/question-transition.ts`) — a genuinely stuck holder fails
 * loud rather than blocking the caller forever.
 */
export async function runTodoReviewSweep(boxRoot: string): Promise<TodoReviewSweepResult> {
  const lockPath = path.join(boxRoot, SWEEP_LOCK_PATH);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
    try {
      await acquireLock(lockPath, { purpose: "todo-review-sweep" });
    } catch (e) {
      if (e instanceof LockHeldError) {
        await sleep(LOCK_RETRY_MS);
        continue;
      }
      throw e;
    }
    try {
      return await runTodoReviewSweepLocked(boxRoot);
    } finally {
      await releaseLock(lockPath);
    }
  }
  throw new TodoReviewSweepLockError(lockPath);
}

/**
 * The sweep's actual work, run while holding the lock above.
 *
 * `lastSweepDateEpoch` only advances past today when this pass's findings
 * actually reached the reactor: either the sets were genuinely empty (nothing
 * to report — always safe to move forward), or a job got queued this pass. If
 * a `todo-review` job was ALREADY pending (or queuing throws), the baseline is
 * left where it was — advancing it anyway would fold this pass's newly
 * stirring/stale items into the baseline and make them permanently
 * unreportable once the pending job finally clears (the durability bug this
 * fixes). Leaving the baseline alone means the next sweep recomputes the same
 * sets and tries again.
 */
async function runTodoReviewSweepLocked(boxRoot: string): Promise<TodoReviewSweepResult> {
  const now = getBoxTime(boxRoot);
  const timeZone = (await loadBoxTimezone(boxRoot)) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const todayEpoch = boxLocalDateEpoch(now, timeZone);

  const state = await loadSweepState(boxRoot);
  const lastSweepEpoch = state.lastSweepDateEpoch ?? 0; // first run: everything already on-plate counts as "crossed since the box existed"

  const { todos } = await collectTodos(boxRoot);
  const sets = computeSets(todos, { todayEpoch, lastSweepEpoch });

  const isEmpty = sets.escalated.length === 0 && sets.stirring.length === 0 && sets.stale.length === 0;
  if (isEmpty) {
    await saveSweepState(boxRoot, { lastSweepDateEpoch: todayEpoch });
    return { ...sets, jobPath: null };
  }

  const jobPath = await queueReviewJob(boxRoot, sets);
  if (jobPath !== null) {
    await saveSweepState(boxRoot, { lastSweepDateEpoch: todayEpoch });
  }
  return { ...sets, jobPath };
}

async function queueReviewJob(
  boxRoot: string,
  sets: Pick<TodoReviewSweepResult, "escalated" | "stirring" | "stale">,
): Promise<string | null> {
  const jobsDir = getBoxDir(boxRoot, "jobs");
  const pending = await findJobCards(jobsDir, { sourceFilter: JOB_SOURCE });
  if (pending.length > 0) return null; // a brief is already waiting to be judged; don't restate it

  const created = getBoxTime(boxRoot).toISOString();
  const stamp = created.slice(0, 16).replaceAll(":", "-");
  const jobFilename = `${stamp}.todo-review.job.card`;
  const card = createTodoReviewJobTemplate({
    escalated: sets.escalated.map((t) => toJobItem(t, "escalated")),
    stirring: sets.stirring.map((t) => toJobItem(t, "stirring")),
    stale: sets.stale.map((t) => toJobItem(t, "stale")),
  });

  await fs.mkdir(jobsDir, { recursive: true });
  const jobPath = path.join(jobsDir, jobFilename);
  await fs.writeFile(jobPath, card);
  const relJobPath = path.relative(boxRoot, jobPath);
  try {
    await stageAndCommitPaths(boxRoot, {
      paths: [relJobPath],
      message: `Queue todo-review job (${String(sets.escalated.length)} escalated, ${String(sets.stirring.length)} stirring, ${String(sets.stale.length)} stale)`,
      trailers: { "Created-By": "todo-review-sweep" },
    });
  } catch (e) {
    // A commit failure shouldn't lose the sweep's work — the job file is on
    // disk either way; log it loudly rather than throwing, same posture as
    // the root-landmark refill in wakeup.ts.
    console.warn(`Could not commit todo-review job ${relJobPath}: ${errorMessage(e)}`);
  }
  return relJobPath;
}
