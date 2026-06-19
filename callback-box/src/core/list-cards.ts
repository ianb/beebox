/**
 * List the `.card` files in a box.
 *
 * Replaces the cardworks `CardLoader.listCards()` — a plain glob for `*.card`
 * files, returning absolute paths, skipping the usual non-content directories.
 */

import { glob } from "glob";

const CARD_GLOB_IGNORE = ["node_modules/**", ".git/**", "tmp/**", ".callback-box/**"];

export async function listBoxCardFiles(boxRoot: string): Promise<string[]> {
  return glob("**/*.card", {
    cwd: boxRoot,
    nodir: true,
    absolute: true,
    ignore: CARD_GLOB_IGNORE,
  });
}
