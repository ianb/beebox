/**
 * List the landmark destinations of a given kind across a box.
 *
 * A destination is a landmark whose `destinations` advertise the requested
 * kind (see `destination.ts`). Used by the clerk commentary endpoint to
 * offer filing spots, and available to any caller that needs "where can
 * <kind> go?".
 */

import * as path from "node:path";
import { glob } from "glob";
import { type LandmarkSymbolData } from "../../schemas/landmark.js";
import { readLandmarkCard } from "./card-cache.js";
import { findDestination, type DestinationKind } from "./destination.js";
import { errorMessage } from "../../lib/error-guards.js";
import { mapInBatchesSettled } from "../../lib/map-batched.js";

/** Landmark cards read at once — see {@link mapInBatchesSettled}. */
const READ_CONCURRENCY = 64;

export interface DestinationInfo {
  /** Box-relative directory containing the landmark (empty string = box root). */
  dir: string;
  /** Navigation label, falling back to the directory's last segment. */
  label: string;
  /** Symbol text (emoji/short text), or null if none / image-only. */
  symbol: string | null;
}

/** A symbol is displayable text only when it's a plain string (not an image). */
function symbolText(symbol: LandmarkSymbolData | undefined): string | null {
  if (typeof symbol === "string" && symbol.trim() !== "") return symbol.trim();
  return null;
}

/** One card's destination entry for `kind`, or null when it advertises none. */
async function readDestination(
  boxRoot: string,
  { relPath, kind }: { relPath: string; kind: DestinationKind },
): Promise<DestinationInfo | null> {
  const absPath = path.join(boxRoot, relPath);
  let fields;
  try {
    fields = await readLandmarkCard(absPath);
  } catch (e) {
    console.warn(`list-destinations: failed to parse ${absPath}: ${errorMessage(e)}`);
    return null;
  }
  if (fields === null) return null;
  if (findDestination(fields.destinations, kind) === null) return null;

  const dir = path.dirname(relPath);
  const normalizedDir = dir === "." ? "" : dir;
  const label = fields.navigation?.label ?? (normalizedDir === "" ? "root" : path.basename(normalizedDir));
  return { dir: normalizedDir, label, symbol: symbolText(fields.navigation?.symbol) };
}

export async function listDestinations(
  boxRoot: string,
  kind: DestinationKind,
): Promise<DestinationInfo[]> {
  const matches = await glob("**/*.landmark.card", {
    cwd: boxRoot,
    nodir: true,
    ignore: ["node_modules/**", ".git/**", "_tmp/**", ".beebox/**"],
  });

  // Independent files, read concurrently but in bounded batches — one handle
  // per landmark at once is an fd-exhaustion risk on a large box. `allSettled`
  // per code-style: one bad card must not abandon the rest of the destinations.
  const read = await mapInBatchesSettled(matches, {
    size: READ_CONCURRENCY,
    map: (relPath) => readDestination(boxRoot, { relPath, kind }),
  });
  const out: DestinationInfo[] = [];
  for (const [i, outcome] of read.entries()) {
    if (outcome.status === "rejected") {
      console.warn(`list-destinations: failed to read ${matches[i]}: ${errorMessage(outcome.reason)}`);
      continue;
    }
    if (outcome.value !== null) out.push(outcome.value);
  }

  out.sort((a, b) => {
    if (a.dir === "" && b.dir !== "") return -1;
    if (b.dir === "" && a.dir !== "") return 1;
    return a.dir.localeCompare(b.dir);
  });
  return out;
}
