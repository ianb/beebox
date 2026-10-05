/**
 * The chat search query layer over the lazily-refreshed chat index:
 * full-text search, one result row per chat (its best chunk), recency as
 * the tiebreak, and a snippet around the first query match.
 *
 * Text-only by design (boxholder decision 2026-09-28): no embeddings, no
 * key resolution, nothing leaves the box.
 */

import { search, type TypedDocument } from "@orama/orama";
import { generateExcerpt } from "../search/query/excerpt.js";
import { openChatSearchIndex } from "./refresh.js";
import type { ChatSearchIndex } from "./store.js";

/** Search-time field weights: the chat's title is rarer signal than body text. */
const BOOST = { title: 2 } as const;

/** Full-text properties searched. */
const TEXT_PROPERTIES = ["title", "content"] as const;

const DEFAULT_LIMIT = 10;
/**
 * Fetch budget before per-chat dedupe: a chat with many matching chunks
 * would otherwise crowd the window before other chats get a single hit.
 */
const DEDUPE_FETCH = 200;

export interface ChatSearchHit {
  /** Engine session id — opens `/chat?session=<id>&m=<anchor>`. */
  sessionId: string;
  /** Entry uuid of the matched chunk — the deep-link anchor. */
  anchor: string;
  /** Chat title as of indexing; callers join live labels when they have them. */
  title: string;
  /** Snippet around the first query match in the chunk. */
  snippet: string;
  /** ISO timestamp of the matched chunk's anchor entry. */
  created: string;
  score: number;
}

export interface ChatSearchResult {
  results: ChatSearchHit[];
  /** Count of DISTINCT CHATS that matched, post-dedupe. */
  total: number;
  truncated: boolean;
  warnings: string[];
  /** True when the index lock was contended and results may be slightly stale. */
  stale: boolean;
}

export interface ChatSearchOptions {
  query: string;
  limit?: number;
  lockRetries?: number;
  lockRetryMs?: number;
}

/** Sort: score descending, then the newer conversation wins a tie. */
function byScoreThenRecency(a: ChatSearchHit, b: ChatSearchHit): number {
  return b.score - a.score || b.created.localeCompare(a.created);
}

/**
 * Fold raw chunk hits into one hit per chat, keeping the best-scoring chunk.
 * Pure — exported for doctests.
 */
function dedupeBySession(hits: ChatSearchHit[]): ChatSearchHit[] {
  const best = new Map<string, ChatSearchHit>();
  for (const hit of hits) {
    const current = best.get(hit.sessionId);
    if (current === undefined || byScoreThenRecency(hit, current) < 0) {
      best.set(hit.sessionId, hit);
    }
  }
  return [...best.values()].toSorted(byScoreThenRecency);
}

/** Search the box's chat transcripts. An empty/blank query matches nothing. */
export async function searchChats(
  boxRoot: string,
  options: ChatSearchOptions
): Promise<ChatSearchResult> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const term = options.query.trim();
  if (term === "") {
    return { results: [], total: 0, truncated: false, warnings: [], stale: false };
  }
  const { db, warnings, stale } = await openChatSearchIndex(boxRoot, {
    ...(options.lockRetries !== undefined ? { lockRetries: options.lockRetries } : {}),
    ...(options.lockRetryMs !== undefined ? { lockRetryMs: options.lockRetryMs } : {}),
  });

  const raw = await search(db, {
    term,
    properties: [...TEXT_PROPERTIES],
    boost: BOOST,
    limit: DEDUPE_FETCH,
  });

  const hits = raw.hits.map((h): ChatSearchHit => {
    const doc = chatChunkDoc(h.document);
    return {
      sessionId: doc.sessionId,
      anchor: doc.anchor,
      title: doc.title,
      snippet: generateExcerpt(doc.content, term),
      created: doc.created,
      score: h.score,
    };
  });
  const deduped = dedupeBySession(hits);
  const results = deduped.slice(0, limit);
  return {
    results,
    total: deduped.length,
    truncated: deduped.length > results.length,
    warnings,
    stale,
  };
}

/**
 * Orama types a hit's document from the index schema (`TypedDocument`), whose
 * fields are already strings in this schema (no enum widening like the card
 * index's `kind`); the doc id is Orama's `string | number`, normalized here.
 */
function chatChunkDoc(doc: TypedDocument<ChatSearchIndex>): {
  sessionId: string;
  anchor: string;
  title: string;
  content: string;
  created: string;
  id: string;
} {
  return {
    id: typeof doc.id === "string" ? doc.id : String(doc.id),
    sessionId: doc.sessionId,
    anchor: doc.anchor,
    title: doc.title,
    content: doc.content,
    created: doc.created,
  };
}
