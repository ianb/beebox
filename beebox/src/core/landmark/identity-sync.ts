/**
 * A box's display identity read synchronously, for the hub metadata file
 * (`core/hub-meta.ts`): the root landmark's label and symbol, the same two
 * facts `box-identity.ts` reads for the box's own pages, without its memos.
 * `hub-meta.ts` cannot import `box-identity.ts` (which calls back into it to
 * republish on a change), so the rule for the name lives here and both use it.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseLandmarkFields } from "../../schemas/landmark.js";
import type { CardSymbolData } from "../../shared/card-symbol.js";
import { errnoCode } from "../../shared/error-guards.js";
import { LANDMARK_CONTENT_DIR, landmarkRelPath } from "./root-dir.js";
import { readLandmarkSymbol } from "./symbol.js";

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
export const STOCK_LABEL = "Box";

/** The name a label gives a box, or null when the label is absent, blank or the stock one. */
export function nameFromLabel(label: string | undefined): string | null {
  const trimmed = label?.trim();
  return trimmed !== undefined && trimmed !== "" && trimmed !== STOCK_LABEL ? trimmed : null;
}

/** What a box says about itself; `name` null means "call it by its slug". */
export interface PublishedIdentity {
  name: string | null;
  symbol: CardSymbolData | null;
}

/**
 * The root landmark card's identity, or the bare identity when the content
 * root, the card, or its frontmatter is missing or unreadable. Sorted like
 * `rootLandmarkRelPath` so both readers pick the same card.
 */
export function readPublishedIdentity(boxRoot: string): PublishedIdentity {
  const bare: PublishedIdentity = { name: null, symbol: null };
  let entries: string[];
  try {
    entries = fs.readdirSync(path.join(boxRoot, LANDMARK_CONTENT_DIR));
  } catch (e) {
    if (errnoCode(e) === "ENOENT" || errnoCode(e) === "ENOTDIR") return bare;
    throw e;
  }
  const cardName = entries.filter((n) => n.endsWith(".landmark.card")).toSorted()[0];
  if (cardName === undefined) return bare;
  const cardRelPath = landmarkRelPath("", cardName);
  let content: string;
  try {
    content = fs.readFileSync(path.join(boxRoot, cardRelPath), "utf8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return bare;
    throw e;
  }
  const fields = parseLandmarkFields(content);
  if (fields === null) return bare;
  return { name: nameFromLabel(fields.navigation?.label), symbol: readLandmarkSymbol(fields, { landmarkPath: cardRelPath }) };
}
