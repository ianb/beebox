/**
 * Last-known user location, captured (with explicit consent) from the web
 * frontend's Geolocation API and read on demand by `cb location get`.
 *
 * Stored in the gitignored `.callback-box/location.json` — coordinates are
 * sensitive PII and box git history is permanent, so a fix never lands in a
 * committed card. One fix per box (the boxholder's); web-only. The on-disk
 * shape is validated on load: a hand-edited or corrupt file degrades to
 * `null` (reported as "unknown") rather than crashing a read or an agent turn.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { errnoCode } from "../lib/error-guards.js";

const storedLocationSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().nonnegative(),
  // ISO 8601 timestamp; an unparseable value here would otherwise feed NaN
  // into the age computation and render nonsense like "NaN weeks ago".
  capturedAt: z.string().datetime(),
  source: z.literal("web"),
});

export type StoredLocation = z.infer<typeof storedLocationSchema>;

export function locationStatePath(boxRoot: string): string {
  return path.join(boxRoot, ".callback-box", "location.json");
}

/**
 * Read the last-known fix, or `null` when none is stored or the file is
 * unreadable/corrupt/invalid. Never throws; logs (not silently) on anything
 * other than the normal absent-file case.
 */
export async function loadLocation(boxRoot: string): Promise<StoredLocation | null> {
  let raw: string;
  try {
    raw = await fs.readFile(locationStatePath(boxRoot), "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    console.warn(`[location-store] Could not read location.json: ${e instanceof Error ? e.message : e}`);
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.warn(`[location-store] Malformed location.json (not JSON): ${e instanceof Error ? e.message : e}`);
    return null;
  }
  const result = storedLocationSchema.safeParse(parsed);
  if (!result.success) {
    console.warn(`[location-store] Invalid location.json shape: ${result.error.issues.map((i) => i.message).join("; ")}`);
    return null;
  }
  return result.data;
}

/** Overwrite the last-known fix (last-write-wins; no lock needed for a single value). */
export async function saveLocation(boxRoot: string, location: StoredLocation): Promise<void> {
  const filePath = locationStatePath(boxRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(location, null, 2) + "\n");
}
