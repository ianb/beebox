/**
 * The lazy search-index refresh — runs at every query.
 *
 * Restores the persisted index, diffs the manifest against the filesystem
 * (cards plus declared input files), re-extracts only what changed, and
 * persists when dirty. Correctness is at-query-time: no hooks, so `git mv`,
 * shell moves, connector writes, and uncommitted state are all covered.
 *
 * Concurrency: the whole refresh runs under the box's search lock with a
 * bounded retry. A process that can't get the lock serves results from the
 * last persisted index without refreshing — slightly stale, never broken.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { insertMultiple, remove } from "@orama/orama";
import { ParseError, type ElementSchema } from "cardworks";
import { acquireLock, releaseLock, LockHeldError } from "../../lib/file-lock.js";
import { loadCardFromText, CardIOError, type LoadCardContext } from "../card-io.js";
import {
  createSchemaRegistry,
  createCardSchemaMap,
  getSearchableTypes,
} from "../../schemas/registry.js";
import { extractCardDocs, declareInputFiles, type SearchDoc } from "./extract.js";
import { walkCardFiles, cardTypeFromPath, type CardStat } from "./walk.js";
import {
  loadManifest,
  saveManifest,
  emptyManifest,
  type SearchManifest,
  type ManifestFileEntry,
  type InputFileEntry,
} from "./manifest.js";
import {
  createSearchIndex,
  restoreSearchIndex,
  persistSearchIndex,
  hashContent,
  searchLockPath,
  type SearchIndex,
} from "./search-store.js";
import {
  loadContainsState,
  saveContainsState,
  computeContainsBasis,
  observeCard,
  dropCardState,
  type ContainsState,
} from "./contains-state.js";

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
    opts.onProgress?.(`building search index over ${String(total)} cards...`);
  }

  const containsState = await loadContainsState(boxRoot);
  const containsBefore = JSON.stringify(containsState.cards);

  // Cards that vanished (deleted or moved away).
  for (const [relPath, entry] of Object.entries(manifest.files)) {
    if (current.has(relPath)) continue;
    removeDocs(db, entry.docIds);
    delete manifest.files[relPath];
    dropCardState(containsState, relPath);
    dirtyIndex = true;
  }

  const state: RefreshState = { boxRoot, db, manifest, warnings, containsState, ctx: null };
  for (const [relPath, stat] of current) {
    const kind = cardTypeFromPath(relPath);
    if (kind === undefined || !searchable.has(kind)) {
      // Includes types that left the searchable set: drop their docs.
      if (dropCard(state, relPath)) dirtyIndex = true;
      continue;
    }
    const effect = await refreshOneCard(state, { relPath, stat });
    if (effect === "index") dirtyIndex = true;
    else if (effect === "manifest") dirtyManifest = true;
  }

  if (dirtyIndex) {
    // Index first, manifest last: a crash between the two leaves an older
    // manifest, and the affected files simply re-extract next refresh.
    await persistSearchIndex(db, boxRoot);
  }
  if (dirtyIndex || dirtyManifest) {
    await saveManifest(boxRoot, manifest);
  }
  if (JSON.stringify(containsState.cards) !== containsBefore) {
    await saveContainsState(boxRoot, containsState);
  }
  return { db, warnings, stale: false };
}

interface RefreshState {
  boxRoot: string;
  db: SearchIndex;
  manifest: SearchManifest;
  warnings: string[];
  containsState: ContainsState;
  ctx: LoadCardContext | null;
}

type RefreshEffect = "none" | "manifest" | "index";

/** Remove a card's docs + manifest entry. Returns true when anything was dropped. */
function dropCard(state: RefreshState, relPath: string): boolean {
  const entry = state.manifest.files[relPath];
  dropCardState(state.containsState, relPath);
  if (entry === undefined) return false;
  removeDocs(state.db, entry.docIds);
  delete state.manifest.files[relPath];
  return true;
}

