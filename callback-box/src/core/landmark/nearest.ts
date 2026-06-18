/**
 * Resolve the nearest enclosing landmark directory for a card path — the
 * directory whose chat a "start chat about this card" action should bind to.
 *
 * "Nearest" = the deepest landmark directory that is an ancestor-or-self of the
 * card's directory. With no enclosing landmark the result is `""` (the box
 * root), which the chat layer treats as the root/general chat. The walk clamps
 * at the box root — box-relative paths can't escape upward.
 *
 * Landmark *directories* are keyed on the `*.landmark.card` filename alone (a
 * glob, no parse): a hand-created landmark with a malformed body still anchors
 * its directory. Validity matters when *resolving a landmark's links*
 * (see resolve.ts); it does not gate which directory counts as a landmark.
 */

import * as path from "node:path";
import { glob } from "glob";

/**
 * Whether a card path is safe to treat as box-relative — no leading `/` and no
 * `..` segment. The "chat about this card" flow writes this value into the
 * chat `?card=` param, which `card.get` joins onto the box root; rejecting
 * traversal here keeps a crafted path from escaping the box (card.get also
 * guards independently, defense in depth).
 */
export function isBoxRelativeCardPath(cardPath: string): boolean {
  return !cardPath.startsWith("/") && !cardPath.split("/").includes("..");
}

/** Box-relative dir of a path, normalized so a box-root file yields `""`. */
function dirOf(boxRelPath: string): string {
  const dir = path.posix.dirname(boxRelPath);
  return dir === "." || dir === "/" ? "" : dir;
}

/**
 * Pure core: given the card's path and the set of landmark directories
 * (box-relative, `""` for a root landmark), return the deepest that encloses
 * the card, or `""` when none does. Exported for direct unit testing without
 * touching the filesystem.
 */
export function nearestDirFromDirs(cardPath: string, landmarkDirs: string[]): string {
  const cardDir = dirOf(cardPath);
  let best = "";
  for (const dir of landmarkDirs) {
    const encloses = dir === "" || cardDir === dir || cardDir.startsWith(`${dir}/`);
    if (encloses && dir.length >= best.length) best = dir;
  }
  return best;
}

/**
 * Glob the box for landmark directories and resolve the nearest one enclosing
 * `cardPath`. Same ignore list as the picker's landmark glob (chat.ts).
 */
export async function nearestLandmarkDir(
  boxRoot: string,
  { cardPath }: { cardPath: string },
): Promise<string> {
  const matches = await glob("**/*.landmark.card", {
    cwd: boxRoot,
    nodir: true,
    ignore: ["node_modules/**", ".git/**", "tmp/**", ".callback-box/**"],
  });
  const dirs = matches.map(dirOf);
  return nearestDirFromDirs(cardPath, dirs);
}
