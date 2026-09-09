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
 *
 * The root landmark's card lives at `_content/Box.landmark.card` (the
 * one-root layout's content area), not at the physical box root — see
 * `root-dir.ts`.
 */

import * as fs from "node:fs/promises";
import { readLandmarkCard } from "./card-cache.js";
import { readLandmarkSymbol } from "./symbol.js";
import { LANDMARK_CONTENT_DIR, landmarkRelPath } from "./root-dir.js";
import type { CardSymbolData } from "../../shared/card-symbol.js";

/**
 * Which file is the root landmark, remembered per box root.
 *
 * This is on the path of every document request, and finding the card means
 * listing the box's content root -- a directory that holds thousands of
 * entries on a real box. The listing is memoized against that directory's
 * own mtime, which changes when an entry is added or removed, so the steady
 * state is one `stat` and a discovery costs a `readdir` only after its
 * contents change. Editing the card itself does not touch the directory's
 * mtime, and does not need to: `readLandmarkCard` keys its parse on the
 * file's identity.
 */
const discovered = new Map<string, { dirMtimeNs: bigint; cardRelPath: string | null }>();

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
  /** The box's mark, `src` resolved to a box-relative path; null when it has none. */
  symbol: CardSymbolData | null;

}

/**
 * Read the box's identity from the landmark card at its root.
 *
 * Every failure — an unreadable content root, no landmark card, a card that
 * doesn't parse — degrades to the slug with no symbol. A box that cannot say
 * its own name is still a box you must be able to open, so this never throws.
 */
export async function readBoxIdentity({
  boxRoot,
  slug,
}: {
  boxRoot: string;
  slug: string;
}): Promise<BoxIdentity> {
  const bare: BoxIdentity = { slug, name: slug, symbol: null };

  // Box-relative (e.g. `_content/Box.landmark.card`), not a bare filename —
  // `readLandmarkSymbol` resolves document-relative `symbol.src` refs
  // against it, so it needs the card's real position under the box root.
  let cardRelPath: string | null;
  try {
    cardRelPath = await rootLandmarkRelPath(boxRoot);
  } catch (e) {
    console.warn(`box identity: could not read box content root ${boxRoot}/${LANDMARK_CONTENT_DIR}:`, e);
    return bare;
  }
  if (cardRelPath === null) return bare;

  let fields;
  try {
    fields = await readLandmarkCard(`${boxRoot}/${cardRelPath}`);
  } catch (e) {
    console.warn(`box identity: could not read ${cardRelPath} in ${boxRoot}:`, e);
    return bare;
  }
  if (fields === null) return bare;

  const label = fields.navigation?.label?.trim();
  const symbol = readLandmarkSymbol(fields, { landmarkPath: cardRelPath });
  return {
    slug,
    name: label !== undefined && label !== "" && label !== STOCK_LABEL ? label : slug,
    symbol,
  };
}

/**
 * The root landmark's box-relative path, from the memo when the box's
 * content root is unchanged.
 *
 * One landmark per directory by convention; sorted so a box that somehow holds
 * two picks the same one every time rather than alternating with `readdir`
 * order -- a box must not change its name between requests.
 * `landmarks.forDir` resolves the root the same way.
 */
async function rootLandmarkRelPath(boxRoot: string): Promise<string | null> {
  const contentDir = `${boxRoot}/${LANDMARK_CONTENT_DIR}`;
  const stat = await fs.stat(contentDir, { bigint: true });
  const seen = discovered.get(boxRoot);
  if (seen !== undefined && seen.dirMtimeNs === stat.mtimeNs) return seen.cardRelPath;

  const entries = await fs.readdir(contentDir);
  const cardName = entries.filter((n) => n.endsWith(".landmark.card")).toSorted()[0] ?? null;
  const cardRelPath = cardName === null ? null : landmarkRelPath("", cardName);
  discovered.set(boxRoot, { dirMtimeNs: stat.mtimeNs, cardRelPath });
  return cardRelPath;
}
