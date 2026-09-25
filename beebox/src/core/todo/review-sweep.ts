/**
 * The `todo-review` sweep (`docs/implemented-plans/todo-annotation.md` Track
 * 5b). Since `docs/plans/todos-ui.md` Track 7 it runs as the precheck of the
 * stock `todo-review` procedure (`bbx engine todo-review check`,
 * `review-check.ts`) on its own daily schedule, not inside `bbx wakeup`.
 *
 * Runs the todo collection box-wide (`core/todo/query.ts`, the same runner
 * `bbx query todos` and the web list use) and computes three sets of *open*
 * todos, leaving out any todo whose `recheck` is `never` or still ahead:
 * - **escalated** — past `due`.
 * - **stirring** — crossed `start` since the last sweep. The baseline is the
 *   sweep's own (`lastSweepDateEpoch`, `review-state.ts`), handed to the
 *   runner as the query's `since`; the collection derives `stirring` from
 *   it. Only this set needs a baseline: escalated and stale are recomputed
 *   fresh every pass.
 * - **stale** — open, has `created`, is more than 45 days old, and has
 *   neither `start` nor `due` (so it never even entered the escalated/
 *   stirring math).
 *
 * When all three are empty, the sweep does nothing — no job card, no output.
 * When any is nonempty, it queues a `todo-review-job` card UNLESS a
 * `todo-review` job is already pending, so a slow-to-process brief doesn't
 * get restated. The sweep only computes; the job's own instructions tell the
 * agent what it may change ("the sweep computes, the agent judges, the human
 * decides").
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getBoxDir } from "../../lib/paths.js";
import { getBoxTime } from "../../lib/time.js";
import { loadBoxTimezone } from "../box/config.js";
import { errorMessage } from "../../lib/error-guards.js";
import { stageAndCommitPaths } from "../../lib/git.js";
import { findJobCards } from "../reactor/job-discovery.js";
import { runTodoQuery } from "./query.js";
import { summaryText } from "../file-summary.js";
import { formatTodoLocation } from "./collect-types.js";
import type { DerivedTodo } from "./collection.js";
import { parseIsoDate, boxLocalDateEpoch, recheckDefers } from "../../shared/todo-model.js";
import { createTodoReviewJobTemplate, type TodoReviewJobItem } from "../../schemas/todo-review-job.js";
import { loadSweepState, saveSweepState, withSweepLock } from "./review-state.js";

const STALE_DAYS = 45;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const TODO_REVIEW_JOB_SOURCE = "todo-review";

/** The box-local calendar date today, as the UTC-midnight epoch `start`/`due`/`recheck` parse to. */
export async function boxTodayEpoch(boxRoot: string): Promise<number> {
  const timeZone = (await loadBoxTimezone(boxRoot)) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return boxLocalDateEpoch(getBoxTime(boxRoot), timeZone);
}

/**
 * A swept todo, plus the two things that make it readable in the brief
 * without opening the card: what the card is, and what heading it sat under.
 */
export type SweptTodo = DerivedTodo & { card: string; section: string };

