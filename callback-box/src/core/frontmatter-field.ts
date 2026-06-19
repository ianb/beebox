/**
 * Dotted-path frontmatter field lookup for card files.
 *
 * Shared by the landmark navigation resolver (`landmark/resolve.ts`) and the
 * `cb ls --format` command (`commands/ls.ts`). Both read a scalar field out of
 * a card's YAML frontmatter by a dotted path — this replaces the old
 * XPath-over-XML evaluation now that cards are YAML frontmatter.
 */

import * as fs from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { splitCardContent } from "../cards/index.js";

/**
 * Read a dotted field path out of a frontmatter mapping. `title` →
 * `frontmatter.title`; `exif.camera` walks nested mappings. Missing or
 * non-scalar values render as the empty string.
 */
export function lookupField(frontmatter: Record<string, unknown>, expr: string): string {
  let cursor: unknown = frontmatter;
  for (const key of expr.split(".")) {
    if (cursor === null || typeof cursor !== "object") return "";
    cursor = (cursor as Record<string, unknown>)[key];
  }
  if (cursor === null || cursor === undefined) return "";
  if (typeof cursor === "object") return "";
  return String(cursor);
}

/**
 * Read + parse a card file's frontmatter mapping. Returns null when the file
 * can't be read, has no frontmatter block, or the frontmatter isn't a YAML
 * mapping (malformed YAML, an array, a scalar).
 */
export async function loadCardFrontmatter(absPath: string): Promise<Record<string, unknown> | null> {
  let content: string;
  try {
    content = await fs.readFile(absPath, "utf-8");
  } catch (_e) {
    return null;
  }
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) return null;
  let fm: unknown;
  try {
    fm = parseYaml(split.frontmatterText);
  } catch (_e) {
    return null;
  }
  if (fm === null || typeof fm !== "object" || Array.isArray(fm)) return null;
  return fm as Record<string, unknown>;
}
