/**
 * The place summary for one card (`docs/plans/todos-ui.md`, Track 4):
 * "3 open · 1 overdue · 2 done". It is the collection's reduction, rendered —
 * boxholder scope, so an agent follow-up never counts here — and the
 * reduction is complete regardless of the status filter
 * (`core/collection/types.ts`).
 */

export interface SummaryReduction {
  open: number;
  done: number;
  parked: number;
  escalated: number;
}

interface SummaryPart {
  key: "open" | "overdue" | "parked" | "done";
  count: number;
  text: string;
}

/**
 * The line's parts, or `null` when the card has nothing to summarize.
 *
 * `open` is always named once there is a line ("0 open · 2 done" says the
 * card is finished); the rest appear only when non-zero. Dropped todos are
 * not counted: they are deliberately not being done, and a card of only
 * dropped todos gets no line.
 */
export function summaryParts(reduction: SummaryReduction): SummaryPart[] | null {
  const { open, done, parked, escalated } = reduction;
  if (open + parked + done === 0) return null;
  const parts: SummaryPart[] = [{ key: "open", count: open, text: `${String(open)} open` }];
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
