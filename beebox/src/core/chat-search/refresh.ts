/**
 * The lazy chat-search-index refresh — runs at every chat query, mirroring
 * the card index's `search/refresh/core.ts` shape: restore the persisted
 * index, diff the manifest against the chat enumeration, chunk only what
 * changed, persist when dirty. A chat from this morning is findable on the
 * next search; no scheduler.
 *
 * The diff key is per-session: unchanged transcript mtime (Claude stat /
 * Codex thread `updatedAt`) ⇒ skip; otherwise parse the transcript, chunk
 * from the recorded entry cursor, and insert only the new tail. A manifest
 * entry whose cursor now EXCEEDS the transcript's entry count marks a
 * rewrite — that session's docs are dropped and rebuilt from zero.
 *
 * Concurrency: the whole refresh runs under `chat-search.lock` with a
 * bounded retry; a process that can't get the lock serves the last persisted
 * index without refreshing — slightly stale, never broken.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { insert, remove } from "@orama/orama";
import { MAX_SESSION_ENTRIES, parseSessionLog, type SessionEntry } from "../../cli/lib/session.js";
import { releaseLock } from "../../lib/file-lock.js";
import { listSessionEntries, type ChatSessionEntry } from "../chat/session/list/core.js";
import {
  codexSessionExists,
  readCodexSessionHistory,
} from "../chat/session/codex-transcript.js";
import { lockWithRetry } from "../search/refresh/core.js";
import { indexPersistedFor } from "../search/store/index-store.js";
import { errorMessage, errnoCode } from "../../shared/error-guards.js";
import { assertNever } from "../../shared/invariant.js";
import { chunkSessionEntries } from "./extract.js";
import {
  loadChatManifest,
  saveChatManifest,
  emptyChatManifest,
  type ChatManifest,
  type ChatManifestSession,
} from "./manifest.js";
import { chatSearchStore, type ChatSearchIndex } from "./store.js";

export interface OpenChatSearchIndexResult {
  db: ChatSearchIndex;
  /** Human-readable degradations (transcript read failures, codex down). */
  warnings: string[];
  /** True when another process held the lock — results from the last persisted index. */
  stale: boolean;
}

export interface OpenChatSearchIndexOptions {
  /** Discard index + manifest and rebuild from scratch. */
  rebuild?: boolean;
  /** Lock acquisition attempts before serving stale (default 10). */
  lockRetries?: number;
  /** Delay between lock attempts in ms (default 500). */
  lockRetryMs?: number;
  onProgress?: (message: string) => void;
}

/** Shared mutable state of one refresh, so helpers stay under the param cap. */
interface RefreshState {
  boxRoot: string;
  db: ChatSearchIndex;
  manifest: ChatManifest;
  warnings: string[];
}

/** Read a whole transcript as displayable entries, paging the bounded scan. */
async function readAllEntries(
  readPage: (offset: number) => Promise<{ entries: SessionEntry[]; total: number }>
): Promise<SessionEntry[]> {
  let page = await readPage(0);
  const entries: SessionEntry[] = [...page.entries];
  while (entries.length < page.total) {
    page = await readPage(entries.length);
    if (page.entries.length === 0) break; // byte-budget stop before total: take what parsed
    entries.push(...page.entries);
  }
  return entries;
}

async function claudeEntries(logPath: string): Promise<SessionEntry[]> {
  return readAllEntries((offset) =>
    parseSessionLog({
      logPath,
      slice: { mode: "page", offset, limit: MAX_SESSION_ENTRIES },
    }));
}

async function codexEntries(boxRoot: string, sessionId: string): Promise<SessionEntry[]> {
  return readAllEntries((offset) =>
    readCodexSessionHistory({
      boxRoot,
      sessionId,
      slice: { mode: "page", offset, limit: MAX_SESSION_ENTRIES },
    }));
}

function transcriptEntries(boxRoot: string, entry: ChatSessionEntry): Promise<SessionEntry[]> {
  switch (entry.engine) {
    case "claude":
      return claudeEntries(entry.logPath);
    case "codex":
      return codexEntries(boxRoot, entry.sessionId);
    default:
      return assertNever(entry.engine);
  }
}

/** Remove a session's docs from the index and its record from the manifest. */
async function dropSession(
  state: RefreshState,
  { sessionId, docIds }: { sessionId: string; docIds: string[] }
): Promise<boolean> {
  let dirty = false;
  for (const docId of docIds) {
    try {
      await remove(state.db, docId);
      dirty = true;
    } catch (e) {
      // Already absent (crash between index and manifest write, or a rebuild
      // racing this drop) — the doc id set converges either way.
      console.debug(`chat-search: drop of absent doc ${docId}: ${errorMessage(e)}`);
    }
  }
  delete state.manifest.sessions[sessionId];
  return dirty;
}

/**
 * Open the box's chat search index, refreshed to match the chat enumeration.
 */
export async function openChatSearchIndex(
  boxRoot: string,
  options?: OpenChatSearchIndexOptions
): Promise<OpenChatSearchIndexResult> {
  const opts = options ?? {};
  const lockPath = chatSearchStore.lockPath(boxRoot);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const locked = await lockWithRetry(lockPath, {
    retries: opts.lockRetries ?? 10,
    retryMs: opts.lockRetryMs ?? 500,
  });
  if (!locked) {
    const db = (await chatSearchStore.restore(boxRoot)) ?? (await chatSearchStore.create());
    return {
      db,
      warnings: ["chat search index locked by another process; results may be stale"],
      stale: true,
    };
  }
  try {
    return await refreshUnderLock(boxRoot, opts);
  } finally {
    await releaseLock(lockPath);
  }
}

