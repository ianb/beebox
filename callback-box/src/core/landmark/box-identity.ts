/**
 * A box's own name and mark, read from the landmark card at its root.
 *
 * A box had no display identity: every `/api/boxes` listing answered
 * `name: <slug>`, so the UI showed a slug everywhere a name belonged — in the
 * box switcher, the dashboard header, and (once tab titles arrived) the
 * browser tab. Meanwhile the box root already had a landmark card carrying
 * exactly the two things needed, written the way every other box fact is
 * written — by an agent editing a card:
 *
 *   ---
 *   navigation:
 *     label: Kitchen
 *     symbol: 🍳
 *   ---
 *
 * `cb init` guarantees one exists and repairs an inert one (`core/box/
 * defaults.ts`), so this is not a field that may or may not be there — it is
 * the same root landmark the Landmarks page and the app bar's place pill
 * already read. Nothing new is stored, and nothing but a card edit updates it.
 *
 * Parsing goes through `readLandmarkCard`'s mtime-keyed memo, so the common
 * case is one `stat` per call and a card edit is picked up on the next one.
 * That matters because this is on the path of every document request.
 */

import * as fs from "node:fs/promises";
import { readLandmarkCard } from "./card-cache.js";
import { readLandmarkSymbol } from "./symbol.js";

/** A box's display identity: what to call it, and what mark to show for it. */
export interface BoxIdentity {
  /** Display name — the root landmark's label, falling back to the slug. */
  name: string;
  /** Symbol text (emoji or short text); empty when the box uses an image. */
  symbol: string;
  /** Box-relative path to the symbol image, or null for a text symbol. */
  symbolSrc: string | null;
}

/**
 * Read the box's identity from the landmark card at its root.
 *
 * Every failure — an unreadable root, no landmark card, a card that doesn't
 * parse — degrades to the slug with no symbol. A box that cannot say its own
 * name is still a box you must be able to open, so this never throws.
 */
export async function readBoxIdentity({
  boxRoot,
  slug,
}: {
  boxRoot: string;
  slug: string;
}): Promise<BoxIdentity> {
  const bare: BoxIdentity = { name: slug, symbol: "", symbolSrc: null };

  let entries: string[];
  try {
    entries = await fs.readdir(boxRoot);
  } catch (e) {
    console.warn(`box identity: could not read box root ${boxRoot}:`, e);
    return bare;
  }

  // One landmark per directory by convention; sorted so a box that somehow has
  // two picks the same one every time rather than alternating with readdir
  // order. `landmarks.forDir` resolves the root the same way.
  const cardName = entries.filter((n) => n.endsWith(".landmark.card")).toSorted()[0];
  if (cardName === undefined) return bare;

  let fields;
  try {
    fields = await readLandmarkCard(`${boxRoot}/${cardName}`);
  } catch (e) {
    console.warn(`box identity: could not read ${cardName} in ${boxRoot}:`, e);
    return bare;
  }
  if (fields === null) return bare;

  const label = fields.navigation?.label?.trim();
  const symbol = readLandmarkSymbol(fields.navigation, { landmarkPath: cardName });
  return {
    name: label !== undefined && label !== "" ? label : slug,
    symbol: symbol.text,
    symbolSrc: symbol.src,
  };
}
