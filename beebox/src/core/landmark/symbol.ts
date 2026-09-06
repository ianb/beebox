/**
 * Resolve a landmark's navigation `symbol` — the one implementation.
 *
 * This existed twice: once in `src/webapp/trpc/routers/landmarks.ts` (correct,
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

import { readCardSymbol } from "../card-symbol.js";
import type { LandmarkNavigationData } from "../../schemas/landmark.js";
import type { CardSymbolData } from "../../shared/card-symbol.js";

/**
 * The card's own `symbol` (the global field) wins; a landmark that still
 * carries the legacy nested `navigation.symbol` falls back to it, so a box
 * mid-migration renders correctly from either shape. The legacy branch goes
 * away once no box carries the nested form.
 *
 * Either shape yields the same pair: a text glyph, or an image as the
 * box-relative path the frontend hands to `/api/files`. A src that escapes the
 * box resolves to no symbol at all — a visible absence beats emitting a path
 * outside the box.
 */
export function readLandmarkSymbol(
  fields: { symbol?: CardSymbolData | undefined; navigation?: LandmarkNavigationData | undefined } | undefined,
  { landmarkPath }: { landmarkPath: string },
): CardSymbolData | null {
  const own = fields?.symbol;
  if (own !== undefined) return readCardSymbol(own, { cardPath: landmarkPath });
  // Legacy: a landmark that has not been through the `landmark-symbol`
  // migration still carries its mark nested in the navigation role, as the
  // `string | { src }` union that predates the universal field. Remove this
  // branch when every box has migrated — see the deferred cleanup issue.
  const legacy = fields?.navigation?.symbol;
  if (legacy === undefined) return null;
  const group = typeof legacy === "string" ? { glyph: legacy } : { src: legacy.src };
  return readCardSymbol(group, { cardPath: landmarkPath });
}
