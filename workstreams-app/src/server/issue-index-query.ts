/**
 * Ranking over the issue index: BM25, vector, or the hybrid of the two.
 *
 * The caller resolves the mode and supplies the query vector; this module
 * only runs the search and post-filters by path. Answering a semantic request
 * with BM25 is the failure the whole layer exists to avoid, so a missing
 * vector is thrown rather than degraded.
 */

import { search, type Results, type TypedDocument } from "@orama/orama";

import type { IssueIndex } from "./issue-index.js";
import type { IndexKind } from "./issue-index-documents.js";

type IssueDoc = TypedDocument<IssueIndex>;

/** Full-text properties searched, and their retrieval weights. */
const TEXT_PROPERTIES = ["title", "body"] as const;
const BOOST = { title: 2 } as const;

/**
 * Vector-half cosine cutoff. Same value and rationale as callback-box's search
 * (`core/search/query.ts`): Orama's 0.8 default excludes nearly every real
 * text-embedding-3-small match, so the vector half would contribute nothing.
 */
const SIMILARITY = 0.35;

export type SearchMode = "text" | "hybrid" | "semantic";

/**
 * A vector mode was asked for with no query vector. The caller resolves the
 * mode, so this is a programming error rather than a degraded state — the
 * mode it asked for rides on the error instead of in the message.
 */
export class MissingQueryVectorError extends Error {
  readonly mode: SearchMode;
  constructor(mode: SearchMode) {
    super("issues index: vector ranking was requested without a query vector");
    this.name = "MissingQueryVectorError";
    this.mode = mode;
  }
}

export interface IndexHit {
  score: number;
  path: string;
  title: string;
  kind: IndexKind;
}

export interface RunSearchOptions {
  db: IssueIndex;
  mode: SearchMode;
  /** Required for `text` and `hybrid`. */
  term?: string;
  /** Required for `hybrid` and `semantic`. */
  vector?: number[] | undefined;
  where?: Record<string, unknown>;
  /**
   * Maximum hits returned. A caller that post-filters must pass its whole
   * budget here, not the page size — this function knows nothing about the
   * caller's filters and cannot make room for them.
   */
  limit: number;
  /** Paths never returned — the query document itself, and unembedded documents. */
  exclude?: Set<string>;
  /** When set, only these paths may appear (vector ranking over embedded docs). */
  eligible?: Set<string>;
}

/** Over-fetch so post-filtering by path still fills the requested limit. */
const FETCH_MULTIPLIER = 5;

async function rank(options: RunSearchOptions): Promise<Results<IssueDoc>> {
  const { db, mode, where, limit } = options;
  const fetchLimit = Math.max(limit * FETCH_MULTIPLIER, limit + 20);
  const common = { limit: fetchLimit, ...(where && Object.keys(where).length > 0 ? { where } : {}) };
  const term = options.term ?? "";
  const vector = options.vector;
  if (mode === "text" || vector === undefined) {
    return search(db, { term, properties: [...TEXT_PROPERTIES], boost: BOOST, ...common });
  }
  if (mode === "semantic") {
    return search(db, {
      mode: "vector", vector: { value: vector, property: "embedding" }, similarity: SIMILARITY, ...common,
    });
  }
  return search(db, {
    mode: "hybrid", term, vector: { value: vector, property: "embedding" },
    similarity: SIMILARITY, properties: [...TEXT_PROPERTIES], boost: BOOST, ...common,
  });
}

export async function runSearch(options: RunSearchOptions): Promise<IndexHit[]> {
  if (options.mode !== "text" && options.vector === undefined) {
    // Silently answering a semantic request with BM25 is the failure this
    // whole layer exists to avoid; the caller resolves the mode, so reaching
    // here without a vector is a programming error, not a degraded state.
    throw new MissingQueryVectorError(options.mode);
  }
  const results = await rank(options);
  const hits: IndexHit[] = [];
  for (const hit of results.hits) {
    const document = hit.document;
    if (options.exclude?.has(document.path) === true) continue;
    if (options.eligible !== undefined && !options.eligible.has(document.path)) continue;
    hits.push({
      score: hit.score,
      path: document.path,
      title: document.title,
      kind: document.kind === "doc" ? "doc" : "issue",
    });
    if (hits.length >= options.limit) break;
  }
  return hits;
}
