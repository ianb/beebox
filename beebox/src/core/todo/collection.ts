/**
 * Todos as a collection — the first (and today the only) `CollectionDef`
 * (`docs/plans/todo-collection.md`, Track 3).
 *
 * Nothing new is decided here. The filter is `todos.list`'s filter, the plate
 * grouping is the order and the labels the list already shows, `stirring` is
 * the review sweep's own rule, and the reduction counts exactly what the
 * ambient line and the card header need. What changes is that all of it is
 * written once, as data, instead of four times in four consumers.
 */

import { z } from "zod";
import {
  parseIsoDate,
  resolveStartEpoch,
  TODO_STATUSES,
  type TodoPlateState,
  type TodoStatus,
} from "../../shared/todo-model.js";
import { assertNever } from "../../lib/invariant.js";
import { compareTodoLocator, formatTodoLocation, type CollectedTodo, type TodoItem } from "./collect-types.js";
import { deriveTodo } from "./derive.js";
import { extractCardTodos, mayHaveTodo } from "./extract.js";
import type { CollectionDef, DeriveContext, GroupKey } from "../collection/types.js";

/** A collected todo plus the one thing that needs a baseline rather than a clock. */
export interface DerivedTodo extends CollectedTodo {
  /**
   * Open, on the plate, and its `start` was crossed since the caller's
   * `since` baseline — the review sweep's "stirring" set. Always `false` when
   * the caller has no baseline.
   */
  stirring: boolean;
}

/** What a todo query can ask for — `todos.list`'s inputs, unchanged in meaning. */
export const TodoParamsSchema = z.object({
  status: z.array(z.enum(TODO_STATUSES)).default(["open", "parked"]),
  assigned: z.string().optional(),
  onPlate: z.boolean().optional(),
});

export type TodoParams = z.infer<typeof TodoParamsSchema>;

/** What a set of todos amounts to. `onPlate` and `escalated` are what the ambient line needs; `open`/`done` are what a card header's "5 of 7" needs. */
export interface TodoReduction {
  open: number;
  done: number;
  dropped: number;
  parked: number;
  /** Open todos whose plate state is `escalated` or `on-plate`. */
  onPlate: number;
  /** Open todos past their `due` — the first of those. */
  escalated: number;
  /** The earliest `due` or resolved `start` among open todos, as an ISO date. */
  next: string | null;
}

/** The plate grouping: the six states in the order and with the labels the list already uses. */
const PLATE_GROUPS: ReadonlyArray<{ state: TodoPlateState; label: string }> = [
  { state: "escalated", label: "Escalated" },
  { state: "on-plate", label: "On the plate" },
  { state: "quiet", label: "Quiet" },
  { state: "parked", label: "Parked" },
  { state: "done", label: "Done" },
  { state: "dropped", label: "Dropped" },
];

function plateGroup(item: DerivedTodo): GroupKey {
  const index = PLATE_GROUPS.findIndex((group) => group.state === item.plateState);
  const group = PLATE_GROUPS[index];
  if (group === undefined) return { key: item.plateState, label: item.plateState, order: PLATE_GROUPS.length };
  return { key: group.state, label: group.label, order: index };
}

/**
 * `place` is one group: position IS the meaning, and the renderer nests
 * sections and parents inside each row. It exists as a grouping rather than
 * as "no grouping" so a consumer switching between the two has one control.
 */
function placeGroup(): GroupKey {
  return { key: "place", label: "By place", order: 0 };
}

function isStirring(item: CollectedTodo, since: number | null): boolean {
  if (since === null) return false;
  if (item.status !== "open") return false;
  if (item.plateState !== "on-plate" || item.start === undefined) return false;
  const startEpoch = resolveStartEpoch(item.start, item.due);
  return startEpoch !== null && startEpoch > since;
}

function deriveTodoItem(item: TodoItem, ctx: DeriveContext): DerivedTodo {
  const derived = deriveTodo(item, { now: ctx.now, timeZone: ctx.timeZone });
  return { ...derived, stirring: isStirring(derived, ctx.since) };
}

function matchesParams(item: DerivedTodo, params: TodoParams): boolean {
  if (!params.status.includes(item.status)) return false;
  if (params.assigned !== undefined && item.assigned !== params.assigned) return false;
  if (params.onPlate === true && item.plateState !== "escalated" && item.plateState !== "on-plate") return false;
  return true;
}

/** The dates that could make a todo the next thing due — its `due`, and its `start` once resolved against that `due`. */
function dateEpochs(item: DerivedTodo): number[] {
  const out: number[] = [];
  if (item.due !== undefined) {
    const due = parseIsoDate(item.due);
    if (due !== null) out.push(due);
  }
  if (item.start !== undefined) {
    const start = resolveStartEpoch(item.start, item.due);
    if (start !== null) out.push(start);
  }
  return out;
}

function reduceTodos(items: DerivedTodo[]): TodoReduction {
  const counts = { open: 0, done: 0, dropped: 0, parked: 0 };
  let onPlate = 0;
  let escalated = 0;
  let next: number | null = null;

  for (const item of items) {
    countStatus(counts, item.status);
    if (item.status !== "open") continue;
    if (item.plateState === "escalated") escalated++;
    if (item.plateState === "escalated" || item.plateState === "on-plate") onPlate++;
    for (const epoch of dateEpochs(item)) {
      if (next === null || epoch < next) next = epoch;
    }
  }

  return {
    ...counts,
    onPlate,
    escalated,
    next: next === null ? null : new Date(next).toISOString().slice(0, 10),
  };
}

function countStatus(counts: { open: number; done: number; dropped: number; parked: number }, status: TodoStatus): void {
  switch (status) {
    case "open":
      counts.open++;
      return;
    case "done":
      counts.done++;
      return;
    case "dropped":
      counts.dropped++;
      return;
    case "parked":
      counts.parked++;
      return;
    default:
      assertNever(status);
  }
}

export const todoCollection: CollectionDef<TodoItem, DerivedTodo, TodoParams, TodoReduction> = {
  name: "todos",
  params: TodoParamsSchema,
  extract: extractCardTodos,
  mayHaveItem: mayHaveTodo,
  derive: deriveTodoItem,
  matches: matchesParams,
  refsOf: (item) => item.refs,
  keyOf: formatTodoLocation,
  parentKeyOf: (item) =>
    item.parent === null ? null : formatTodoLocation({ path: item.path, locator: item.parent }),
  compareItems: (a, b) => compareTodoLocator(a.locator, b.locator),
  sectionOf: (item) => item.sectionPath,
  reduce: reduceTodos,
  groupings: { place: placeGroup, plate: plateGroup },
};
