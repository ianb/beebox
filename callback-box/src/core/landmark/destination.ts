/**
 * Destination roles on landmark cards.
 *
 * A landmark advertises that its directory is a *destination* — a named spot
 * the system files things into — via a `destinations` entry whose `for` list
 * names the kinds it accepts:
 *
 *   destinations:
 *     - for: [triage]                triage-routing target
 *     - for: [commentary]            commentary filing spot
 *     - for: [triage, commentary]    both
 *     - for: [share]                 native share-sheet save target
 *
 * Pure data inspection — no Node deps — so it's safe to import from both
 * core (triage) and the webapp (clerk routes).
 */

import type { LandmarkDestinationData } from "../../schemas/landmark.js";

/** Destination kinds the system understands. `for` may list any subset. */
export const DESTINATION_KINDS = ["triage", "commentary", "share"] as const;
export type DestinationKind = (typeof DESTINATION_KINDS)[number];

/**
 * Find the destination advertising `kind` among a landmark's `destinations`,
 * or `null`.
 */
export function findDestination(
  destinations: LandmarkDestinationData[] | undefined,
  kind: DestinationKind,
): LandmarkDestinationData | null {
  if (destinations === undefined) return null;
  for (const dest of destinations) {
    if (dest.for.includes(kind)) return dest;
  }
  return null;
}