/** Bring one (searchable) card up to date in the index. */
async function refreshOneCard(
  state: RefreshState,
  { relPath, stat }: { relPath: string; stat: CardStat }
): Promise<RefreshEffect> {
  const { boxRoot, db, manifest, warnings } = state;
  const entry = manifest.files[relPath];
  const statChanged =
    entry === undefined || entry.mtimeMs !== stat.mtimeMs || entry.size !== stat.size;
  const inputsChanged = entry === undefined ? false : await anyInputChanged(boxRoot, entry);
  if (!statChanged && !inputsChanged) return "none";

  let content: string;
  try {
    content = await fs.readFile(path.join(boxRoot, relPath), "utf8");
  } catch (e) {
    warnings.push(`${relPath}: unreadable (${(e as Error).message})`);
    return "none";
  }
  const contentHash = hashContent(content);
  if (entry !== undefined && !inputsChanged && entry.contentHash === contentHash) {
    // Touched but unchanged (e.g. git checkout): refresh stat bookkeeping only.
    manifest.files[relPath] = { ...entry, mtimeMs: stat.mtimeMs, size: stat.size };
    return "manifest";
  }

  if (state.ctx === null) state.ctx = await buildLoadContext(boxRoot);
  let docs: SearchDoc[];
  let inputs: Record<string, InputFileEntry>;
  try {
    const card = await loadCardFromText({ content, source: relPath, ctx: state.ctx });
    const inputRead = await readInputFiles(boxRoot, declareInputFiles({ path: relPath, card }));
    inputs = inputRead.entries;
    warnings.push(...inputRead.warnings);
    docs = extractCardDocs({ path: relPath, card, contentHash, inputContents: inputRead.contents });
    const basis = computeContainsBasis({ card, inputContents: inputRead.contents });
    if (basis !== null) {
      const contains = card.kind === "frontmatter" && typeof card.fields["contains"] === "string"
        ? card.fields["contains"]
        : "";
      observeCard(state.containsState, { cardPath: relPath, contains, basis });
    }
  } catch (e) {
    // CardIOError: bad frontmatter/schema. ParseError: malformed XML body.
    // Either way the card is skipped with a warning — one broken card must
    // not take down search for the whole box. The skip is remembered in the
    // manifest so an unchanged broken card warns once, not on every search.
    if (!(e instanceof CardIOError) && !(e instanceof ParseError)) throw e;
    const detail = e instanceof CardIOError ? e.detail : e.message;
    warnings.push(`${relPath}: skipped (${detail})`);
    const hadDocs = dropCard(state, relPath);
    manifest.files[relPath] = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      contentHash,
      docIds: [],
      skipped: true,
    };
    return hadDocs ? "index" : "manifest";
  }

  if (entry !== undefined) removeDocs(db, entry.docIds);
  await insertMultiple(db, docs);
  const newEntry: ManifestFileEntry = {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    contentHash,
    docIds: docs.map((d) => d.id),
  };
  if (Object.keys(inputs).length > 0) newEntry.inputs = inputs;
  manifest.files[relPath] = newEntry;
  return "index";
}

function removeDocs(db: SearchIndex, docIds: string[]): void {
  for (const id of docIds) {
    remove(db, id);
  }
}

async function anyInputChanged(boxRoot: string, entry: ManifestFileEntry): Promise<boolean> {
  if (entry.inputs === undefined) return false;
  for (const [relPath, recorded] of Object.entries(entry.inputs)) {
    let stat: CardStat;
    try {
      const st = await fs.stat(path.join(boxRoot, relPath));
      stat = { mtimeMs: st.mtimeMs, size: st.size };
    } catch (_e) {
      return true; // input vanished
    }
    if (stat.mtimeMs !== recorded.mtimeMs || stat.size !== recorded.size) return true;
  }
  return false;
}

async function readInputFiles(
  boxRoot: string,
  declared: string[]
): Promise<{
  contents: Map<string, string>;
  entries: Record<string, InputFileEntry>;
  warnings: string[];
}> {
  const contents = new Map<string, string>();
  const entries: Record<string, InputFileEntry> = {};
  const warnings: string[] = [];
  for (const relPath of declared) {
    try {
      const abs = path.join(boxRoot, relPath);
      const content = await fs.readFile(abs, "utf8");
      const st = await fs.stat(abs);
      contents.set(relPath, content);
      entries[relPath] = {
        mtimeMs: st.mtimeMs,
        size: st.size,
        contentHash: hashContent(content),
      };
    } catch (e) {
      warnings.push(`${relPath}: input file unreadable (${(e as Error).message})`);
    }
  }
  return { contents, entries, warnings };
}

async function buildLoadContext(boxRoot: string): Promise<LoadCardContext> {
  const registry = await createSchemaRegistry(boxRoot);
  const elementSchemas = new Map<string, ElementSchema>();
  for (const tag of registry.tagNames()) {
    const schema = registry.get(tag);
    if (schema) elementSchemas.set(tag, schema as ElementSchema);
  }
  return { cardSchemas: createCardSchemaMap(), elementSchemas };
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
