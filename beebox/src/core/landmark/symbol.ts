/**
 * Resolve a landmark's navigation `symbol` — the one implementation.
 *
 * This existed twice: once in `src/webapp/trpc/routers/landmarks/router.ts` (correct,
 * via the shared ref algebra) and once in `summaries.ts` (a hand-rolled
 * `path.resolve(landmarkDir, src)` + `path.relative(boxRoot, …)`). The two
 * disagreed on every ref form except document-relative, which is why the same
 * card rendered its icon on the landmarks page and a broken image in the app
 * bar's place menu: the menu reads `loadLandmarkSummaries`, the page reads the
 * router.
 *
 * A box-root ref is what makes the hand-rolled version fail, and it's the
 * common form in the field:
 *
 *   src: /archive/people/marlowe/images/priya-portrait.webp
 *
 * `path.resolve(dir, "/archive/…")` ignores `dir` (an absolute path wins) and
 * yields a *filesystem* path, which `path.relative(boxRoot, …)` then turns into
 * `../../../archive/…` — outside the box, so `/api/files` 404s. An `attach/` ref
 * fails differently: resolved against the landmark's directory instead of the
 * card's attach scope. Only `parseRef` + `resolveRefPath` know the 3-form rule
 * (`beebox/CLAUDE.md` requires every ref go through them for exactly this
 * reason).
 */

import { readCardSymbol, type CardSymbolData } from "../../shared/card-symbol.js";

/**
 * The card's own top-level `symbol`: a text glyph, or an image as the
 * box-relative path the frontend hands to `/api/files`. A src that escapes the
 * box resolves to no symbol at all — a visible absence beats emitting a path
 * outside the box.
 */
export function readLandmarkSymbol(
  fields: { symbol?: CardSymbolData | undefined } | undefined,
  { landmarkPath }: { landmarkPath: string },
): CardSymbolData | null {
  const own = fields?.symbol;
  if (own === undefined) return null;
  return readCardSymbol(own, { cardPath: landmarkPath });
}
