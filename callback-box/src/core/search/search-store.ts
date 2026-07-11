/**
 * Orama index storage: schema, file locations, restore, atomic persist.
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
 * index restores as one blob) — an upstream Orama gap, not a format choice.
 *
 * The index and its manifest are disposable per-checkout caches in
 * `.callback-box/`. The persist order (index first, manifest last) makes a
 * crash between the two self-healing: an older manifest just re-diffs the
 * affected files on the next refresh.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { create, type Orama } from "@orama/orama";
import { persistToFile, restoreFromFile } from "@orama/plugin-data-persistence/server";
import { EMBEDDING_DIMENSIONS } from "../../services/openai-embeddings.js";
import { invariant } from "../../lib/invariant.js";
import { errorMessage } from "../../lib/error-guards.js";

/**
 * Bump when the document schema or extraction shape changes; a mismatch
 * triggers a silent full rebuild.
 * v2: image OCR text: blocks fold into content.
 * v3: standalone .md files index as kind "markdown".
 * v4: embedding vector field.
 */
export const SEARCH_SCHEMA_VERSION = 4;

export const searchOramaSchema = {
  path: "string",
  fragment: "string",
  kind: "enum",
  title: "string",
  contains: "string",
  content: "string",
  created: "string",
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

const INDEX_FILENAME = "search-index.json";
/** Left behind by the short-lived binary-format experiment (2026-07). */
const LEGACY_INDEX_FILENAME = "search-index.msp";
const MANIFEST_FILENAME = "search-index-manifest.json";
const LOCK_FILENAME = "search-index.lock";

export function searchIndexPath(boxRoot: string): string {
  return path.join(boxRoot, ".callback-box", INDEX_FILENAME);
}

export function searchManifestPath(boxRoot: string): string {
  return path.join(boxRoot, ".callback-box", MANIFEST_FILENAME);
}

export function searchLockPath(boxRoot: string): string {
  return path.join(boxRoot, ".callback-box", LOCK_FILENAME);
}

export async function createSearchIndex(): Promise<SearchIndex> {
  return create({ schema: searchOramaSchema });
}

/**
 * Restore the persisted index, or null when it's absent or unreadable
 * (caller rebuilds — the index is a cache, never a source of truth).
 */
export async function restoreSearchIndex(boxRoot: string): Promise<SearchIndex | null> {
  const indexPath = searchIndexPath(boxRoot);
  try {
    await fs.access(indexPath);
  } catch (_e) {
    return null;
  }
  try {
    return await restoreFromFile<SearchIndex>("json", indexPath);
  } catch (e) {
    console.warn(`search: could not restore index (${errorMessage(e)}); rebuilding`);
    return null;
  }
}

/**
 * Proof that the on-disk search index at `boxRoot` is current — i.e. it already
 * reflects the doc ids the manifest is about to record. `saveManifest` requires
 * one, so the manifest can never be written ahead of the index (the crash-safety
 * ordering documented at the top of this file becomes a compile-time guarantee,
 * not a convention). Only {@link persistSearchIndex} (a fresh write) and
 * {@link indexUnchanged} (a no-doc-change refresh) mint one — the brand key is
 * module-private, so no other code can forge a receipt.
 */
const indexPersistedBrand = Symbol("IndexPersisted");
export interface IndexPersisted {
  readonly [indexPersistedBrand]: true;
  readonly boxRoot: string;
}

function indexPersistedFor(boxRoot: string): IndexPersisted {
  return { [indexPersistedBrand]: true, boxRoot };
}

/** Persist the index atomically (write temp, rename); returns the ordering receipt. */
export async function persistSearchIndex(db: SearchIndex, boxRoot: string): Promise<IndexPersisted> {
  const indexPath = searchIndexPath(boxRoot);
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  const tmp = `${indexPath}.tmp`;
  await persistToFile(db, "json", tmp);
  await fs.rename(tmp, indexPath);
  // Sweep the binary-experiment leftover so the cache dir doesn't carry a
  // dead 20MB file forever.
  await fs.rm(path.join(path.dirname(indexPath), LEGACY_INDEX_FILENAME), { force: true });
  return indexPersistedFor(boxRoot);
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

/** Write a JSON file atomically (write temp, rename). */
export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n");
  await fs.rename(tmp, filePath);
}

