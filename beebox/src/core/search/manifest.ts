/**
 * The search-index manifest: per-card stat/hash records that let the lazy
 * refresh re-extract only what changed. Lives next to the index in
 * `.beebox/` and is written after it (see search-store.ts).
 */

import { promises as fs } from "node:fs";
import { z } from "zod";
import { SEARCH_SCHEMA_VERSION, searchManifestPath, writeJsonAtomic, type IndexPersisted } from "./search-store.js";
import { invariant } from "../../lib/invariant.js";
import { errorMessage } from "../../lib/error-guards.js";

/** Stat/hash record for a declared input file (e.g. a gdoc snapshot). */
const inputFileEntrySchema = z.object({
  mtimeMs: z.number(),
  size: z.number(),
  contentHash: z.string(),
});
export type InputFileEntry = z.infer<typeof inputFileEntrySchema>;

const manifestFileEntrySchema = z.object({
  mtimeMs: z.number(),
  size: z.number(),
  contentHash: z.string(),
  /** Document ids this card contributed — exact removal on change/delete. */
  docIds: z.array(z.string()),
  /** Extra files this card's documents were built from, keyed by box-relative path. */
  inputs: z.record(z.string(), inputFileEntrySchema).optional(),
  /**
   * The card failed to parse and contributed no documents. Remembered so an
   * unchanged broken card warns once, not on every refresh.
   */
  skipped: z.boolean().optional(),
  /**
   * Hash of `EMBEDDER_ID + "\n" + containsText` as of this card's last
   * successful embed. Absent means not embedded (no key configured yet, or
   * the last embed attempt failed). A mismatch against the current
   * `EMBEDDER_ID`/`containsText` pair means the card is pending re-embed —
   * this one field covers changed cards, never-embedded cards, and retry
   * after failure.
   */
  embeddedHash: z.string().optional(),
});
export type ManifestFileEntry = z.infer<typeof manifestFileEntrySchema>;

const searchManifestSchema = z.object({
  schemaVersion: z.number(),
  files: z.record(z.string(), manifestFileEntrySchema),
});
export type SearchManifest = z.infer<typeof searchManifestSchema>;

export function emptyManifest(): SearchManifest {
  return { schemaVersion: SEARCH_SCHEMA_VERSION, files: {} };
}

/**
 * Load the manifest; absent, unreadable, or version-mismatched manifests
 * come back empty, which makes the next refresh a full rebuild.
 */
export async function loadManifest(boxRoot: string): Promise<SearchManifest> {
  let raw: string;
  try {
    raw = await fs.readFile(searchManifestPath(boxRoot), "utf8");
  } catch (_e) {
    return emptyManifest();
  }
  try {
    // Parse boundary: disk JSON is untrusted — validate the full shape with
    // zod rather than casting, so a corrupt or foreign-shaped manifest falls
    // back to a full rebuild instead of flowing unchecked data downstream.
    const parsed: unknown = JSON.parse(raw);
    const result = searchManifestSchema.safeParse(parsed);
    if (!result.success || result.data.schemaVersion !== SEARCH_SCHEMA_VERSION) {
      return emptyManifest();
    }
    return result.data;
  } catch (e) {
    console.warn(`search: manifest unreadable (${errorMessage(e)}); rebuilding`);
    return emptyManifest();
  }
}

/**
 * Persist the manifest. Requires an {@link IndexPersisted} receipt proving the
 * on-disk index is already current for `boxRoot` — this is what enforces the
 * index-before-manifest crash-safety ordering: there is no way to write the
 * manifest without first holding proof the index write completed. The receipt's
 * box is checked against `boxRoot` so a receipt from another box can't stand in.
 */
export async function saveManifest(
  boxRoot: string,
  { manifest, indexProof }: { manifest: SearchManifest; indexProof: IndexPersisted },
): Promise<void> {
  invariant(
    indexProof.boxRoot === boxRoot,
    `search: manifest save for ${boxRoot} with an index receipt for ${indexProof.boxRoot}`,
  );
  await writeJsonAtomic(searchManifestPath(boxRoot), manifest);
}
