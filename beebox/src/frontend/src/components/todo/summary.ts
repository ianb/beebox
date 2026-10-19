/**
 * The place summary for one card (`docs/implemented-plans/todos-ui.md`, Track 4):
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
  /** This count is the control that goes to the todos (`OpenAction`). */
  action: boolean;
}

/**
 * The line's parts, or `null` when the card has nothing to summarize.
 *
 * The open todos are split as the plate splits them: "on your plate" is
 * always named once there is a line ("0 on your plate · 2 done" says the card
 * is finished), and "later" (open, waiting for a `start`) and the rest appear
 * only when non-zero. The control is "on your plate" when it counts any,
 * else "later", so it never names a set it does not lead to. Dropped todos are
 * not counted: they are deliberately not being done, and a card of only
 * dropped todos gets no line.
 */
export function summaryParts(reduction: SummaryReduction): SummaryPart[] | null {
  const { open, onPlate, done, parked, escalated } = reduction;
  if (open + parked + done === 0) return null;
  const later = open - onPlate;
  const parts: SummaryPart[] = [{ key: "open", count: onPlate, text: `${String(onPlate)} on your plate`, action: onPlate > 0 }];
  if (later > 0) parts.push({ key: "later", count: later, text: `${String(later)} later`, action: onPlate === 0 });
  if (escalated > 0) parts.push({ key: "overdue", count: escalated, text: `${String(escalated)} overdue`, action: false });
  if (parked > 0) parts.push({ key: "parked", count: parked, text: `${String(parked)} parked`, action: false });
  if (done > 0) parts.push({ key: "done", count: done, text: `${String(done)} done`, action: false });
  return parts;
}

/**
 * The element "N open" scrolls to: the first open boxholder todo a core
 * renderer drew (`TodoItem`'s data attributes). A box view draws none, and
 * then the count is plain text rather than a button that does nothing.
 */
const FIRST_OPEN_TODO_SELECTOR = '[data-todo-status="open"]:not([data-todo-assigned="agent"])';

/**
 * Where the line's control goes: the first todo in the set it names — on the
 * plate, else later. Plate state must be explicit, so a todo embedded from
 * another card (no plate state here) is never the target.
 */
export function controlTargetSelector(reduction: { onPlate: number }): string {
  const states = reduction.onPlate > 0 ? ["on-plate", "escalated"] : ["quiet"];
  return states.map((state) => `${FIRST_OPEN_TODO_SELECTOR}[data-todo-plate-state="${state}"]`).join(", ");
}

/**
 * Where a directory's todo line leads (Track 4): the directory's own
 * `todo-view` card when one sits directly in it, else the plate. The plate
 * is box-wide (its `glob` is `**`), so it opens unfiltered; a `here` passed
 * to it would not narrow an explicit glob.
 */
export function directoryListPath(cards: readonly { relativePath: string; type: string }[]): string {
  return cards.find((card) => card.type === "todo-view")?.relativePath ?? PLATE_CARD_PATH;
}
