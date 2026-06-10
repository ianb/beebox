/**
 * Orama index storage: schema, file locations, restore, atomic persist.
 *
 * Persistence format is JSON, not msgpack ("binary"): the radix tree nests
 * one object level per branching character, and a real corpus's OCR'd
 * numbers branch deeper than msgpack's hard depth limit of 100
 * ("Too deep objects in depth 101"). JSON.stringify has no such limit.
 *
 * The index and its manifest are disposable per-checkout caches in
 * `.callback-box/`. The persist order (index first, manifest last) makes a
 * crash between the two self-healing: an older manifest just re-diffs the
 * affected files on the next refresh.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { create, type Orama } from "@orama/orama";
import { persistToFile, restoreFromFile } from "@orama/plugin-data-persistence/server";

/**
 * Bump when the document schema or extraction shape changes; a mismatch
 * triggers a silent full rebuild.
 * v2: image OCR text: blocks fold into content.
 */
export const SEARCH_SCHEMA_VERSION = 2;

export const searchOramaSchema = {
  path: "string",
  fragment: "string",
  kind: "enum",
  title: "string",
  contains: "string",
  content: "string",
  created: "string",
  contentHash: "string",
} as const;

export type SearchIndex = Orama<typeof searchOramaSchema>;

const INDEX_FILENAME = "search-index.json";
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
    const db = await restoreFromFile("json", indexPath);
    return db as SearchIndex;
  } catch (e) {
    console.warn(`search: could not restore index (${(e as Error).message}); rebuilding`);
    return null;
  }
}

/** Persist the index atomically (write temp, rename). */
export async function persistSearchIndex(db: SearchIndex, boxRoot: string): Promise<void> {
  const indexPath = searchIndexPath(boxRoot);
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  const tmp = `${indexPath}.tmp`;
  await persistToFile(db, "json", tmp);
  await fs.rename(tmp, indexPath);
}

/** Write a JSON file atomically (write temp, rename). */
export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n");
  await fs.rename(tmp, filePath);
}

/** Content hash used by the manifest and search documents. */
export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}
