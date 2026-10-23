/**
 * Pure rules behind `TodoItem` (`docs/implemented-plans/todos-ui.md`, Track 2): how a
 * todo's words are treated, which todos a reading view leaves out, and how a
 * date chip reads. Split from the component so each rule is testable
 * without rendering (`src/frontend/test/components/todo/TodoItem.todo-item.test.ts`).
 */

import {
  parseIsoDate,
  parseRecheck,
  RECHECK_NEVER,
  resolveStartEpoch,
  TODO_AGENT,
  type TodoPlateState,
  type TodoStatus,
} from "@shared/todo-model";

/**
 * Status treatment for a todo's own words, the same in a card body, in
 * frontmatter, and in the list. Colors come from the card theme's ink
 * (`card-ink`, `card-soft`), so a todo reads on light and dark themes alike;
 * outside a themed card they fall back to the warm palette.
 */
const STATUS_TEXT_CLASS: Record<TodoStatus, string> = {
  open: "text-card-ink",
  done: "text-card-soft bbx-struck",
  parked: "text-card-soft",
  dropped: "text-card-soft bbx-struck",
};

/** The status word: the name of a checkbox whose todo's words are not known, and the prefix for a parked or dropped one. */
const STATUS_LABEL: Record<TodoStatus, string> = {
  open: "Open",
  done: "Done",
  parked: "Parked",
  dropped: "Dropped",
};

/**
 * The checkbox's accessible name: the todo it controls. The checked state
 * already says open or done; a parked or dropped todo, which a checkbox
 * cannot express, is prefixed with its status. Without the words, the status.
 */
export function checkboxName(status: TodoStatus, text: string | null): string {
  const words = text?.trim() ?? "";
  if (words === "") return STATUS_LABEL[status];
  return status === "parked" || status === "dropped" ? `${STATUS_LABEL[status]}: ${words}` : words;
}

interface TodoWho {
  status: TodoStatus;
  assigned: string | undefined;
}

/**
 * An open agent follow-up is the agent's to do, not the reader's: it reads in
 * the quiet (parked) treatment so it stays out of the reader's way.
 */
export function todoTextClass({ status, assigned }: TodoWho): string {
  if (status === "open" && assigned === TODO_AGENT) return STATUS_TEXT_CLASS.parked;
  return STATUS_TEXT_CLASS[status];
}

/**
 * A finished agent follow-up is bookkeeping, not something the reader wrote
 * or has to read past: a card's reading view (body and frontmatter) leaves it
 * out. The list is not a reading view and keeps its own scope rules.
 */
export function hiddenInReading({ status, assigned }: TodoWho): boolean {
  if (assigned !== TODO_AGENT) return false;
  switch (status) {
    case "done":
    case "dropped":
      return true;
    case "open":
    case "parked":
      return false;
  }
}

/**
 * "Sep 15", or "Sep 15, 2027" outside the current year. The epoch is a UTC
 * calendar day (`parseIsoDate`), so it is formatted in UTC: the day shown is
 * the day written, in every browser zone (`FriendlyDate.tsx` has the same
 * rule and the bug it prevents).
 */
