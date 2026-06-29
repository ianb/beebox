/**
 * `cb location mark <card-path>` — stamp the current device fix's coordinates
 * into an existing place card.
 *
 * The mutation is parse-mutate-reserialize on the *raw* YAML frontmatter (not
 * the schema serializer, which would strip unknown/drifted keys): split the
 * card, parse the frontmatter to a mapping, set lat/lng/radius, and recombine
 * with the original body and any other keys verbatim.
 *
 * Radius policy is conservative so one stale/out-of-place mark can't balloon a
 * place: a coordless card gets center = fix + a default radius; an existing
 * place only grows when the fix is outside its radius AND `--expand` is given.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { splitCardContent } from "../cards/index.js";
import { toRelativePath } from "../cli/lib/paths.js";
import { loadLocation, type StoredLocation } from "./location-store.js";
import { locationAge } from "./location-format.js";
import { describeElapsed } from "./session-context.js";
import { haversineMeters, DEFAULT_PLACE_RADIUS_M, MIN_PLACE_RADIUS_M } from "./geo.js";

/** Why a mark didn't (or did) change the card — drives the CLI message. */
export type MarkOutcome = "set" | "expanded" | "inside" | "outside";

export interface AppliedMark {
  /** New card text, or null when nothing changed (inside, or outside without --expand). */
  text: string | null;
  outcome: MarkOutcome;
  name: string;
  lat: number;
  lng: number;
  radius: number;
  /** Distance from the existing center to the fix, in meters (for inside/outside/expanded). */
  distance: number | null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Compute the mutated card text (or no-op) for a fix against a place card's
 * current frontmatter. Pure: no filesystem, no clock.
 */
export function applyMark(
  cardText: string,
  { fix, expand }: { fix: { lat: number; lng: number; accuracy: number }; expand: boolean },
): AppliedMark {
  const split = splitCardContent(cardText);
  const parsed: unknown = split.frontmatterText === "" ? {} : parseYaml(split.frontmatterText);
  const frontmatter: Record<string, unknown> =
    parsed !== null && typeof parsed === "object" ? { ...(parsed as Record<string, unknown>) } : {};

  const name = typeof frontmatter["name"] === "string" ? frontmatter["name"] : "(unnamed place)";
  const existingLat = asNumber(frontmatter["lat"]);
  const existingLng = asNumber(frontmatter["lng"]);
  const existingRadius = asNumber(frontmatter["radius"]);
  const hasCoords = existingLat !== null && existingLng !== null;

  const reserialize = (): string => `---\n${stringifyYaml(frontmatter)}---\n${split.body}`;

  if (!hasCoords) {
    const radius = Math.max(Math.round(fix.accuracy), MIN_PLACE_RADIUS_M);
    frontmatter["lat"] = fix.lat;
    frontmatter["lng"] = fix.lng;
    frontmatter["radius"] = radius;
    return { text: reserialize(), outcome: "set", name, lat: fix.lat, lng: fix.lng, radius, distance: null };
  }

  const center = { lat: existingLat, lng: existingLng };
  const radius = existingRadius ?? DEFAULT_PLACE_RADIUS_M;
  const distance = haversineMeters(center, fix);

  if (distance <= radius) {
    return { text: null, outcome: "inside", name, lat: existingLat, lng: existingLng, radius, distance };
  }

  if (!expand) {
    return { text: null, outcome: "outside", name, lat: existingLat, lng: existingLng, radius, distance };
  }

  const grown = Math.round(distance);
  frontmatter["radius"] = grown;
  return { text: reserialize(), outcome: "expanded", name, lat: existingLat, lng: existingLng, radius: grown, distance };
}

export type MarkResult = { ok: false; error: string } | { ok: true; message: string; changed: boolean };

function fmtCoords(lat: number, lng: number): string {
  return `${lat},${lng}`;
}

/**
 * Resolve + validate the card path, read the current fix, apply the mark, and
 * write the card. Returns a result the CLI prints; never throws on the expected
 * error paths (missing card, no fix, outside box).
 */
export async function markPlace(opts: {
  boxRoot: string;
  cardPath: string;
  expand: boolean;
  now: Date;
}): Promise<MarkResult> {
  const { boxRoot, cardPath, expand, now } = opts;
  const abs = path.isAbsolute(cardPath) ? cardPath : path.resolve(boxRoot, cardPath);

  if (!abs.endsWith(".place.card")) {
    return { ok: false, error: `Not a place card: ${cardPath} (expected a *.place.card path)` };
  }
  if (toRelativePath(boxRoot, abs) === null) {
    return { ok: false, error: `Refusing to mark a card outside the box: ${cardPath}` };
  }

  let cardText: string;
  try {
    cardText = await fs.readFile(abs, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, error: `No such place card: ${cardPath}. Author it first, then mark it.` };
    }
    throw e;
  }

  const fix: StoredLocation | null = await loadLocation(boxRoot);
  if (!fix) {
    return { ok: false, error: "No current location — share location from the web UI first." };
  }

  const applied = applyMark(cardText, { fix, expand });
  if (applied.text !== null) {
    await fs.writeFile(abs, applied.text);
  }

  const { ageMs, stale } = locationAge(fix, now);
  const age = `from a fix captured ${describeElapsed(ageMs)} ago${stale ? " [stale]" : ""}`;
  const coords = fmtCoords(applied.lat, applied.lng);

  switch (applied.outcome) {
    case "set":
      return { ok: true, changed: true, message: `Marked ${applied.name} at ${coords} (radius ${applied.radius}m, ${age}).` };
    case "expanded":
      return { ok: true, changed: true, message: `Expanded ${applied.name} to radius ${applied.radius}m to include the fix ${Math.round(applied.distance ?? 0)}m away (${age}).` };
    case "inside":
      return { ok: true, changed: false, message: `${applied.name} already covers this fix (${Math.round(applied.distance ?? 0)}m from center, radius ${applied.radius}m; ${age}). No change.` };
    case "outside":
      return {
        ok: true,
        changed: false,
        message: `Fix is ${Math.round(applied.distance ?? 0)}m from ${applied.name}'s center, outside its ${applied.radius}m radius — not updated (${age}). Re-run with --expand to grow the radius to include it.`,
      };
  }
}
