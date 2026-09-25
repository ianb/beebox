/**
 * Pure rules behind `TodoItem` (`docs/plans/todos-ui.md`, Track 2): how a
 * todo's words are treated, which todos a reading view leaves out, and how a
 * date chip reads. Split from the component so each rule is doctestable
 * without rendering (`test/frontend/components/todo-item.doctest.md`).
 */

import { parseIsoDate, resolveStartEpoch, TODO_AGENT, type TodoPlateState, type TodoStatus } from "@shared/todo-model";

/** Status treatment for a todo's own words, the same in a card body, in frontmatter, and in the list. */
const STATUS_TEXT_CLASS: Record<TodoStatus, string> = {
  open: "text-warm-800",
  done: "text-warm-400 line-through",
  parked: "text-warm-400",
  dropped: "text-warm-400 line-through",
};

/** The checkbox's accessible name: the status, since the box is read-only until Track 3 makes it live. */
export const STATUS_LABEL: Record<TodoStatus, string> = {
  open: "Open",
  done: "Done",
  parked: "Parked",
  dropped: "Dropped",
};

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
 * The date chips a todo shows. A `start` relative to `due` ("-3d") is shown as
 * the day it resolves to. An escalated todo's due chip reads
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
    chips.push({ kind: "start", iso, text: `starts ${epoch === null ? start : dayLabel(epoch, format)}`, warning: false });
  }
  return chips;
}
