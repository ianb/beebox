/**
 * The prime card of a place's intention, resolved (docs/plans/place-intention.md,
 * Track A).
 *
 * `intention.ref` is agent- or hand-written, so the payload never sends it
 * raw: it is resolved through the one ref parser (`resolveContainedRef`), kept
 * inside the box across symlinks, and must name an existing `*.card` file.
 * Anything else (a missing card, a directory, a non-card file, an escaping
 * path) resolves to null, and arrival falls back to the place's usual target.
 * `resolveRefExists` alone is not enough here: it answers true for any
 * existing path, a directory included.
 */

import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { realpathContained } from "../../lib/box-containment.js";
import { resolveContainedRef } from "../ref-exists.js";
import { errnoCode } from "../../shared/error-guards.js";
import type { LandmarkIntentionData } from "../../schemas/landmark.js";

/** The payload form of an intention: trimmed text, and the prime card as a box-relative path or null. */
export interface ResolvedIntention {
  text: string;
  ref: string | null;
}

/**
 * The box-relative path of the prime card, or null when `ref` does not name an
 * existing card inside the box. `landmarkPath` is box-relative; a ref written
 * relative to the landmark's directory resolves from it.
 */
export async function resolvePrimeCard({ boxRoot, landmarkPath, ref }: { boxRoot: string; landmarkPath: string; ref: string }): Promise<string | null> {
  const contained = resolveContainedRef({ boxRoot, fromPath: resolve(boxRoot, landmarkPath), ref });
  // The extension test is on the resolved path, after the ref's fragment and
  // query are stripped: `Draft.doc.card#ending` is a card, `readme.md#x.card` is not.
  if (contained === null || !contained.endsWith(".card")) return null;
  const safe = await realpathContained(boxRoot, contained);
  if (safe === null) return null;
  try {
    const info = await stat(resolve(boxRoot, safe));
    return info.isFile() ? contained : null;
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`intention: could not stat prime card "${ref}" of ${landmarkPath}: ${String(e)}`);
    }
    return null;
  }
}

/** The payload form of a landmark's `intention`, or null when it has none. */
export async function resolveIntention(
  intention: LandmarkIntentionData | undefined,
  { boxRoot, landmarkPath }: { boxRoot: string; landmarkPath: string },
): Promise<ResolvedIntention | null> {
  if (intention === undefined) return null;
  const ref = intention.ref === undefined ? null : await resolvePrimeCard({ boxRoot, landmarkPath, ref: intention.ref });
  return { text: intention.text.trim(), ref };
}
