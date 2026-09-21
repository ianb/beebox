/**
 * One way to ask the box about its todos (`docs/plans/todo-collection.md`,
 * Track 4).
 *
 * `runCollection` is generic and stateless, which means every consumer would
 * otherwise assemble the same `DeriveContext` by hand — the box's clock, the
 * box's timezone, and a `since` baseline that only the review sweep has. This
 * module does that once, so the tRPC router, `bbx query`, `bbx todos`, the
 * review sweep, and the ambient line all ask the same question the same way.
 */

import { getBoxTime } from "../../lib/time.js";
import { loadBoxTimezone } from "../box/config.js";
import { runCollection } from "../collection/run.js";
import { todoCollection, type DerivedTodo, type TodoParams, type TodoReduction } from "./collection.js";
import type { CollectionQuery, CollectionResult, DeriveContext } from "../collection/types.js";

export type TodoQuery = CollectionQuery<TodoParams>;
export type TodoQueryResult = CollectionResult<DerivedTodo, TodoReduction>;

/**
 * The box's own clock and timezone, plus the caller's baseline. `since` is a
 * box-local calendar-date epoch; only the review sweep keeps one, and
 * everything else passes `null`.
 */
async function buildTodoDeriveContext(boxRoot: string, since: number | null): Promise<DeriveContext> {
  return {
    now: getBoxTime(boxRoot),
    timeZone: (await loadBoxTimezone(boxRoot)) ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    since,
  };
}

export async function runTodoQuery(
  boxRoot: string,
  input: { query: TodoQuery; since: number | null },
): Promise<TodoQueryResult> {
  const deriveCtx = await buildTodoDeriveContext(boxRoot, input.since);
  return runCollection(boxRoot, { def: todoCollection, query: input.query, deriveCtx });
}
