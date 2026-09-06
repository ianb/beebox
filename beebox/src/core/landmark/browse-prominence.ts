/**
 * Per-listing prominence helpers for `status.browse` (`docs/plans/card-prominence.md`,
 * Track C): a card's effective level, a subdirectory's `DirectorySummary`
 * rollup and own landmark identity. Split out of `status.ts` to stay under
 * its line budget (`beebox/CLAUDE.md`'s "split out to keep browse's
 * complexity under the lint budget" precedent, already used there for the
 * display-form guard).
 */

import * as path from "node:path";
import type { CardSchema } from "../../cards/schema.js";
import { effectiveLevel, Prominence, type EffectiveLevel } from "../../shared/prominence.js";
import type { CardSymbolData } from "../../shared/card-symbol.js";
import {
  prunedSubtreeWith,
  findLandmarkCardName,
  type DirectorySummary,
  type ProminenceWalkContext,
} from "./prominence-index.js";
import { readLandmarkFieldsCached } from "./prominence-cache.js";
import { readLandmarkSymbol } from "./symbol.js";
import { landmarkScanDir, normalizeLandmarkDir } from "./root-dir.js";

/** A card's effective level: its own declared `prominence` (if it parses), else its type's default. */
export function cardEffectiveProminence(
  frontmatter: Record<string, unknown> | null,
  { type, cardSchemas }: { type: string; cardSchemas: Map<string, CardSchema> },
): EffectiveLevel {
  const schema = cardSchemas.get(type);
  const typeDefault: EffectiveLevel = schema?.defaultProminence ?? "ordinary";
  const raw = frontmatter?.["prominence"];
  const parsed = Prominence.safeParse(raw);
  return effectiveLevel({ declared: parsed.success ? parsed.data : undefined, typeDefault });
}

/**
 * `dir`'s (box-relative, `""` = root) pruned-subtree `DirectorySummary` —
 * whether it has an entry point or a primary anywhere under it, and
 * whether it (or a cascaded ancestor) is background. Used both for a
 * listed SUBdirectory's own summary and, reading just `.background`, for
 * whether the LISTED directory itself is background.
 */
export async function directorySummary(walk: ProminenceWalkContext, dir: string): Promise<DirectorySummary> {
  return (await prunedSubtreeWith(walk, normalizeLandmarkDir(dir))).summary;
}

export interface BrowseDirLandmark {
  label: string;
  symbol: CardSymbolData | null;
}

/** `dir`'s OWN landmark identity (label/symbol), when it holds a landmark card directly — undefined otherwise. */
export async function subdirLandmarkIdentity(boxRoot: string, dir: string): Promise<BrowseDirLandmark | undefined> {
  const physical = landmarkScanDir(boxRoot, normalizeLandmarkDir(dir));
  const cardName = await findLandmarkCardName(physical);
  if (cardName === null) return undefined;
  const fields = await readLandmarkFieldsCached(path.join(physical, cardName));
  if (fields === null) return undefined;
  const label = (fields.navigation?.label ?? "") || path.basename(cardName, ".landmark.card");
  const symbol = readLandmarkSymbol(fields, { landmarkPath: `${dir}/${cardName}` });
  return { label, symbol };
}
