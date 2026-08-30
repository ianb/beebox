/**
 * Geographic distance + named-place matching for location resolution.
 *
 * Pure math, no I/O. `haversineMeters` is the great-circle distance between two
 * lat/lng points; `matchPlace` answers "which named place is this fix in?" —
 * the nearest place whose center is within its radius, or none. Matching is
 * strict (distance <= radius): a low-confidence GPS fix with large accuracy
 * does NOT inflate the radius, so an uncertain fix can't falsely claim "at Home".
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface PlaceCircle {
  name: string;
  lat: number;
  lng: number;
  radius: number;
}

const EARTH_RADIUS_M = 6_371_000;

/** Radius used for matching when a place card omits `radius` (hand-edited). */
export const DEFAULT_PLACE_RADIUS_M = 100;
/** Floor for a radius written by `bbx location mark` — a GPS fix is never a point. */
export const MIN_PLACE_RADIUS_M = 50;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance between two points, in meters. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The nearest place whose center is within its radius of `fix`, or null when
 * the fix is outside every place. Nearest center wins on overlap (deterministic).
 */
export function matchPlace(fix: LatLng, places: PlaceCircle[]): PlaceCircle | null {
  let best: PlaceCircle | null = null;
  let bestDistance = Infinity;
  for (const place of places) {
    const distance = haversineMeters(fix, place);
    if (distance <= place.radius && distance < bestDistance) {
      best = place;
      bestDistance = distance;
    }
  }
  return best;
}
