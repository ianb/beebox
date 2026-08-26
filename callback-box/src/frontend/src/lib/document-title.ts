/**
 * Composition of the browser tab's title.
 *
 * One router serves many boxes across many checkouts, so a tab strip can hold
 * several tabs of this app at once. The title's job is to tell them apart,
 * and browsers truncate tabs to roughly the first twenty characters — so the
 * most distinguishing text goes first and the least goes last:
 *
 *     <page> — <box>          "Grocery planning — Notes"
 *
 * The app name is not in it. The favicon already says which app this is, and
 * a third segment is never visible in a real tab strip. `Callback Box` shows
 * up only where there is no box to name: `/`, `/auth/login`, `/auth/setup`.
 *
 * `page` is the leaf route's `staticData.title` unless the page publishes a
 * better one (a chat's label, a card's title) via `usePageTitle` — see
 * `components/DocumentTitle.tsx`.
 */

const APP_NAME = "Callback Box";

/**
 * Join the page and box halves into a tab title.
 *
 * `page` is null on routes that name nothing (redirects, layouts); `box` is
 * null outside a box. Either may be a blank string from a trimmed-empty
 * value, which counts as absent.
 */
export function composeDocumentTitle({
  page,
  box,
}: {
  page: string | null | undefined;
  box: string | null | undefined;
}): string {
  const pageName = page?.trim() || null;
  const boxName = box?.trim() || null;

  if (pageName === null) return boxName ?? APP_NAME;
  return `${pageName} — ${boxName ?? APP_NAME}`;
}
