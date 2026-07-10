/**
 * The search query layer over the lazily-refreshed index: kind validation
 * (fail before the refresh side effect), boosted full-text search, path
 * filtering, and bounded results with a narrowing hint.
 */

import { search } from "@orama/orama";
import { getSearchableTypes } from "../../schemas/registry.js";
import { invariant } from "../../lib/invariant.js";
import { getOpenAiEmbeddingsKey } from "./embeddings-key.js";
import {
  createOpenAIEmbeddingsService,
  EmbeddingsError,
  type EmbeddingsService,
} from "../../services/openai-embeddings.js";
import { openSearchIndex, type OpenSearchIndexOptions } from "./refresh.js";
import { generateExcerpt } from "./excerpt.js";
import { MARKDOWN_KIND, type SearchDoc } from "./extract.js";

/** Search-time field weights: `contains` is the prime retrieval field. */
const BOOST = { contains: 3, title: 2 } as const;

/**
 * Vector-half cosine cutoff for hybrid search. Tuned while dogfooding against
 * the large box copy (see docs/plans/semantic-search.md): Orama's 0.8 default
 * filters out nearly every real OpenAI-embedding match — cosine similarities
 * for related texts run 0.2-0.5 — so leaving the default would make the vector
 * half silently contribute nothing. Fusion weights stay at Orama's 0.5/0.5
 * default (we deliberately do NOT pass `hybridWeights`).
 */
const SIMILARITY = 0.35;

const DEFAULT_LIMIT = 10;
/** Fetch budget when a post-search path filter needs headroom. */
const PATH_FILTER_FETCH = 1000;

/** Full-text properties searched (the text half of hybrid, and the text mode). */
const TEXT_PROPERTIES = ["title", "contains", "content"] as const;

/** An unknown --kind value; carries the valid set for the error message. */
export class UnknownKindError extends Error {
  readonly kind: string;
  readonly validKinds: string[];
  constructor(kind: string, validKinds: string[]) {
    super(`unknown kind "${kind}" — valid kinds: ${validKinds.join(", ")}`);
    this.name = "UnknownKindError";
    this.kind = kind;
    this.validKinds = validKinds;
  }
}

export interface SearchHit {
  path: string;
  fragment: string;
  kind: string;
  title: string;
  contains: string;
  excerpt: string;
  score: number;
}

/**
 * Explicit `--mode hybrid` when hybrid ranking can't run — no key configured,
 * or the corpus isn't fully embedded yet. `detail` is built by the caller from
 * structured data (never a literal) and names the fix, so the CLI can surface
 * it verbatim.
 */
export class HybridUnavailableError extends Error {
  constructor(detail: string) {
    super(`hybrid search unavailable: ${detail}`);
    this.name = "HybridUnavailableError";
  }
}

export interface SearchBoxResult {
  results: SearchHit[];
  total: number;
  truncated: boolean;
  hint?: string;
  warnings: string[];
  /** True when the index lock was contended and results may be slightly stale. */
  stale: boolean;
  /** Which ranking answered: hybrid (BM25 + vector fused) or text-only. */
  searchMode: "hybrid" | "text";
  /** True when a configured embedder holds a current vector for every card. */
  embeddingsReady: boolean;
}

export interface SearchBoxOptions {
  query: string;
  /** Restrict to these card types (validated against the searchable set). */
  kinds?: string[];
  /** Restrict to paths starting with this box-relative prefix. */
  pathPrefix?: string;
  limit?: number;
  rebuild?: boolean;
  onProgress?: OpenSearchIndexOptions["onProgress"];
  /**
   * Injected embeddings service (doctests pass the fake). When absent,
   * searchBox resolves the box's key itself and builds the real service when
   * one is configured; a malformed secret file throws `EmbeddingsKeyError`.
   */
  embeddings?: EmbeddingsService | undefined;
  /**
   * `text` forces full-text ranking (offline, deterministic); `hybrid` forces
   * semantic ranking and fails loudly when it can't run; omitted = auto
   * (hybrid when a service is configured and the corpus is fully embedded).
   */
  mode?: "text" | "hybrid" | undefined;
}

