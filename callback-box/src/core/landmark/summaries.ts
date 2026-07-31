/**
 * Tile-level landmark metadata — every landmark card's directory, label, and
 * symbol, without resolving links or `expand`.
 *
 * Backs the chat picker (`chat.byLandmark`) and the history dropdown's
 * landmark tags (`chat.sessions`). Lives in core/ rather than the router that
 * first needed it so both can read it without importing each other.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { glob } from "glob";
import { parseLandmarkFields, type LandmarkNavigationData } from "../../schemas/landmark.js";
import { errnoCode } from "../../lib/error-guards.js";

export interface LandmarkSummary {
  dir: string;
  label: string;
  symbol: string;
  symbolSrc: string | null;
}

/**
 * Pull the navigation `symbol`'s text and image src (if any). A string symbol
 * is text; a `{ src }` symbol is an image whose path is resolved from "relative
 * to the landmark directory" to "box-relative" so the frontend can request it.
 */
function readSymbol(
  navigation: LandmarkNavigationData | undefined,
  { landmarkDir, boxRoot }: { landmarkDir: string; boxRoot: string },
): { text: string; src: string | null } {
  const symbol = navigation === undefined ? undefined : navigation.symbol;
  if (symbol === undefined) return { text: "", src: null };
  if (typeof symbol === "string") return { text: symbol.trim(), src: null };
  const absolute = path.resolve(landmarkDir, symbol.src);
  return { text: "", src: path.relative(boxRoot, absolute) };
}

/**
 * Like `landmarks.list` but without resolving links/expand — just the
 * tile-level metadata the picker needs. Reads each card's YAML frontmatter
 * `navigation` (label + symbol); cards whose frontmatter doesn't parse as a
 * landmark are skipped.
 *
 * Exported for the chat-picker regression doctest: this read once used the XML
 * `parseCard`, which silently threw on every (now-frontmatter) landmark card
 * and left the picker landmark-less.
 */
export async function loadLandmarkSummaries(boxRoot: string): Promise<LandmarkSummary[]> {
  const matches = await glob("**/*.landmark.card", {
    cwd: boxRoot,
    nodir: true,
    ignore: ["node_modules/**", ".git/**", "tmp/**", ".callback-box/**"],
  });

  const out: LandmarkSummary[] = [];
  for (const relPath of matches) {
    const absPath = path.join(boxRoot, relPath);
    let fields;
    try {
      const content = await fs.readFile(absPath, "utf-8");
      fields = parseLandmarkFields(content);
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") {
        console.warn(`Skipping unreadable landmark card ${absPath}:`, e);
      }
      continue;
    }
    if (fields === null) continue;

    const navigation = fields.navigation;
    const dir = path.dirname(relPath);
    const symbol = readSymbol(navigation, { landmarkDir: path.dirname(absPath), boxRoot });
    out.push({
      dir: dir === "." ? "" : dir,
      label: (navigation === undefined ? "" : navigation.label ?? "") || path.basename(relPath, ".landmark.card"),
      symbol: symbol.text,
      symbolSrc: symbol.src,
    });
  }
  out.sort((a, b) => {
    // Root first, then alphabetical.
    if (a.dir === "") return -1;
    if (b.dir === "") return 1;
    return a.dir.localeCompare(b.dir);
  });
  return out;
}
