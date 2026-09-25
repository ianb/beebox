/**
 * `todos-unreviewed` — open todos the todo-review has stopped listing
 * (`recheck="never"`, `docs/plans/todos-ui.md` Track 7).
 *
 * The review's verify step retires a todo that was pushed three times with
 * nothing about it changing. That todo then never comes back on its own, so
 * this warning is where it stays visible. Boxholder todos only: agent
 * follow-ups are not reviewed for the boxholder. Removing `recheck`, or any
 * edit to the todo, puts it back in review.
 *
 * Runs the todo collection box-wide, which the Track 1 prefilter keeps to the
 * cards whose text can hold a todo.
 */

import { runTodoQuery } from "../../../core/todo/query.js";
import { formatTodoLocation } from "../../../core/todo/collect-types.js";
import { RECHECK_NEVER } from "../../../shared/todo-model.js";
import type { DerivedTodo } from "../../../core/todo/collection.js";
import type { HealthCheck } from "./health.js";

/** How many todos the message names. */
const NAMED = 3;

/** Oldest first: by `created` when the todo has one, then by where it is written. */
function compareAge(a: DerivedTodo, b: DerivedTodo): number {
  if (a.created !== b.created) {
    if (a.created === undefined) return 1;
    if (b.created === undefined) return -1;
    return a.created < b.created ? -1 : 1;
  }
  return formatTodoLocation(a).localeCompare(formatTodoLocation(b));
}

export async function unreviewedTodosCheck(boxRoot: string): Promise<HealthCheck> {
  const result = await runTodoQuery(boxRoot, {
    query: { here: "", params: { status: ["open"], scope: "boxholder" } },
    since: null,
  });
  const retired: DerivedTodo[] = [];
  for (const group of result.groups) {
    for (const row of group.rows) {
      for (const item of row.items) {
        if (item.matching && item.recheck === RECHECK_NEVER) retired.push(item);
      }
    }
  }
  retired.sort(compareAge);
  const named = retired.slice(0, NAMED).map((t) => `${formatTodoLocation(t)} "${t.text}"`);
  const more = retired.length > NAMED ? `, and ${String(retired.length - NAMED)} more` : "";
  return {
    name: "todos-unreviewed",
    ok: retired.length === 0,
    message:
      retired.length === 0
        ? "every open todo is still reviewed"
        : `${String(retired.length)} open todo${retired.length === 1 ? " is" : "s are"} no longer reviewed: ` +
          `${named.join("; ")}${more}. Remove recheck="never" or edit one to put it back in review.`,
    severity: "warning",
  };
}