export async function searchBox(
  boxRoot: string,
  options: SearchBoxOptions
): Promise<SearchBoxResult> {
  const { query, kinds, pathPrefix, mode } = options;
  const limit = options.limit ?? DEFAULT_LIMIT;

  // Validate kinds before the refresh touches anything on disk.
  if (kinds !== undefined && kinds.length > 0) {
    const valid = [...(await getSearchableTypes(boxRoot)), MARKDOWN_KIND];
    for (const kind of kinds) {
      if (!valid.includes(kind)) throw new UnknownKindError(kind, valid.toSorted());
    }
  }

  // Resolve the embeddings service: the injected one, or one built from the
  // box's configured key. A malformed secret file throws EmbeddingsKeyError
  // (loud, typed) rather than degrading — a config error the user must see.
  // `--mode text` skips ALL of this: no key resolution, no service into the
  // refresh — text mode is offline and deterministic (never a paid call, and
  // it must keep working with a broken secret file).
  let service = mode === "text" ? undefined : options.embeddings;
  if (service === undefined && mode !== "text") {
    const key = await getOpenAiEmbeddingsKey(boxRoot);
    if (key !== null) service = createOpenAIEmbeddingsService(key);
  }

  const openOpts: OpenSearchIndexOptions = {};
  if (options.rebuild !== undefined) openOpts.rebuild = options.rebuild;
  if (options.onProgress !== undefined) openOpts.onProgress = options.onProgress;
  if (service !== undefined) openOpts.embeddings = service;
  const { db, warnings, stale, embeddingsReady } = await openSearchIndex(boxRoot, openOpts);

  // Decide the ranking and, when hybrid, embed the query. Orama throws a raw
  // TypeError if `mode: "hybrid"` runs without a vector, so the branch is
  // explicit: a query vector is built only when hybrid actually applies.
  const { searchMode, queryVector } = await resolveRanking({
    mode,
    query,
    service,
    embeddingsReady,
    warnings,
  });

  const where =
    kinds !== undefined && kinds.length > 0 ? { where: { kind: { in: kinds } } } : {};
  const fetchLimit = pathPrefix !== undefined ? PATH_FILTER_FETCH : limit;
  const raw =
    searchMode === "hybrid" && queryVector !== undefined
      ? await search(db, {
          mode: "hybrid",
          term: query,
          vector: { value: queryVector, property: "embedding" },
          similarity: SIMILARITY,
          properties: [...TEXT_PROPERTIES],
          boost: BOOST,
          limit: fetchLimit,
          ...where,
        })
      : await search(db, {
          term: query,
          properties: [...TEXT_PROPERTIES],
          boost: BOOST,
          limit: fetchLimit,
          ...where,
        });

  let hits = raw.hits;
  let total = raw.count;
  if (pathPrefix !== undefined) {
    hits = hits.filter((h) => hitDoc(h).path.startsWith(pathPrefix));
    total = hits.length;
  }
  hits = hits.slice(0, limit);

  const results = hits.map((h): SearchHit => {
    const doc = hitDoc(h);
    return {
      path: doc.path,
      fragment: doc.fragment,
      kind: doc.kind,
      title: doc.title,
      contains: doc.contains,
      excerpt: generateExcerpt(doc.content !== "" ? doc.content : doc.contains, query),
      score: h.score,
    };
  });

  const truncated = total > results.length;
  const result: SearchBoxResult = {
    results,
    total,
    truncated,
    warnings,
    stale,
    searchMode,
    embeddingsReady,
  };
  if (truncated) {
    result.hint = "narrow with --kind <type> or --path <prefix>, or raise --limit";
  }
  return result;
}

/**
 * Choose text vs hybrid ranking and, for hybrid, embed the query.
 *
 * - `text`: always full-text, no embed call, no vector warnings.
 * - `hybrid` (explicit): the user wants vector ranking or an explanation, never
 *   a silent text fallback — throw HybridUnavailableError when it can't run, and
 *   let a query-embed EmbeddingsError propagate.
 * - auto (omitted): hybrid when a service is configured AND the corpus is fully
 *   embedded; a query-embed failure warns and falls back to text; a configured
 *   but not-ready service adds one warning (unless the refresh already warned
 *   about embeddings); no service falls back silently (the designed normal).
 */
async function resolveRanking({
  mode,
  query,
  service,
  embeddingsReady,
  warnings,
}: {
  mode: "text" | "hybrid" | undefined;
  query: string;
  service: EmbeddingsService | undefined;
  embeddingsReady: boolean;
  warnings: string[];
}): Promise<{ searchMode: "hybrid" | "text"; queryVector: number[] | undefined }> {
  if (mode === "text") return { searchMode: "text", queryVector: undefined };

  if (mode === "hybrid") {
    if (service === undefined) {
      const noKeyDetail =
        "no embeddings key configured — set config/connectors/openai.secret.json " +
        "or CALLBACK_OPENAI_API_KEY, or search with --mode text";
      throw new HybridUnavailableError(noKeyDetail);
    }
    if (!embeddingsReady) {
      // Surface the refresh-side cause (401, timeout, …) when there is one —
      // the generic message alone would swallow the actionable warning.
      const cause = warnings.find(isEmbeddingsWarning);
      const notReadyDetail =
        cause !== undefined
          ? `semantic index not ready (${cause}); retry, or search with --mode text`
          : "semantic index not ready; run cb search again after embedding completes, " +
            "or search with --mode text";
      throw new HybridUnavailableError(notReadyDetail);
    }
    const queryVector = await embedQuery(service, query); // EmbeddingsError propagates
    return { searchMode: "hybrid", queryVector };
  }

  // auto
  if (service !== undefined && embeddingsReady) {
    try {
      const queryVector = await embedQuery(service, query);
      return { searchMode: "hybrid", queryVector };
    } catch (e) {
      if (!(e instanceof EmbeddingsError)) throw e;
      warnings.push(`query embedding failed (${e.message}) — results are text-ranked`);
      return { searchMode: "text", queryVector: undefined };
    }
  }
  if (service !== undefined && !embeddingsReady && !warnings.some(isEmbeddingsWarning)) {
    warnings.push("semantic index not ready — results are text-ranked");
  }
  return { searchMode: "text", queryVector: undefined };
}

/** Embed a single query string; asserts the service returned one vector. */
async function embedQuery(service: EmbeddingsService, query: string): Promise<number[]> {
  const vectors = await service.embed([query]);
  const vector = vectors[0];
  invariant(vector !== undefined, "embed([query]) returned no vector");
  return vector;
}

/** Whether the refresh already surfaced an embeddings-related warning. */
function isEmbeddingsWarning(warning: string): boolean {
  return warning.includes("embeddings") || warning.includes("semantic");
}

/**
 * Orama hands documents back untyped; every doc in this index was inserted
 * as a SearchDoc (extract.ts), so this is the one place that re-asserts it.
 */
function hitDoc(hit: { document: unknown }): SearchDoc {
  return hit.document as SearchDoc;
}
