/**
 * "Which folder mount does this directory hold?" — the one question `bbx drive
 * mount`, `bbx drive unmount`, and the legacy config conversion all ask.
 *
 * A `.gfolder.card` mount is defined by where it sits, so the lookup is a
 * direct-children read of one directory, never a box-wide glob: a card in a
 * *sub*directory is that subdirectory's mount, not this one's.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../lib/error-guards.js";
import { driveIdFromCardContent, GFOLDER_CARD_TYPE } from "./google-drive-tracking.js";

export interface GfolderCardInDir {
  /** Absolute path of the card. */
  cardPath: string;
  /** The folder it mounts, or null when the card carries no readable id. */
  driveId: string | null;
}

/** The `.gfolder.card`s directly inside `dir`, sorted by filename. */
export async function gfolderCardsIn(dir: string): Promise<GfolderCardInDir[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (e) {
    // A directory that does not exist holds no mount — that is the ordinary
    // state before `bbx drive mount` creates one. Anything else is a real
    // filesystem problem the caller should see.
    if (errnoCode(e) === "ENOENT") return [];
    throw e;
  }

  const found: GfolderCardInDir[] = [];
  for (const name of names.toSorted()) {
    if (!name.endsWith(`.${GFOLDER_CARD_TYPE}.card`)) continue;
    const cardPath = path.join(dir, name);
    const content = await fs.readFile(cardPath, "utf-8");
    found.push({ cardPath, driveId: driveIdFromCardContent(content) });
  }
  return found;
}