export interface TodoReviewSweepResult {
  escalated: SweptTodo[];
  stirring: SweptTodo[];
  stale: SweptTodo[];
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

/**
 * Split a box's open todos into escalated / stirring / stale, per the module
 * doc's definitions. `stirring` is already decided — the collection derived
 * it from the `since` baseline this sweep handed the runner — so the only
 * date arithmetic left here is the stale rule, which is the sweep's own.
 */
function computeSets(
  all: SweptTodo[],
  todayEpoch: number,
): Pick<TodoReviewSweepResult, "escalated" | "stirring" | "stale"> {
  // A todo whose `recheck` is `never` or still ahead is out of every set: the
  // review already looked at it and said when to look again (Track 7).
  const todos = all.filter((t) => !recheckDefers(t.recheck, todayEpoch));

  const escalated = todos.filter((t) => t.plateState === "escalated");

  const stirring = todos.filter((t) => t.stirring);

  const stale = todos.filter((t) => {
    if (t.start !== undefined || t.due !== undefined || t.created === undefined) return false;
    const age = ageInDays(t.created, todayEpoch);
    return age !== null && age > STALE_DAYS;
  });

  return { escalated, stirring, stale };
}

/** One item's `detail` line — whichever date drove it into its set, human-readable. */
function detailFor(todo: SweptTodo, kind: "escalated" | "stirring" | "stale"): string {
  switch (kind) {
    case "escalated":
      return `due ${todo.due ?? "?"}`;
    case "stirring":
      return `started ${todo.start ?? "?"}`;
    case "stale":
      return `created ${todo.created ?? "?"}`;
  }
}

function toJobItem(todo: SweptTodo, kind: "escalated" | "stirring" | "stale"): TodoReviewJobItem {
  const item: TodoReviewJobItem = {
    locator: formatTodoLocation(todo),
    text: todo.text,
    detail: detailFor(todo, kind),
  };
  if (todo.assigned !== undefined) item.assigned = todo.assigned;
  // Where it was written. A locator says which line; these say what the
  // reader would have seen around it, so the brief reads in context.
  if (todo.card !== "") item.card = todo.card;
  if (todo.section !== "") item.section = todo.section;
  return item;
}

/** Every open todo the box holds, each carrying its card's summary text and its heading path. */
async function sweptTodos(boxRoot: string, lastSweepEpoch: number): Promise<SweptTodo[]> {
  const result = await runTodoQuery(boxRoot, {
    // `scope: "all"` — the sweep's job brief rides agent follow-ups along as
    // an exception (module doc, point 4); a default `boxholder` scope would
    // make them invisible to it.
    query: { here: "", params: { status: ["open"], scope: "all" } },
    since: lastSweepEpoch,
  });
  const out: SweptTodo[] = [];
  for (const group of result.groups) {
    for (const row of group.rows) {
      const card = summaryText(row.card);
      for (const item of row.items) {
        if (!item.matching) continue;
        out.push({ ...item, card, section: item.sectionPath.join(" › ") });
      }
    }
  }
  return out;
}

/**
 * Run the todo-review sweep once under the sweep lock (`review-state.ts`), so
 * two concurrent runs can't both load the same `lastSweepDateEpoch` baseline,
 * each compute a job, and step on each other's write.
 */
export async function runTodoReviewSweep(boxRoot: string): Promise<TodoReviewSweepResult> {
  return withSweepLock(boxRoot, () => runTodoReviewSweepLocked(boxRoot));
}

/**
 * The sweep's actual work. The caller holds the sweep lock.
 *
 * `lastSweepDateEpoch` only advances past today when this pass's findings
 * actually reached a job: either the sets were genuinely empty (nothing
 * to report — always safe to move forward), or a job got queued this pass. If
 * a `todo-review` job was ALREADY pending (or queuing throws), the baseline is
 * left where it was — advancing it anyway would fold this pass's newly
 * stirring/stale items into the baseline and make them permanently
 * unreportable once the pending job finally clears (the durability bug this
 * fixes). Leaving the baseline alone means the next sweep recomputes the same
 * sets and tries again.
 */
export async function runTodoReviewSweepLocked(boxRoot: string): Promise<TodoReviewSweepResult> {
  const todayEpoch = await boxTodayEpoch(boxRoot);

  const state = await loadSweepState(boxRoot);
  const lastSweepEpoch = state.lastSweepDateEpoch ?? 0; // first run: everything already on-plate counts as "crossed since the box existed"

  const sets = computeSets(await sweptTodos(boxRoot, lastSweepEpoch), todayEpoch);

  const isEmpty = sets.escalated.length === 0 && sets.stirring.length === 0 && sets.stale.length === 0;
  if (isEmpty) {
    await saveSweepState(boxRoot, { ...state, lastSweepDateEpoch: todayEpoch });
    return { ...sets, jobPath: null };
  }

  const jobPath = await queueReviewJob(boxRoot, sets);
  if (jobPath !== null) {
    await saveSweepState(boxRoot, { ...state, lastSweepDateEpoch: todayEpoch });
  }
  return { ...sets, jobPath };
}

async function queueReviewJob(
  boxRoot: string,
  sets: Pick<TodoReviewSweepResult, "escalated" | "stirring" | "stale">,
): Promise<string | null> {
  const jobsDir = getBoxDir(boxRoot, "jobs");
  const pending = await findJobCards(jobsDir, { sourceFilter: TODO_REVIEW_JOB_SOURCE });
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
