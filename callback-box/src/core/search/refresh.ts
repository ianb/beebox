/**
 * The lazy search-index refresh — runs at every query.
 *
 * Restores the persisted index, diffs the manifest against the filesystem
 * (cards, standalone markdown files, declared input files), re-extracts
 * only what changed, and persists when dirty. Correctness is
 * at-query-time: no hooks, so `git mv`, shell moves, connector writes, and
 * uncommitted state are all covered.
 *
 * Concurrency: the whole refresh runs under the box's search lock with a
 * bounded retry. A process that can't get the lock serves results from the
 * last persisted index without refreshing — slightly stale, never broken.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { acquireLock, releaseLock, LockHeldError } from "../../lib/file-lock.js";
import { getSearchableTypes } from "../../schemas/registry.js";
import { buildLoadContext } from "../load-context.js";
import { walkCardFiles, cardTypeFromPath } from "./walk.js";
import { loadManifest, saveManifest, emptyManifest, type SearchManifest } from "./manifest.js";
import {
  createSearchIndex,
  restoreSearchIndex,
  persistSearchIndex,
  indexUnchanged,
  searchLockPath,
  type SearchIndex,
} from "./search-store.js";
import {
  loadContainsState,
  saveContainsState,
  computeBasisForCardPath,
  observeCard,
} from "./contains-state.js";
import {
  dropCard,
  refreshOneCard,
  refreshOneMarkdownFile,
  type RefreshState,
  type RefreshEffect,
} from "./refresh-file.js";

export interface OpenSearchIndexResult {
  db: SearchIndex;
  /** Cards skipped during refresh (unparseable, unreadable), human-readable. */
  warnings: string[];
  /** True when another process held the lock — results from the last persisted index. */
  stale: boolean;
}

export interface OpenSearchIndexOptions {
  /** Discard index + manifest and rebuild from scratch. */
  rebuild?: boolean;
  /** Lock acquisition attempts before serving stale (default 10). */
  lockRetries?: number;
  /** Delay between lock attempts in ms (default 500). */
  lockRetryMs?: number;
  onProgress?: (message: string) => void;
}

/**
 * Open the box's search index, refreshed to match the filesystem.
 */
export async function openSearchIndex(
  boxRoot: string,
  options?: OpenSearchIndexOptions
): Promise<OpenSearchIndexResult> {
  const opts = options ?? {};
  const lockPath = searchLockPath(boxRoot);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const locked = await lockWithRetry(lockPath, {
    retries: opts.lockRetries ?? 10,
    retryMs: opts.lockRetryMs ?? 500,
  });
  if (!locked) {
    const db = (await restoreSearchIndex(boxRoot)) ?? (await createSearchIndex());
    return { db, warnings: ["search index locked by another process; results may be stale"], stale: true };
  }
  try {
    return await refreshUnderLock(boxRoot, opts);
  } finally {
    await releaseLock(lockPath);
  }
}

async function refreshUnderLock(
  boxRoot: string,
  opts: OpenSearchIndexOptions
): Promise<OpenSearchIndexResult> {
  let manifest: SearchManifest = opts.rebuild ? emptyManifest() : await loadManifest(boxRoot);
  let db: SearchIndex | null = null;
  if (Object.keys(manifest.files).length > 0) {
    db = await restoreSearchIndex(boxRoot);
    if (db === null) manifest = emptyManifest(); // orphaned manifest: rebuild
  }
  if (db === null) db = await createSearchIndex();

  const current = await walkCardFiles(boxRoot);
  const searchable = new Set(await getSearchableTypes(boxRoot));
  const warnings: string[] = [];
  let dirtyIndex = false;
  let dirtyManifest = false;

  const total = current.size;
  if (Object.keys(manifest.files).length === 0 && total > 0) {
    opts.onProgress?.(`building search index over ${String(total)} files...`);
  }

  const containsState = await loadContainsState(boxRoot);
  const containsBefore = JSON.stringify(containsState.cards);
  const state: RefreshState = { boxRoot, db, manifest, warnings, containsState, ctx: null };

  // Files that vanished (deleted or moved away).
  for (const relPath of Object.keys(manifest.files)) {
    if (current.has(relPath)) continue;
    if (await dropCard(state, relPath)) dirtyIndex = true;
  }

  for (const [relPath, stat] of current) {
    let effect: RefreshEffect;
    if (relPath.endsWith(".md")) {
      effect = await refreshOneMarkdownFile(state, { relPath, stat });
    } else {
      const kind = cardTypeFromPath(relPath);
      if (kind === undefined || !searchable.has(kind)) {
        // Includes types that left the searchable set: drop their docs.
        if (await dropCard(state, relPath)) dirtyIndex = true;
        continue;
      }
      effect = await refreshOneCard(state, { relPath, stat });
    }
    if (effect === "index") dirtyIndex = true;
    else if (effect === "manifest") dirtyManifest = true;
  }

  // Indexed cards the sidecar has never observed (index predates the
  // sidecar, or the state file was deleted): observe them now so
  // missing/stale lists are complete. No-op when the sidecar is current.
  await healContainsState(state);

  if (dirtyIndex) {
    // Index first, manifest last: a crash between the two leaves an older
    // manifest, and the affected files simply re-extract next refresh. The
    // ordering is enforced by the type system — saveManifest requires the
    // receipt persistSearchIndex returns, so the manifest can't be written
    // ahead of the index. A persist failure is downgraded to a warning — the
    // in-memory index still answers this query; the next refresh retries.
    try {
      const indexProof = await persistSearchIndex(db, boxRoot);
      await saveManifest(boxRoot, { manifest, indexProof });
    } catch (e) {
      warnings.push(`could not persist search index (${(e as Error).message}); results served from memory`);
    }
  } else if (dirtyManifest) {
    // No document changed — only stat/mtime or skip records moved. The index
    // (restored, or an empty fresh one) already reflects the manifest's doc ids,
    // so a manifest-only write is safe; indexUnchanged mints the receipt.
    await saveManifest(boxRoot, { manifest, indexProof: indexUnchanged(boxRoot) });
  }
  if (JSON.stringify(containsState.cards) !== containsBefore) {
    await saveContainsState(boxRoot, containsState);
  }
  return { db, warnings, stale: false };
}

/** Observe manifest-indexed frontmatter cards the contains sidecar doesn't know yet. */
async function healContainsState(state: RefreshState): Promise<void> {
  const { boxRoot, manifest, containsState } = state;
  for (const [relPath, entry] of Object.entries(manifest.files)) {
    if (entry.skipped === true) continue;
    if (containsState.cards[relPath] !== undefined) continue;
    const kind = cardTypeFromPath(relPath);
    if (kind === undefined) continue;
    if (state.ctx === null) state.ctx = await buildLoadContext(boxRoot);
    if (!state.ctx.cardSchemas.has(kind)) continue; // XML kinds can't carry contains
    const { basis, contains } = await computeBasisForCardPath(boxRoot, {
      relPath,
      ctx: state.ctx,
    });
    if (basis === null) continue; // unreadable/unparseable: lint owns reporting that
    observeCard(containsState, { cardPath: relPath, contains, basis });
  }
}

async function lockWithRetry(
  lockPath: string,
  { retries, retryMs }: { retries: number; retryMs: number }
): Promise<boolean> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await acquireLock(lockPath, { purpose: "search-index" });
      return true;
    } catch (e) {
      if (!(e instanceof LockHeldError)) throw e;
      if (attempt < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, retryMs));
      }
    }
  }
  return false;
}
