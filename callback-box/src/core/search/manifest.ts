/**
 * The search-index manifest: per-card stat/hash records that let the lazy
 * refresh re-extract only what changed. Lives next to the index in
 * `.callback-box/` and is written after it (see search-store.ts).
 */

import { promises as fs } from "node:fs";
import { SEARCH_SCHEMA_VERSION, searchManifestPath, writeJsonAtomic } from "./search-store.js";

/** Stat/hash record for a declared input file (e.g. a gdoc snapshot). */
export interface InputFileEntry {
  mtimeMs: number;
  size: number;
  contentHash: string;
}

export interface ManifestFileEntry {
  mtimeMs: number;
  size: number;
  contentHash: string;
  /** Document ids this card contributed — exact removal on change/delete. */
  docIds: string[];
  /** Extra files this card's documents were built from, keyed by box-relative path. */
  inputs?: Record<string, InputFileEntry>;
}

export interface SearchManifest {
  schemaVersion: number;
  files: Record<string, ManifestFileEntry>;
}

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
    const parsed = JSON.parse(raw) as SearchManifest;
    if (parsed.schemaVersion !== SEARCH_SCHEMA_VERSION) return emptyManifest();
    if (typeof parsed.files !== "object" || parsed.files === null) return emptyManifest();
    return parsed;
  } catch (e) {
    console.warn(`search: manifest unreadable (${(e as Error).message}); rebuilding`);
    return emptyManifest();
  }
}

export async function saveManifest(boxRoot: string, manifest: SearchManifest): Promise<void> {
  await writeJsonAtomic(searchManifestPath(boxRoot), manifest);
}