async function refreshUnderLock(
  boxRoot: string,
  opts: OpenChatSearchIndexOptions
): Promise<OpenChatSearchIndexResult> {
  let manifest: ChatManifest = opts.rebuild ? emptyChatManifest() : await loadChatManifest(boxRoot);
  let db: ChatSearchIndex | null = null;
  if (Object.keys(manifest.sessions).length > 0) {
    db = await chatSearchStore.restore(boxRoot);
    if (db === null) manifest = emptyChatManifest(); // orphaned manifest: rebuild
  }
  if (db === null) db = await chatSearchStore.create();

  const state: RefreshState = { boxRoot, db, manifest, warnings: [] };
  let dirtyIndex = false;
  let dirtyManifest = false;

  const live = await listSessionEntries(boxRoot);
  const liveById = new Map(live.map((entry) => [entry.sessionId, entry]));
  if (Object.keys(manifest.sessions).length === 0 && live.length > 0) {
    opts.onProgress?.(`Building the chat search index over ${String(live.length)} chats...`);
  }

  // Sessions whose husk or transcript is gone from the enumeration.
  for (const [sessionId, record] of Object.entries(state.manifest.sessions)) {
    if (liveById.has(sessionId)) continue;
    if (await codexRemains(state, { sessionId, record })) continue;
    if (await dropSession(state, { sessionId, docIds: record.docIds })) dirtyIndex = true;
    dirtyManifest = true;
  }

  for (const entry of live) {
    const prev = state.manifest.sessions[entry.sessionId];
    if (prev !== undefined && prev.mtimeMs === entry.mtime.getTime()) continue;
    const effect = await refreshOneSession(state, { entry, prev });
    if (effect === "index") dirtyIndex = true;
    else if (effect === "manifest") dirtyManifest = true;
  }

  if (dirtyIndex) {
    const indexProof = await chatSearchStore.persist(db, boxRoot);
    await saveChatManifest(boxRoot, { manifest: state.manifest, indexProof });
  } else if (dirtyManifest) {
    await saveChatManifest(boxRoot, {
      manifest: state.manifest,
      indexProof: indexPersistedFor(boxRoot),
    });
  }
  return { db, warnings: state.warnings, stale: false };
}

type SessionEffect = "index" | "manifest" | "none";

/**
 * Whether a codex session missing from the enumeration must be KEPT: the
 * enumeration omits codex chats entirely when the app-server is down, which
 * is not "the thread is gone". Confirms against Codex itself; a clean "no
 * such thread" returns false (drop), anything else keeps the docs with a
 * warning so a listing hiccup can't silently erase indexed history.
 */
async function codexRemains(
  state: RefreshState,
  { sessionId, record }: { sessionId: string; record: ChatManifestSession }
): Promise<boolean> {
  if (record.engine !== "codex") return false;
  let exists: boolean;
  try {
    exists = await codexSessionExists(state.boxRoot, sessionId);
  } catch (e) {
    state.warnings.push(
      `codex unavailable (${errorMessage(e)}); kept chat ${sessionId.slice(0, 8)}'s indexed chunks`
    );
    return true;
  }
  if (exists) {
    state.warnings.push(
      `codex thread ${sessionId.slice(0, 8)} missing from the listing; kept its indexed chunks`
    );
    return true;
  }
  return false;
}

/** Chunk one session's new tail into the index, or rebuild it on a rewrite. */
async function refreshOneSession(
  state: RefreshState,
  { entry, prev }: { entry: ChatSessionEntry; prev: ChatManifestSession | undefined }
): Promise<SessionEffect> {
  let entries: SessionEntry[];
  try {
    entries = await transcriptEntries(state.boxRoot, entry);
  } catch (e) {
    if (errnoCode(e) === "ENOENT") {
      // Vanished between enumerate and read — the removal pass would reach
      // the same end state next refresh; drop now so it converges today.
      if (prev === undefined) return "none";
      const dropped = await dropSession(state, { sessionId: entry.sessionId, docIds: prev.docIds });
      return dropped ? "index" : "manifest";
    }
    state.warnings.push(
      `${entry.sessionId.slice(0, 8)}: could not read transcript (${errorMessage(e)}); skipped`
    );
    return "none";
  }

  let fromIndex = prev?.entryCount ?? 0;
  let keptDocIds = prev?.docIds ?? [];
  if (entries.length < fromIndex) {
    // The transcript got SHORTER — a rewrite (compaction edit, resume from a
    // fresh file). Old chunks may point at material that no longer exists.
    for (const docId of keptDocIds) {
      try {
        await remove(state.db, docId);
      } catch (_e) {
        // Absent already; the doc id set converges.
      }
    }
    fromIndex = 0;
    keptDocIds = [];
  }

  const docs = chunkSessionEntries({
    sessionId: entry.sessionId,
    title: entry.title ?? "",
    entries,
    fromIndex,
  });
  for (const doc of docs) {
    try {
      await insert(state.db, doc);
    } catch (e) {
      state.warnings.push(
        `${entry.sessionId.slice(0, 8)}: could not index a chunk (${errorMessage(e)}); skipped`
      );
      return "none";
    }
  }
  state.manifest.sessions[entry.sessionId] = {
    engine: entry.engine,
    huskPath: entry.huskPath,
    mtimeMs: entry.mtime.getTime(),
    entryCount: entries.length,
    docIds: [...keptDocIds, ...docs.map((doc) => doc.id)],
  };
  return docs.length > 0 || fromIndex === 0 ? "index" : "manifest";
}
