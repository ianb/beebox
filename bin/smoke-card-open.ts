/**
 * Finding a card to open for the smoke walk's card-open step, drilling into
 * the content area once if the current listing has none.
 *
 * The browse root deliberately lists the box's underscore areas rather than
 * its real content (`beebox/docs/plans/one-root-box-layout.md`), so a
 * one-root-migrated box's root listing carries no card row at all — that
 * alone does not mean the box is broken. Split out of bin/smoke.ts to keep
 * that file's step list under the line budget.
 */

import type { BrowseSession } from "../beebox/test/tours/tour-lib/browse.js";
import { CardRefUnresolvedError, NoCardToOpenError } from "./smoke-errors.js";
import { contentAreaRow, firstCardRow, refFor } from "./smoke-snapshot.js";

export async function findCardRow(
  session: BrowseSession,
  listing: string,
): Promise<{ listing: string; row: { role: "button"; name: string } }> {
  const row = firstCardRow(listing);
  if (row !== null) return { listing, row };
  const contentRow = contentAreaRow(listing);
  if (contentRow === null) {
    throw new NoCardToOpenError(listing);
  }
  const contentRef = refFor(listing, contentRow);
  if (contentRef === null) {
    throw new CardRefUnresolvedError({ role: contentRow.role, name: contentRow.name, listing });
  }
  // The content-area row can sit below the fold in a box with many
  // underscore-area siblings (`_bookkeeping` routinely runs to hundreds of
  // items) — clickRef's click is a box-center CDP event with no
  // actionability check, so an offscreen ref fails outright rather than
  // auto-scrolling.
  await session.run(["scrollintoview", `@${contentRef}`]);
  await session.clickRef(contentRef);
  const drilled = await session.snapshot({ interactiveOnly: true });
  const drilledRow = firstCardRow(drilled);
  if (drilledRow === null) {
    throw new NoCardToOpenError(drilled);
  }
  return { listing: drilled, row: drilledRow };
}
