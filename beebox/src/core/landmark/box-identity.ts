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
 * `bbx init` guarantees one exists and repairs an inert one (`core/box/
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

/**
 * Which file is the root landmark, remembered per box root.
 *
 * This is on the path of every document request, and finding the card means
 * listing the box root -- a directory that holds thousands of entries on a
 * real box. The listing is memoized against the root directory's own mtime,
 * which changes when an entry is added or removed, so the steady state is one
 * `stat` and a discovery costs a `readdir` only after the root's contents
 * change. Editing the card itself does not touch the directory's mtime, and
 * does not need to: `readLandmarkCard` keys its parse on the file's identity.
 */
const discovered = new Map<string, { dirMtimeNs: bigint; cardName: string | null }>();

/**
 * The label every root landmark used to be scaffolded with, before the
 * scaffold learned to name the box (`core/box/defaults.ts`).
 *
 * Boxes created before that carry it, and it is not a name -- it is the word
 * "Box" on every box in the fleet, which in a tab strip is worse than the slug
 * it replaced. So it reads as "unset" and the slug wins. A box that renames
 * itself takes effect immediately; a box that genuinely wants to be called
 * "Box" is the one case this gets wrong, and it gets the slug instead.
 *
 * Delete this when no box in the field still carries the stock label.
 */
const STOCK_LABEL = "Box";

/** A box's display identity: what to call it, and what mark to show for it. */
export interface BoxIdentity {
  /** The box this identity belongs to — every consumer needs it to build a
   *  box-scoped URL, and carrying it here keeps them from re-threading it. */
  slug: string;
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
  const bare: BoxIdentity = { slug, name: slug, symbol: "", symbolSrc: null };

  let cardName: string | null;
  try {
    cardName = await rootLandmarkName(boxRoot);
  } catch (e) {
    console.warn(`box identity: could not read box root ${boxRoot}:`, e);
    return bare;
  }
  if (cardName === null) return bare;

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
    slug,
    name: label !== undefined && label !== "" && label !== STOCK_LABEL ? label : slug,
    symbol: symbol.text,
    symbolSrc: symbol.src,
  };
}

/**
 * The root landmark's filename, from the memo when the box root is unchanged.
 *
 * One landmark per directory by convention; sorted so a box that somehow holds
 * two picks the same one every time rather than alternating with `readdir`
 * order -- a box must not change its name between requests.
 * `landmarks.forDir` resolves the root the same way.
 */
async function rootLandmarkName(boxRoot: string): Promise<string | null> {
  const stat = await fs.stat(boxRoot, { bigint: true });
  const seen = discovered.get(boxRoot);
  if (seen !== undefined && seen.dirMtimeNs === stat.mtimeNs) return seen.cardName;

  const entries = await fs.readdir(boxRoot);
  const cardName = entries.filter((n) => n.endsWith(".landmark.card")).toSorted()[0] ?? null;
  discovered.set(boxRoot, { dirMtimeNs: stat.mtimeNs, cardName });
  return cardName;
}
