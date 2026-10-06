/**
 * Cross-file card-lint rule: two publication cards must never share a `pubId`.
 *
 * The `pubId` is a publication's identity and its only link to server state,
 * so a copied card asks to publish one site from two places. Both cards still
 * load (a schema sees one card at a time), so this rule reports the pair. Like
 * `chat-duplicates.ts`, the index of `*.publication.card` files is built once
 * per `lintCardsDispatch` run and memoized on that run's options object. Which
 * card to keep is the boxholder's choice, so the rule reports and never repairs.
 */

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import type { LintIssue } from "../../exports/cards.js";
import { parseFrontmatterObject } from "../../cards/frontmatter.js";
import { listBoxCardFiles } from "../list-cards.js";

const runIndexes = new WeakMap<object, Promise<Map<string, string[]>>>();

/**
 * Map each `pubId` to the box-relative paths of the publication cards that
 * carry it. Shared by this rule and local publish prepare.
 */
export async function publicationCardsByPubId(boxRoot: string): Promise<Map<string, string[]>> {
  const files = (await listBoxCardFiles(boxRoot)).filter((file) => file.endsWith(".publication.card")).toSorted();
  const index = new Map<string, string[]>();
  for (const file of files) {
    const pubId = parseFrontmatterObject(await readFile(file, "utf8"))?.["pubId"];
    if (typeof pubId !== "string" || pubId === "") continue;
    const relPath = path.relative(boxRoot, file).split(path.sep).join("/");
    index.set(pubId, [...(index.get(pubId) ?? []), relPath]);
  }
  return index;
}

function pubIdIndex(input: { boxRoot: string; run: object }): Promise<Map<string, string[]>> {
  const cached = runIndexes.get(input.run);
  if (cached !== undefined) return cached;
  const built = publicationCardsByPubId(input.boxRoot);
  runIndexes.set(input.run, built);
  return built;
}

/** Error when another publication card in the box carries this card's `pubId`. */
export async function lintDuplicatePublicationId(input: {
  path: string;
  fields: Record<string, unknown>;
  boxRoot: string;
  run: object;
}): Promise<LintIssue[]> {
  const pubId = input.fields["pubId"];
  if (typeof pubId !== "string" || pubId === "") return [];
  const index = await pubIdIndex({ boxRoot: input.boxRoot, run: input.run });
  const relPath = path.relative(input.boxRoot, input.path).split(path.sep).join("/");
  const others = (index.get(pubId) ?? []).filter((other) => other !== relPath);
  if (others.length === 0) return [];
  return [{
    type: "validation",
    severity: "error",
    message:
      `Duplicate publication id ${pubId}: ${relPath} and ${others.join(", ")} claim one publication. ` +
      "Keep one card. Delete the copy, or give it a new id from `bbx pub id`.",
  }];
}
