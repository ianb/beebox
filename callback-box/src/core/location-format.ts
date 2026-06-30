/**
 * Presentation for a stored location: age + staleness, and the one-line
 * human form `cb location get` prints. Pure given a `now`, so it's directly
 * doctestable without touching the filesystem.
 */

import { describeElapsed } from "./session-context.js";
import type { StoredLocation } from "./location-store.js";

/** A fix older than this is flagged `[stale]` (still reported — the caller judges). */
export const LOCATION_STALE_MS = 60 * 60 * 1000;

export interface LocationAge {
  ageMs: number;
  stale: boolean;
}

export function locationAge(location: StoredLocation, now: Date): LocationAge {
  // Clamp at 0: a future capturedAt (clock skew) reads as "moments ago", not negative.
  const ageMs = Math.max(0, now.getTime() - new Date(location.capturedAt).getTime());
  return { ageMs, stale: ageMs > LOCATION_STALE_MS };
}

/**
 * e.g. `45.5231,-122.6765 (±20m, captured 4 minutes ago, web) [stale]`, or with
 * a matched place name prepended: `Home — 45.5231,-122.6765 (…)`.
 */
export function formatLocationLine(location: StoredLocation, { now, place }: { now: Date; place?: string }): string {
  const { ageMs, stale } = locationAge(location, now);
  const coords = `${location.lat},${location.lng}`;
  const meta = `±${Math.round(location.accuracy)}m, captured ${describeElapsed(ageMs)} ago, ${location.source}`;
  const prefix = place !== undefined ? `${place} — ` : "";
  return `${prefix}${coords} (${meta})${stale ? " [stale]" : ""}`;
}
