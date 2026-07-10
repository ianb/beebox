/**
 * List the landmark destinations of a given kind across a box.
 *
 * A destination is a landmark whose `destinations` advertise the requested
 * kind (see `destination.ts`). Used by the clerk commentary endpoint to
 * offer filing spots, and available to any caller that needs "where can
 * <kind> go?".
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { glob } from "glob";
import { parseLandmarkFields, type LandmarkSymbolData } from "../../schemas/landmark.js";
import { findDestination, type DestinationKind } from "./destination.js";
import { errorMessage } from "../../lib/error-guards.js";

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

export async function listDestinations(
  boxRoot: string,
  kind: DestinationKind,
): Promise<DestinationInfo[]> {
  const matches = await glob("**/*.landmark.card", {
    cwd: boxRoot,
    nodir: true,
    ignore: ["node_modules/**", ".git/**", "tmp/**", ".callback-box/**"],
  });

  const out: DestinationInfo[] = [];
  for (const relPath of matches) {
    const absPath = path.join(boxRoot, relPath);
    let fields;
    try {
      const content = await fs.readFile(absPath, "utf-8");
      fields = parseLandmarkFields(content);
    } catch (e) {
      console.warn(`list-destinations: failed to parse ${absPath}: ${errorMessage(e)}`);
      continue;
    }
    if (fields === null) continue;
    if (findDestination(fields.destinations, kind) === null) continue;

    const dir = path.dirname(relPath);
    const normalizedDir = dir === "." ? "" : dir;
    const label = fields.navigation?.label ?? (normalizedDir === "" ? "root" : path.basename(normalizedDir));
    out.push({ dir: normalizedDir, label, symbol: symbolText(fields.navigation?.symbol) });
  }

  out.sort((a, b) => {
    if (a.dir === "" && b.dir !== "") return -1;
    if (b.dir === "" && a.dir !== "") return 1;
    return a.dir.localeCompare(b.dir);
  });
  return out;
}
