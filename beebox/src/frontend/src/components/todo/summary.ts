/**
 * The place summary for one card (`docs/plans/todos-ui.md`, Track 4):
 * "3 on your plate · 1 later · 1 overdue · 2 done" — the plate's own split, so
 * the numbers agree with the plate and its badge. It is the collection's reduction, rendered —
 * boxholder scope, so an agent follow-up never counts here — and the
 * reduction is complete regardless of the status filter
 * (`core/collection/types.ts`).
 */

import { PLATE_CARD_PATH } from "@shared/todo-model";

export interface SummaryReduction {
  open: number;
  onPlate: number;
  done: number;
  parked: number;
  escalated: number;
}

interface SummaryPart {
  key: "open" | "later" | "overdue" | "parked" | "done";
  count: number;
  text: string;
}

/**
 * The line's parts, or `null` when the card has nothing to summarize.
 *
 * The open todos are split as the plate splits them: "on your plate" is
 * always named once there is a line ("0 on your plate · 2 done" says the card
 * is finished), and "later" (open, waiting for a `start`) and the rest appear
 * only when non-zero. The `open` part's `count` is every open todo, since
 * that is what decides whether there is one to go to. Dropped todos are
 * not counted: they are deliberately not being done, and a card of only
 * dropped todos gets no line.
 */
export function summaryParts(reduction: SummaryReduction): SummaryPart[] | null {
  const { open, onPlate, done, parked, escalated } = reduction;
  if (open + parked + done === 0) return null;
  const later = open - onPlate;
  const parts: SummaryPart[] = [{ key: "open", count: open, text: `${String(onPlate)} on your plate` }];
  if (later > 0) parts.push({ key: "later", count: later, text: `${String(later)} later` });
  if (escalated > 0) parts.push({ key: "overdue", count: escalated, text: `${String(escalated)} overdue` });
  if (parked > 0) parts.push({ key: "parked", count: parked, text: `${String(parked)} parked` });
  if (done > 0) parts.push({ key: "done", count: done, text: `${String(done)} done` });
  return parts;
}

/**
 * The element "N open" scrolls to: the first open boxholder todo a core
 * renderer drew (`TodoItem`'s data attributes). A box view draws none, and
 * then the count is plain text rather than a button that does nothing.
 */
export const FIRST_OPEN_TODO_SELECTOR = '[data-todo-status="open"]:not([data-todo-assigned="agent"])';

/**
 * Where a directory's todo line leads (Track 4): the directory's own
 * `todo-view` card when one sits directly in it, else the plate. The plate
 * is box-wide (its `glob` is `**`), so it opens unfiltered; a `here` passed
 * to it would not narrow an explicit glob.
 */
export function directoryListPath(cards: readonly { relativePath: string; type: string }[]): string {
  return cards.find((card) => card.type === "todo-view")?.relativePath ?? PLATE_CARD_PATH;
}
