/**
 * Load the box's place cards as match circles for location resolution.
 *
 * Globs every `*.place.card` (with the standard box ignores) and loads each
 * through `parseCardText`, so the place schema's constraints (coordinate ranges,
 * status enum) apply — a card with a typo'd `lat: 999` or bad status is skipped,
 * not matched. Returns the active ones carrying a full coordinate; a
 * coordless/half-set draft, an archived/inactive place, or a single
 * invalid/unparseable card is logged and skipped so it can't break a read.
 */

import * as path from "node:path";
import { readFile } from "node:fs/promises";
import { glob } from "glob";
import { parseCardText } from "./card-io.js";
import { createCardSchemaMap } from "../schemas/registry.js";
import { DEFAULT_PLACE_RADIUS_M, type PlaceCircle } from "./geo.js";

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function loadPlaces(boxRoot: string): Promise<PlaceCircle[]> {
  const matches = await glob("**/*.place.card", {
    cwd: boxRoot,
    nodir: true,
    ignore: ["node_modules/**", ".git/**", "_tmp/**", ".beebox/**"],
  });

  const schemas = await createCardSchemaMap();
  const places: PlaceCircle[] = [];
  for (const rel of matches) {
    try {
      const text = await readFile(path.join(boxRoot, rel), "utf-8");
      const { fields } = parseCardText(text, { source: rel, schemas });

      const status = typeof fields["status"] === "string" ? fields["status"] : "active";
      if (status === "archived" || status === "inactive") continue;

      const lat = num(fields["lat"]);
      const lng = num(fields["lng"]);
      if (lat === null || lng === null) continue; // require BOTH coords; half-set is skipped

      const name = typeof fields["name"] === "string"
        ? fields["name"]
        : path.basename(rel).replace(/\.place\.card$/, "");
      const radius = num(fields["radius"]) ?? DEFAULT_PLACE_RADIUS_M;
      places.push({ name, lat, lng, radius });
    } catch (e) {
      console.warn(`[place-cards] skipping ${rel}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return places;
}