function dayLabel(epoch: number, { nowYear, locale }: { nowYear: number; locale: string | undefined }): string {
  const sameYear = new Date(epoch).getUTCFullYear() === nowYear;
  return new Date(epoch).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

interface TodoDateChip {
  kind: "due" | "start";
  /** The value as written, for the `<time>` element's machine-readable form when it is a date. */
  iso: string | null;
  text: string;
  /** Warning treatment: an escalated todo's due chip. */
  warning: boolean;
}

/**
 * What goes before a `start` date: "later ·" while the day has not come
 * (plate state `quiet` for an open todo), "since" once it has. Only an open
 * todo's plate state says which; for a parked or finished one, or before the
 * server answers, the start is compared with today's local date — the
 * person's own calendar day, as the server's box-local one is.
 */
export function startPrefix({ plateState, startIso, todayIso }: {
  plateState: TodoPlateState | null;
  startIso: string | null;
  /** Today's local ISO date; absent means the clock's. */
  todayIso?: string;
}): "later ·" | "since" {
  if (plateState === "quiet") return "later ·";
  if (plateState === "on-plate" || plateState === "escalated") return "since";
  return startIso === null || startIso > (todayIso ?? localIsoDate(new Date())) ? "later ·" : "since";
}

function localIsoDate(date: Date): string {
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The word before a due date: "overdue" once plate state says it is past, else "due". */
export function dueWord(plateState: TodoPlateState | null): "overdue" | "due" {
  return plateState === "escalated" ? "overdue" : "due";
}

/**
 * The earliest date among a card's open todos and what kind it is, for the
 * card row's badge: "due Nov 7", "overdue Oct 15", "starts Oct 24". It repeats
 * the reduction's `next` rule (`core/todo/collection.ts`: the earliest `due` or
 * resolved `start` of an open todo) but keeps which field won, which the
 * reduction does not carry. A `due` wins a tie with a `start`, as in the
 * dated strip. `null` when no open todo carries a date.
 */
export function nextDateOf(items: readonly {
  status: TodoStatus;
  due?: string | undefined;
  start?: string | undefined;
  plateState: TodoPlateState | null;
}[]): { iso: string; word: "overdue" | "due" | "starts" | "since" } | null {
  const candidates: { epoch: number; kind: "due" | "start"; plateState: TodoPlateState | null }[] = [];
  for (const item of items) {
    if (item.status !== "open") continue;
    const due = item.due === undefined ? null : parseIsoDate(item.due);
    if (due !== null) candidates.push({ epoch: due, kind: "due", plateState: item.plateState });
    const start = item.start === undefined ? null : resolveStartEpoch(item.start, item.due);
    if (start !== null) candidates.push({ epoch: start, kind: "start", plateState: item.plateState });
  }
  const [best] = candidates.toSorted((a, b) => a.epoch - b.epoch || (a.kind === b.kind ? 0 : a.kind === "due" ? -1 : 1));
  if (best === undefined) return null;
  const iso = new Date(best.epoch).toISOString().slice(0, 10);
  if (best.kind === "due") return { iso, word: dueWord(best.plateState) };
  return { iso, word: startPrefix({ plateState: best.plateState, startIso: iso }) === "since" ? "since" : "starts" };
}

/**
 * The date chips a todo shows. A `start` relative to `due` ("-3d") is shown as
 * the day it resolves to, after `startPrefix`: "later · Oct 23". An escalated todo's due chip reads
 * "overdue · Sep 15"; plate state comes from the server (it depends on the
 * box timezone), so `plateState: null` — not loaded yet — never escalates.
 */
export function dateChips(
  todo: { due: string | undefined; start: string | undefined; plateState: TodoPlateState | null },
  format: { nowYear: number; locale: string | undefined },
): TodoDateChip[] {
  const chips: TodoDateChip[] = [];
  const { due, start, plateState } = todo;
  if (due !== undefined && due !== "") {
    const epoch = parseIsoDate(due);
    const day = epoch === null ? due : dayLabel(epoch, format);
    const warning = plateState === "escalated";
    chips.push({ kind: "due", iso: epoch === null ? null : due, text: warning ? `overdue · ${day}` : `due ${day}`, warning });
  }
  if (start !== undefined && start !== "") {
    const epoch = resolveStartEpoch(start, due);
    const iso = epoch === null ? null : new Date(epoch).toISOString().slice(0, 10);
    chips.push({ kind: "start", iso, text: `${startPrefix({ plateState, startIso: iso })} ${epoch === null ? start : dayLabel(epoch, format)}`, warning: false });
  }
  return chips;
}

/**
 * The list's quiet `recheck` chip (Track 7): when the todo-review will next
 * list an open todo, or that it no longer will. `null` for a todo that is not
 * open or has no (valid) `recheck`. The list only; a reading view never shows
 * it, since `recheck` is the review's bookkeeping, not the reader's plan.
 */
export function recheckChip(
  todo: { status: TodoStatus; recheck: string | undefined },
  format: { nowYear: number; locale: string | undefined },
): { iso: string | null; text: string } | null {
  if (todo.status !== "open") return null;
  const parsed = parseRecheck(todo.recheck);
  if (parsed === null) return null;
  if (parsed === RECHECK_NEVER) return { iso: null, text: "no longer reviewed" };
  return { iso: todo.recheck ?? null, text: `agent checks again ${dayLabel(parsed, format)}` };
}
