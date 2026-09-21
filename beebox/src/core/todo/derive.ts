/**
 * The derive stage: the one place the clock touches a todo.
 *
 * Extraction (`extract.ts`) is pure and cacheable; plate-state is not, because
 * it depends on what box-local day it is right now. Splitting them is the
 * whole point of Track 2 (`docs/plans/todo-collection.md`) — a cache cannot
 * sit behind a function that reads `now`.
 *
 * The rule itself is unchanged and still lives in `shared/todo-model.ts`.
 */

import { deriveTodoPlateState, type TodoPlateContext } from "../../shared/todo-model.js";
import { plateInputFor, type CollectedTodo, type TodoItem } from "./collect-types.js";

/** Add the box-local plate-state to an extracted todo. */
export function deriveTodo(item: TodoItem, ctx: TodoPlateContext): CollectedTodo {
  return {
    ...item,
    plateState: deriveTodoPlateState(
      plateInputFor({ status: item.status, start: item.start, due: item.due }),
      ctx
    ),
  };
}
