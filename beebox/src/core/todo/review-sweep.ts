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
 * The sweep only computes. `review-check.ts` turns the sets into the brief the
 * procedure's agent works from, and the brief's instructions say what it may
 * change ("the sweep computes, the agent judges, the human decides"). No job
 * card is written: a card would also be picked up by the wakeup reactor, and
 * two agents would work the same review.
 */

import { getBoxTime } from "../../lib/time.js";
import { loadBoxTimezone } from "../box/config.js";
import { runTodoQuery } from "./query.js";
import { summaryText } from "../file-summary.js";
import { formatTodoLocation } from "./collect-types.js";
import type { DerivedTodo } from "./collection.js";
import { parseIsoDate, boxLocalDateEpoch, recheckDefers } from "../../shared/todo-model.js";
import type { TodoReviewJobItem } from "../../schemas/todo-review-job.js";

const STALE_DAYS = 45;
const CARD_LABEL_MAX = 80;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

export interface TodoReviewSets {
  escalated: SweptTodo[];
  stirring: SweptTodo[];
  stale: SweptTodo[];
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
): TodoReviewSets {
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

export function toBriefItem(todo: SweptTodo, kind: "escalated" | "stirring" | "stale"): TodoReviewJobItem {
  const item: TodoReviewJobItem = {
    locator: formatTodoLocation(todo),
    text: todo.text,
    detail: detailFor(todo, kind),
  };
  if (todo.assigned !== undefined) item.assigned = todo.assigned;
  // Where it was written. A locator says which line; these say what the
  // reader would have seen around it, so the brief reads in context.
  // A card with no title summarizes as its body, which can be the whole card:
  // one line is enough to say which card it is.
  if (todo.card !== "") item.card = todo.card.length > CARD_LABEL_MAX ? `${todo.card.slice(0, CARD_LABEL_MAX - 1)}…` : todo.card;
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
 * The three sets for today. Pure over the box's files and the caller's
 * baseline: no lock, no state write. The caller (`review-check.ts`) holds the
 * sweep lock and decides when the baseline moves.
 */
export async function computeTodoReviewSets(
  boxRoot: string,
  input: { lastSweepEpoch: number; todayEpoch: number },
): Promise<TodoReviewSets> {
  return computeSets(await sweptTodos(boxRoot, input.lastSweepEpoch), input.todayEpoch);
}
