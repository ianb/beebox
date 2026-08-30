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

import { parseRef, resolveRefPath } from "../../shared/ref-path.js";
import type { LandmarkNavigationData } from "../../schemas/landmark.js";

/**
 * A string `symbol` is a text glyph; a `{ src }` symbol is an image, returned
 * as the box-relative path the frontend hands to `/api/files`. A src that
 * escapes the box resolves to no symbol at all — a visible absence beats
 * emitting a path outside the box.
 */
export function readLandmarkSymbol(
  navigation: LandmarkNavigationData | undefined,
  { landmarkPath }: { landmarkPath: string },
): { text: string; src: string | null } {
  const symbol = navigation?.symbol;
  if (symbol === undefined) return { text: "", src: null };
  if (typeof symbol === "string") return { text: symbol.trim(), src: null };
  const resolved = resolveRefPath({
    fromPath: landmarkPath,
    ref: parseRef(symbol.src).path,
    kind: "card",
  });
  if (resolved === null) {
    console.warn(`landmarks: symbol src "${symbol.src}" in ${landmarkPath} escapes the box`);
    return { text: "", src: null };
  }
  return { text: "", src: resolved };
}
