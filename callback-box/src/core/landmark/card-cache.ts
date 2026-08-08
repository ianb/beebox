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
 * nanosecond mtime and ctime, and size all still match — so an edit (in place
 * or by atomic replace) misses. The cost of a hit is one `stat`.
 *
 * The failure this must never have is a *sticky* stale entry: a wrong answer
 * that keeps being served until someone writes the file again. Everything in
 * `readLandmarkCard` below is arranged around that, and the comments there say
 * which race each step closes. A merely *transient* staleness — answering from
 * a cache entry that went out of date microseconds ago — is fine and
 * unavoidable; the next call corrects it.
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
  // Hit check is one cheap path-stat. A file replaced *just* after this stat
  // still answers from cache — that answer was correct microseconds ago, and
  // the next call sees the new identity. Transient, not sticky.
  const seen = await fs.stat(absPath, { bigint: true });
  const hit = cache.get(absPath);
  if (hit !== undefined && hit.key === identity(seen)) return hit.fields;

  // Miss: read through a handle and fstat that handle BOTH SIDES of the read.
  // Only an unchanged identity across the read proves the bytes and the key
  // describe the same content. Keying on the post-read stat alone was wrong:
  // an in-place rewrite landing between the read and the stat would store the
  // OLD bytes under the NEW identity, and the cache would then serve stale
  // content on every later call until something wrote the file again — silent,
  // sticky staleness, which is the one failure this cache must not have.
  // (Codex cross-model review, 2026-08-08.)
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
  const fields = parseLandmarkFields(bytes.toString("utf-8"));
  // Changed under us: answer from the bytes we have, remember nothing.
  if (identity(before) !== identity(after)) return fields;
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(absPath, { key: identity(after), fields });
  return fields;
}

/**
 * The file identity a cached parse is valid for.
 *
 * `ctimeNs` alongside `mtimeNs` because mtime is forgeable and coarse-able:
 * `utimes` can restore an old timestamp onto new content, and ctime moves on
 * any inode change whether or not mtime does. `ino` catches replace-by-rename
 * (and, with the timestamps, makes inode reuse after a delete/create
 * vanishingly unlikely to collide).
 */
function identity(stat: { ino: bigint; mtimeNs: bigint; ctimeNs: bigint; size: bigint }): string {
  return `${stat.ino}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}`;
}
