/**
 * Per-file parse memo for the prominence index (`prominence-index.ts`), on
 * the same pattern as `card-cache.ts`: discovery (which files exist) is
 * never cached, so an added/removed/moved card shows up on the very next
 * call, but the parse of one file's *current bytes* is memoized, keyed on
 * `ino:mtimeNs:ctimeNs:size`. A cache entry is only used when all four still
 * match; a rewrite that lands between the pre- and post-read `stat` is
 * answered from the fresh bytes but never cached, so a race can't file old
 * bytes under a new identity and serve them forever (the failure
 * `card-cache.ts`'s header explains).
 *
 * Two independent caches share this generic: one for a content card's raw
 * frontmatter mapping (`readFrontmatterCached`), one for a landmark card's
 * typed fields (`readLandmarkFieldsCached`) — the pruned walk reads both
 * kinds of file. A module-level counter (`getParseCount`/`resetParseCount`)
 * tracks real reads across both, purely for the doctest's "a warm second
 * call parses nothing" assertion; nothing in production code reads it, so it
 * costs one integer increment and is otherwise inert.
 */

import * as fs from "node:fs/promises";
import { readCardFrontmatter } from "../card-io.js";
import { parseLandmarkFields, type LandmarkFields } from "../../schemas/landmark.js";

/**
 * Cap on remembered files per cache; overflow clears the cache, as in
 * `card-cache.ts`. The pruned walk reads every card in the box, so this cap
 * must exceed a large box's card count: at 4,096, a box of about 9,000 cards
 * cleared the cache on every walk and re-parsed every card each time.
 */
const MAX_ENTRIES = 65_536;

interface CacheEntry<T> {
  key: string;
  value: T;
  mtimeMs: number;
}

/** A cached parse plus the modification time of the bytes it came from. */
interface Cached<T> {
  value: T;
  mtimeMs: number;
}

let parseCount = 0;

/** Real (cache-missed) file reads performed by this module since the last reset. Test-only. */
export function getParseCount(): number {
  return parseCount;
}

/** Zero the parse counter. Test-only. */
export function resetParseCount(): void {
  parseCount = 0;
}

async function readCached<T>(
  absPath: string,
  { cache, parse }: { cache: Map<string, CacheEntry<T>>; parse: (text: string) => T },
): Promise<Cached<T>> {
  const seen = await fs.stat(absPath, { bigint: true });
  const hit = cache.get(absPath);
  if (hit !== undefined && hit.key === identity(seen)) return { value: hit.value, mtimeMs: hit.mtimeMs };

  const handle = await fs.open(absPath, "r");
  let bytes: Buffer;
  let before;
  let after;
  try {
    before = await handle.stat({ bigint: true });
    bytes = await handle.readFile();
    after = await handle.stat({ bigint: true });
  } finally {
    await handle.close();
  }
  parseCount += 1;
  const value = parse(bytes.toString("utf-8"));
  const mtimeMs = Number(after.mtimeMs);
  // Changed under us: answer from the bytes read, remember nothing (see header).
  if (identity(before) !== identity(after)) return { value, mtimeMs };
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(absPath, { key: identity(after), value, mtimeMs });
  return { value, mtimeMs };
}

const frontmatterCache = new Map<string, CacheEntry<Record<string, unknown> | null>>();

/**
 * A content card's raw frontmatter mapping (`fields`, null when the file has
 * no parseable frontmatter block) and its modification time, cached
 * per-file. The mtime orders a place's "Also here" list.
 */
export async function readFrontmatterCached(
  absPath: string,
): Promise<{ fields: Record<string, unknown> | null; mtimeMs: number }> {
  const { value, mtimeMs } = await readCached(absPath, { cache: frontmatterCache, parse: readCardFrontmatter });
  return { fields: value, mtimeMs };
}

const landmarkCache = new Map<string, CacheEntry<LandmarkFields | null>>();

/** A landmark card's typed fields, cached per-file. Null when the file doesn't parse as a landmark. */
export async function readLandmarkFieldsCached(absPath: string): Promise<LandmarkFields | null> {
  return (await readCached(absPath, { cache: landmarkCache, parse: parseLandmarkFields })).value;
}

function identity(stat: { ino: bigint; mtimeNs: bigint; ctimeNs: bigint; size: bigint }): string {
  return `${stat.ino}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}`;
}
