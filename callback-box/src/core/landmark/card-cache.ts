/**
 * Parse memo for `*.landmark.card` frontmatter, keyed on file identity.
 *
 * Both whole-box landmark scans (`loadLandmarkSummaries` for the place picker,
 * `listDestinations` for the filing pickers) read and YAML-parse every landmark
 * card in the box on every call. The parsing is the expensive half — measured
 * 2026-08-08 on a ~10k-file box, ~70ms of a ~130ms scan — and it repeats
 * identically until someone edits a card.
 *
 * **What is and isn't cached.** Only the *parse of one file's current bytes*.
 * The glob that discovers which cards exist is deliberately NOT cached, so an
 * added or deleted landmark shows up on the very next call with no invalidation
 * logic to get wrong. A cached entry is used only when the file's inode,
 * nanosecond mtime, and size all still match — so an edit (in place or by
 * atomic replace) misses, and a same-millisecond double write is caught by the
 * nanosecond field and the inode rather than trusted. The cost of a hit is one
 * `stat`.
 *
 * The returned `LandmarkFields` is shared between callers. Treat it as
 * immutable; nothing in the codebase mutates a parsed card's fields.
 */

import * as fs from "node:fs/promises";
import { parseLandmarkFields, type LandmarkFields } from "../../schemas/landmark.js";

/**
 * Cap on remembered cards. Entries for deleted cards are never individually
 * evicted (the cache never learns a file is gone), so the map is cleared
 * wholesale on overflow — a bounded, self-healing leak rather than an
 * unbounded one. Boxes hold landmarks in the tens; a box past this is
 * pathological and pays a full re-parse round, not a memory problem.
 */
const MAX_ENTRIES = 4096;

interface CacheEntry {
  /** Identity of the bytes this parse came from. */
  key: string;
  /** Parsed fields, or null for a card that doesn't parse as a landmark. */
  fields: LandmarkFields | null;
}

const cache = new Map<string, CacheEntry>();

/**
 * Read and parse a landmark card, reusing the previous parse when the file is
 * byte-identical (same inode, mtime, and size). Returns null for a card whose
 * frontmatter doesn't parse as a landmark — the same "not a landmark" answer
 * `parseLandmarkFields` gives, and it is cached too, so a broken card is not
 * re-parsed on every scan either. Filesystem errors propagate to the caller.
 */
export async function readLandmarkCard(absPath: string): Promise<LandmarkFields | null> {
  const before = await fs.stat(absPath, { bigint: true });
  const hit = cache.get(absPath);
  if (hit !== undefined && hit.key === identity(before)) return hit.fields;

  // Key the stored parse on a stat of the OPEN HANDLE taken after the read, not
  // on the pre-read stat: a write that lands between them would otherwise cache
  // the new bytes under the old identity and go stale until the *next* write.
  // A replace-by-rename leaves this handle on the old inode, so the key names
  // the file we actually read and the next call misses on the new inode.
  const handle = await fs.open(absPath, "r");
  let bytes: Buffer;
  let after;
  try {
    bytes = await handle.readFile();
    after = await handle.stat({ bigint: true });
  } finally {
    await handle.close();
  }
  const fields = parseLandmarkFields(bytes.toString("utf-8"));
  // A size disagreement means the file was being written as we read it: the
  // bytes are a torn snapshot, so answer from them but remember nothing.
  if (BigInt(bytes.byteLength) !== after.size) return fields;
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(absPath, { key: identity(after), fields });
  return fields;
}

/** The file identity a cached parse is valid for. */
function identity(stat: { ino: bigint; mtimeNs: bigint; size: bigint }): string {
  return `${stat.ino}:${stat.mtimeNs}:${stat.size}`;
}
