/**
 * Composition of the browser tab's title.
 *
 * One router serves many boxes across many checkouts, so a tab strip can hold
 * several tabs of this app at once. The title's job is to tell them apart,
 * and browsers truncate tabs to roughly the first twenty characters — so the
 * most distinguishing text goes first and the least goes last:
 *
 *     <mark> <page> — <box>    "⚗️ Acids & Bases — Notes"
 *
 * The app name is not in it. The favicon already says which app this is, and
 * a third segment is never visible in a real tab strip. `Bee Box` shows
 * up only where there is no box to name: `/`, `/auth/login`, `/auth/setup`.
 *
 * `page` is the leaf route's `staticData.title` unless the page publishes a
 * better one (a chat's label, a card's title) via `usePageTitle` — see
 * `components/DocumentTitle.tsx`.
 *
 * `mark` is the emoji of the landmark for the directory you are in, and leads
 * because the front of a title is the part a tab strip actually shows. It is
 * the *landmark's* mark, not the box's — the box's is the favicon
 * (`components/DocumentIcon.tsx`). Between them a tab says which box it
 * belongs to and which place inside it you are looking at, and neither has to
 * give up its slot to the other.
 */

const APP_NAME = "Bee Box";

/**
 * Join the page and box halves into a tab title.
 *
 * `page` is null on routes that name nothing (redirects, layouts); `box` is
 * null outside a box. Either may be a blank string from a trimmed-empty
 * value, which counts as absent.
 */
export function composeDocumentTitle({
  mark,
  page,
  box,
}: {
  /** The current landmark's emoji, led with so it survives truncation. */
  mark?: string | null | undefined;
  page: string | null | undefined;
  box: string | null | undefined;
}): string {
  const markGlyph = mark?.trim() || null;
  const pageName = page?.trim() || null;
  const boxName = box?.trim() || null;

  const named = pageName === null ? (boxName ?? APP_NAME) : `${pageName} — ${boxName ?? APP_NAME}`;
  return markGlyph === null ? named : `${markGlyph} ${named}`;
}
