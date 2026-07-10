/**
 * Dotted-path frontmatter field lookup for card files.
 *
 * Shared by the landmark navigation resolver (`landmark/resolve.ts`) and the
 * `cb ls --format` command (`commands/ls.ts`). Both read a scalar field out of
 * a card's YAML frontmatter by a dotted path — this replaces the old
 * XPath-over-XML evaluation now that cards are YAML frontmatter.
 */

import * as fs from "node:fs/promises";
import { readCardFrontmatter, isRecord } from "./card-io.js";

/**
 * Read a dotted field path out of a frontmatter mapping. `title` →
 * `frontmatter.title`; `exif.camera` walks nested mappings. Missing or
 * non-scalar values render as the empty string.
 */
export function lookupField(frontmatter: Record<string, unknown>, expr: string): string {
  let cursor: unknown = frontmatter;
  for (const key of expr.split(".")) {
    if (!isRecord(cursor)) return "";
    cursor = cursor[key];
  }
  if (cursor === null || cursor === undefined) return "";
  if (typeof cursor === "object") return "";
  return String(cursor);
}

/**
 * Read + parse a card file's frontmatter mapping. Returns null when the file
 * can't be read, has no frontmatter block, or the frontmatter isn't a YAML
 * mapping (malformed YAML, an array, a scalar).
 *
 * Delegates the parse/guard to {@link readCardFrontmatter} (the single
 * frontmatter-or-null implementation); this wrapper only adds the file read.
 * Behavior note: an empty frontmatter block (`---\n---`) now reads as `{}`
 * (parsed-but-empty) rather than `null` — readCardFrontmatter distinguishes
 * "empty" from "unparseable", where the old inline copy conflated them. Only
 * matters for the (real-card-free) empty-block edge case; callers that branch
 * on `null` now see such a card as a normal, field-less card instead of
 * "could not parse".
 */
export async function loadCardFrontmatter(absPath: string): Promise<Record<string, unknown> | null> {
  let content: string;
  try {
    content = await fs.readFile(absPath, "utf-8");
  } catch (_e) {
    return null;
  }
  return readCardFrontmatter(content);
}
