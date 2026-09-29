/**
 * Orama index storage for the CARD search index: schema, file locations,
 * restore, atomic persist. The generic machinery lives in `index-store.ts`
 * (shared with the chat-transcript index); this file owns the card index's
 * schema and filenames.
 *
 * Persistence format is JSON, and a 2026-07 attempt to switch to "binary"
 * (msgpack) is worth remembering before anyone retries it:
 * - msgpack's depth-100 encode limit is REAL on real corpora — the radix
 *   tree nests one level per character, and long indexed identifier
 *   strings (attach paths, doc ids, `contains` sentences) exceed it.
 *   `normalizeContent` (extract.ts) only splits body content, so a
 *   synthetic benchmark that passed missed this; a real box failed with
 *   "Too deep objects in depth 101". (Raising the limit needs a vendored
 *   patch — the persistence plugin doesn't expose encode options.)
 * - Even patched, it's no win where it counts: on a real ~2.5k-card box
 *   with ~1k vectors, restore — paid on EVERY search — measured ~10%
 *   SLOWER than JSON.parse (both are seconds-scale with vectors; msgpack
 *   decode crawls the deep nesting, JSON.parse is native). Binary's 40%
 *   disk saving doesn't buy back the hot path.
 * The seconds-scale restore cost of a vector-bearing index is structural
 * (vectors persist in both the doc store and the vector index; the whole
 *   index restores as one blob) — an upstream Orama gap, not a format choice.
 *
 * The index and its manifest are disposable per-checkout caches in
 * `.beebox/`. The persist order (index first, manifest last) makes a
 * crash between the two self-healing: an older manifest just re-diffs the
 * affected files on the next refresh.
 */

import type { Orama } from "@orama/orama";
import { EMBEDDING_DIMENSIONS } from "../../../services/openai-embeddings.js";
import { invariant } from "../../../shared/invariant.js";
import { createIndexStore, indexPersistedFor, type IndexPersisted } from "./index-store.js";

export { writeJsonAtomic } from "./index-store.js";
export type { IndexPersisted } from "./index-store.js";

/**
 * Bump when the document schema or extraction shape changes; a mismatch
 * triggers a silent full rebuild.
 * v2: image OCR text: blocks fold into content.
 * v3: standalone .md files index as kind "markdown".
 * v4: embedding vector field.
 * v5: no `created` field; titles come from the card summary (`cardTitle`).
 */
export const SEARCH_SCHEMA_VERSION = 5;

export const searchOramaSchema = {
  path: "string",
  fragment: "string",
  kind: "enum",
  title: "string",
  contains: "string",
  content: "string",
  contentHash: "string",
  // Literal string tied to EMBEDDING_DIMENSIONS (openai-embeddings.ts) — Orama's
  // schema typing needs `vector[${number}]` as a literal type, which a template
  // literal built from the constant can't preserve. Keep in sync by hand; a
  // dims change also requires bumping SEARCH_SCHEMA_VERSION above.
  embedding: "vector[512]",
} as const;

// Import-time tripwire for the hand-kept tie described above: a dims change
// that misses the schema literal fails here, not obscurely at insert time.
invariant(
  searchOramaSchema.embedding === `vector[${String(EMBEDDING_DIMENSIONS)}]`,
  `search schema embedding field "${searchOramaSchema.embedding}" does not match EMBEDDING_DIMENSIONS ${String(EMBEDDING_DIMENSIONS)}`,
);

export type SearchIndex = Orama<typeof searchOramaSchema>;

const store = createIndexStore(
  {
    indexFilename: "search-index.json",
    manifestFilename: "search-index-manifest.json",
    lockFilename: "search-index.lock",
    label: "search",
  },
  searchOramaSchema,
);

export function searchIndexPath(boxRoot: string): string {
  return store.indexPath(boxRoot);
}

export function searchManifestPath(boxRoot: string): string {
  return store.manifestPath(boxRoot);
}

export function searchLockPath(boxRoot: string): string {
  return store.lockPath(boxRoot);
}

export async function createSearchIndex(): Promise<SearchIndex> {
  return store.create();
}

/**
 * Restore the persisted index, or null when it's absent or unreadable
 * (caller rebuilds — the index is a cache, never a source of truth).
 */
export async function restoreSearchIndex(boxRoot: string): Promise<SearchIndex | null> {
  return store.restore(boxRoot);
}

/** Persist the index atomically (write temp, rename); returns the ordering receipt. */
export async function persistSearchIndex(db: SearchIndex, boxRoot: string): Promise<IndexPersisted> {
  return store.persist(db, boxRoot);
}

/**
 * Mint an ordering receipt for a refresh that changed no documents — only the
 * manifest's stat/mtime records, or skip records for cards that failed to parse
 * (docIds `[]`). No index write is needed: the on-disk index (restored, or a
 * fresh empty one when only skipped cards exist) already reflects the manifest's
 * doc ids, so writing the manifest alone is safe. This receipt exists so
 * `saveManifest` still can't be called with *no* proof — the ordering guarantee
 * for doc-changing refreshes comes from {@link persistSearchIndex}.
 */
export function indexUnchanged(boxRoot: string): IndexPersisted {
  return indexPersistedFor(boxRoot);
}
