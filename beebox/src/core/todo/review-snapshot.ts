/**
 * What a todo is, apart from its `recheck` — the part the todo review may not
 * change on a boxholder's todo, and the part whose change puts a retired todo
 * back in review (`docs/plans/todos-ui.md`, Track 7).
 *
 * Every tag attribute but `recheck` (`id`, `status`, `assigned`, `by`,
 * `created`, `start`, `due`) and the nested `see-also` evidence. The words are
 * compared separately (they are how a todo is found again). The note after the
 * closing tag is not part of it: that is where the review writes its reason.
 */

import { z } from "zod";
import { TODO_STATUSES } from "../../shared/todo-model.js";
import type { TodoItem } from "./collect-types.js";

export const TodoSnapshotSchema = z.object({
  status: z.enum(TODO_STATUSES),
  id: z.string().optional(),
  assigned: z.string().optional(),
  by: z.string().optional(),
  created: z.string().optional(),
  start: z.string().optional(),
  due: z.string().optional(),
  /** The nested `see-also` entries, as JSON, compared as a whole. */
  seeAlso: z.string(),
});

export type TodoSnapshot = z.infer<typeof TodoSnapshotSchema>;

/** Snapshot fields that are single tag attributes, in the order a message names them. */
const ATTRIBUTES = ["id", "status", "assigned", "by", "created", "start", "due"] as const;

export function snapshotOf(todo: TodoItem): TodoSnapshot {
  const snapshot: TodoSnapshot = { status: todo.status, seeAlso: JSON.stringify(todo.seeAlso) };
  for (const name of ATTRIBUTES) {
    const value = todo[name];
    if (name !== "status" && value !== undefined) snapshot[name] = value;
  }
  return snapshot;
}

/** The names of what differs between `snapshot` and `todo` now (`see-also` for the nested evidence); `[]` when nothing does. */
export function changedSince(snapshot: TodoSnapshot, todo: TodoItem): string[] {
  const now = snapshotOf(todo);
  const changed: string[] = ATTRIBUTES.filter((name) => snapshot[name] !== now[name]);
  if (snapshot.seeAlso !== now.seeAlso) changed.push("see-also");
  return changed;
}
