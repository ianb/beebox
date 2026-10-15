/**
 * The incoming folder: pages sent from the Clerk wait in `_content/incoming/`
 * until the chat that quick chat chose files them (docs/implemented-plans/clerk-quick-send.md).
 * The folder ignores itself with its own `.gitignore`, so a card enters git
 * only when it is filed; the box-wide `.gitignore` is not changed.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { BOX_DIRS } from "../lib/paths/core.js";
import { parseFrontmatterObject } from "../exports/cards.js";
import { errnoCode } from "../shared/error-guards.js";
import { listBoxCardFiles } from "./list-cards.js";

export const INCOMING_DIR = BOX_DIRS.incoming;
const WEBPAGE_SUFFIX = ".webpage.card";

/** Create the folder and its `*` ignore file when either is missing. */
export async function ensureIncomingDir(boxRoot: string): Promise<void> {
  const dir = path.join(boxRoot, INCOMING_DIR);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.writeFile(path.join(dir, ".gitignore"), "# Pages sent to the box wait here until a chat files them.\n*\n", { flag: "wx" });
  } catch (error) {
    if (errnoCode(error) !== "EEXIST") throw error;
  }
}

/** The incoming card name for a send: the id keeps two sends with one title apart. */
export function incomingCardName(safeTitle: string, id: string): string {
  return `${safeTitle}-${id}${WEBPAGE_SUFFIX}`;
}

async function captureIdAt(boxRoot: string, rel: string): Promise<unknown> {
  try {
    return parseFrontmatterObject(await fs.readFile(path.join(boxRoot, rel), "utf8"))?.["capture-id"];
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Where the card of send `id` is now. Someone may have filed it before the
 * send was delivered, so a missing `sourceRef` is looked up by `capture-id`:
 * first among cards whose name still ends with the id, then among every
 * webpage card, since a move can rename. Null when the card is gone.
 */
export async function locateSentCard(boxRoot: string, { id, sourceRef }: { id: string; sourceRef: string }): Promise<string | null> {
  if (await captureIdAt(boxRoot, sourceRef) === id) return sourceRef;
  const webpages = (await listBoxCardFiles(boxRoot)).filter((abs) => abs.endsWith(WEBPAGE_SUFFIX))
    .map((abs) => path.relative(boxRoot, abs).split(path.sep).join("/"));
  const named = webpages.filter((rel) => rel.endsWith(`-${id}${WEBPAGE_SUFFIX}`));
  const others = webpages.filter((candidate) => !named.includes(candidate));
  for (const rel of [...named, ...others]) {
    if (await captureIdAt(boxRoot, rel) === id) return rel;
  }
  return null;
}
