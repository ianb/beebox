/**
 * Read and replace a doc card's composition text on disk, with the region
 * hash as the write precondition (`plan:composition-editor`,
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
  /**
   * `where: "text"`: the new text would break the region, nothing was written.
   * `closed-early`: the text holds a `{% /composition %}`, so the region would
   * end inside it and the rest would land outside.
   */
  | { status: "problem"; problem: CompositionProblem["problem"] | "closed-early"; where: "file" | "text" };

/** SHA-256 of the region text (the form `findComposition` returns), as hex. */
function compositionHash(text: string): string {
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

type Spliced =
  | { status: "ok"; content: string; regionHash: string; changed: boolean }
  | Exclude<CompositionWrite, { status: "written" }>;

/**
 * The file content with the region's text replaced, when the region's hash
 * still equals `baseRegionHash` and the result keeps one well-formed region
 * holding exactly `text`. Pure, so a caller can check a write before it
 * commits anything.
 */
export function checkCompositionWrite(raw: string, { baseRegionHash, text }: { baseRegionHash: string; text: string }): Spliced {
  const { prefix, body, found } = locate(raw);
  if ("problem" in found) return { status: "problem", problem: found.problem, where: "file" };
  const currentHash = compositionHash(found.text);
  if (currentHash !== baseRegionHash) return { status: "conflict", text: found.text, regionHash: currentHash };
  const nextBody = spliceComposition(body, { region: found, text });
  const next = findComposition(nextBody);
  if ("problem" in next) return { status: "problem", problem: next.problem, where: "text" };
  // The region found again must be exactly the text sent (less the final newline the splice supplies).
  if (next.text !== text.replace(/\n$/, "")) return { status: "problem", problem: "closed-early", where: "text" };
  const content = prefix + nextBody;
  return { status: "ok", content, regionHash: compositionHash(next.text), changed: content !== raw };
}

/**
 * Replace the region's text when its hash still equals `baseRegionHash`.
 * Bytes outside the region are kept. The caller holds the card lock.
 */
export async function writeCompositionFile(
  fullPath: string,
  input: { baseRegionHash: string; text: string },
): Promise<CompositionWrite> {
  const spliced = checkCompositionWrite(await fs.readFile(fullPath, "utf-8"), input);
  if (spliced.status !== "ok") return spliced;
  if (spliced.changed) await writeFileAtomic(fullPath, { content: spliced.content });
  return { status: "written", regionHash: spliced.regionHash, changed: spliced.changed };
}
