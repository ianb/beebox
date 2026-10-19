/**
 * The root place's stock summary: the body `installRootLandmark` writes on a
 * new box's root landmark (docs/plans/front-door.md, Track A). The agent
 * replaces it with the person's words once it learns what the box is for; the
 * compiled briefing and the phone's empty root chat recognize it by text
 * equality with the trimmed body. It lives in `shared/` because the phone
 * layout shows its first two sentences; `schemas/landmark.ts` re-exports it.
 */

/** The first two sentences, shown above the openers in the phone's empty root chat. */
export const STOCK_ROOT_SUMMARY_LEAD =
  "This is your box. Tell me about things you want to keep track of and I'll keep them here, in your words, and bring them back when you ask.";

export const STOCK_ROOT_SUMMARY = `${STOCK_ROOT_SUMMARY_LEAD} You could photograph something and tell me about it, talk through a plan, or name a kind of thing to keep, like what you've lent out or what's due. When a list gets long, ask me for a page that shows it the way you want.`;

/** Whether a landmark body is still the stock summary (any whitespace edit aside). */
export function isStockRootSummary(body: string): boolean {
  return body.trim() === STOCK_ROOT_SUMMARY;
}
