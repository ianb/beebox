/**
 * List the landmark destinations of a given kind across a box.
 *
 * A destination is a landmark whose `<destination for="…">` role advertises
 * the requested kind (see `destination.ts`; the legacy `<triage-destination>`
 * counts as `triage`). Used by the clerk commentary endpoint to offer filing
 * spots, and available to any caller that needs "where can <kind> go?".
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { glob } from "glob";
import { parseCard, type ElementNode } from "cardworks";
import { findDestination, type DestinationKind } from "./destination.js";

export interface DestinationInfo {
  /** Box-relative directory containing the landmark (empty string = box root). */
  dir: string;
  /** Navigation label, falling back to the directory's last segment. */
  label: string;
  /** `<symbol>` text (emoji/short text), or null if none / image-only. */
  symbol: string | null;
}

function findNavigation(element: ElementNode): ElementNode | null {
  for (const child of element.children) {
    if (child.tagName === "navigation") return child;
  }
  return null;
}

function navText(navigation: ElementNode | null, tagName: string): string | null {
  if (navigation === null) return null;
  for (const child of navigation.children) {
    if (child.tagName === tagName && typeof child.text === "string" && child.text.trim() !== "") {
      return child.text.trim();
    }
  }
  return null;
}

export async function listDestinations(
  boxRoot: string,
  kind: DestinationKind,
): Promise<DestinationInfo[]> {
  const matches = await glob("**/*.landmark.card", {
    cwd: boxRoot,
    nodir: true,
    ignore: ["node_modules/**", ".git/**", "tmp/**", ".callback-box/**"],
  });

  const out: DestinationInfo[] = [];
  for (const relPath of matches) {
    const absPath = path.join(boxRoot, relPath);
    let element: ElementNode;
    try {
      const content = await fs.readFile(absPath, "utf-8");
      element = await parseCard(content, { source: absPath });
    } catch (e) {
      console.warn(`list-destinations: failed to parse ${absPath}: ${(e as Error).message}`);
      continue;
    }
    if (element.tagName !== "landmark") continue;
    if (findDestination(element, kind) === null) continue;

    const dir = path.dirname(relPath);
    const normalizedDir = dir === "." ? "" : dir;
    const navigation = findNavigation(element);
    const label = navText(navigation, "label") ?? (normalizedDir === "" ? "root" : path.basename(normalizedDir));
    out.push({ dir: normalizedDir, label, symbol: navText(navigation, "symbol") });
  }

  out.sort((a, b) => {
    if (a.dir === "" && b.dir !== "") return -1;
    if (b.dir === "" && a.dir !== "") return 1;
    return a.dir.localeCompare(b.dir);
  });
  return out;
}
