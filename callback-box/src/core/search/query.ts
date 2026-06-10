/**
 * The search query layer over the lazily-refreshed index: kind validation
 * (fail before the refresh side effect), boosted full-text search, path
 * filtering, and bounded results with a narrowing hint.
 */

import { search } from "@orama/orama";
import { getSearchableTypes } from "../../schemas/registry.js";
import { openSearchIndex, type OpenSearchIndexOptions } from "./refresh.js";
import { generateExcerpt } from "./excerpt.js";
import type { SearchDoc } from "./extract.js";

/** Search-time field weights: `contains` is the prime retrieval field. */
const BOOST = { contains: 3, title: 2 } as const;

const DEFAULT_LIMIT = 10;
/** Fetch budget when a post-search path filter needs headroom. */
const PATH_FILTER_FETCH = 1000;

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

export interface SearchBoxResult {
  results: SearchHit[];
  total: number;
  truncated: boolean;
  hint?: string;
  warnings: string[];
  /** True when the index lock was contended and results may be slightly stale. */
  stale: boolean;
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
}

export async function searchBox(
  boxRoot: string,
  options: SearchBoxOptions
): Promise<SearchBoxResult> {
  const { query, kinds, pathPrefix } = options;
  const limit = options.limit ?? DEFAULT_LIMIT;

  // Validate kinds before the refresh touches anything on disk.
  if (kinds !== undefined && kinds.length > 0) {
    const valid = await getSearchableTypes(boxRoot);
    for (const kind of kinds) {
      if (!valid.includes(kind)) throw new UnknownKindError(kind, valid.toSorted());
    }
  }

  const openOpts: OpenSearchIndexOptions = {};
  if (options.rebuild !== undefined) openOpts.rebuild = options.rebuild;
  if (options.onProgress !== undefined) openOpts.onProgress = options.onProgress;
  const { db, warnings, stale } = await openSearchIndex(boxRoot, openOpts);

  const fetchLimit = pathPrefix !== undefined ? PATH_FILTER_FETCH : limit;
  const raw = await search(db, {
    term: query,
    properties: ["title", "contains", "content"],
    boost: BOOST,
    limit: fetchLimit,
    ...(kinds !== undefined && kinds.length > 0 ? { where: { kind: { in: kinds } } } : {}),
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
  const result: SearchBoxResult = { results, total, truncated, warnings, stale };
  if (truncated) {
    result.hint = "narrow with --kind <type> or --path <prefix>, or raise --limit";
  }
  return result;
}

/**
 * Orama hands documents back untyped; every doc in this index was inserted
 * as a SearchDoc (extract.ts), so this is the one place that re-asserts it.
 */
function hitDoc(hit: { document: unknown }): SearchDoc {
  return hit.document as SearchDoc;
}
