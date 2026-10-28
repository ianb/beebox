/**
 * Read and replace a doc card's composition text on disk, with the region
 * hash as the write precondition (`docs/plans/composition-editor.md`,
 * Track 4). The region is found in the body after frontmatter, so its
 * offsets are shifted by the frontmatter's length before splicing the file.
 */
import * as fs from "node:fs/promises";
import { splitCardContent } from "../exports/cards.js";
import { writeFileAtomic } from "../lib/atomic-write.js";
import { sha256Hex } from "../lib/content-hash.js";
import { findComposition, spliceComposition, type CompositionProblem } from "../shared/composition/region.js";

export type CompositionRead = { text: string; regionHash: string } | CompositionProblem;

export type CompositionWrite =
  | { status: "written"; regionHash: string; changed: boolean }
  | { status: "conflict"; text: string; regionHash: string }
  /** `where: "text"`: the new text would break the region (for example a stray closing tag); nothing was written. */
  | { status: "problem"; problem: CompositionProblem["problem"]; where: "file" | "text" };

/** SHA-256 of the region text (the form `findComposition` returns), as hex. */
export function compositionHash(text: string): string {
  return sha256Hex(text);
}

function locate(raw: string) {
  const { body } = splitCardContent(raw);
  return { prefix: raw.slice(0, raw.length - body.length), body, found: findComposition(body) };
}

export async function readCompositionFile(fullPath: string): Promise<CompositionRead> {
  const { found } = locate(await fs.readFile(fullPath, "utf-8"));
  if ("problem" in found) return found;
  return { text: found.text, regionHash: compositionHash(found.text) };
}

/**
 * Replace the region's text when its hash still equals `baseRegionHash`.
 * Bytes outside the region are kept. The caller holds the card lock.
 */
export async function writeCompositionFile(
  fullPath: string,
  { baseRegionHash, text }: { baseRegionHash: string; text: string },
): Promise<CompositionWrite> {
  const raw = await fs.readFile(fullPath, "utf-8");
  const { prefix, body, found } = locate(raw);
  if ("problem" in found) return { status: "problem", problem: found.problem, where: "file" };
  const currentHash = compositionHash(found.text);
  if (currentHash !== baseRegionHash) return { status: "conflict", text: found.text, regionHash: currentHash };
  const nextBody = spliceComposition(body, { region: found, text });
  const next = findComposition(nextBody);
  if ("problem" in next) return { status: "problem", problem: next.problem, where: "text" };
  const content = prefix + nextBody;
  const changed = content !== raw;
  if (changed) await writeFileAtomic(fullPath, { content });
  return { status: "written", regionHash: compositionHash(next.text), changed };
}
