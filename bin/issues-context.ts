/**
 * The index plumbing behind `issues search` and `issues similar`: which cache
 * scope a run uses, what documents go into it, how the filters become an Orama
 * `where:` clause, and the one place `--mode` is resolved against what the
 * environment can actually do.
 *
 * Split out of `bin/issues.ts` purely for size; the surface is identical.
 */

import {
  REPO_ROOT, loadIssueEntries, matchesFilters,
  type IssueEntry, type IssueFilters,
} from "../workstreams-app/src/server/issue-search-model.js";
import {
  EMBEDDING_KEY_VARS, manifestPaths, refreshIndex, resolveEmbeddingsService,
  type IndexScope,
} from "../workstreams-app/src/server/issue-index.js";
import {
  DOCS_SUBDIR, issueDocument, loadDocDocuments, type IndexDocument,
} from "../workstreams-app/src/server/issue-index-documents.js";
import type { IndexHit, SearchMode } from "../workstreams-app/src/server/issue-index-query.js";
import { narrowsToIssues, type ParsedValues } from "./issues-args.js";
import {
  AmbiguousIssueError, CorpusNotEmbeddedError, MissingEmbeddingsKeyError,
  NoEmbeddingsKeyError, NoQueryVectorError, NoSuchIssueError,
} from "./issues-errors.js";

/**
 * `--visibility public` selects the public-only cache, so the private queue is
 * never read, indexed, or embedded for that run. Every other run uses the full
 * one; `--visibility private` still narrows by filter, since the private issues
 * have to be loaded to be returned at all.
 */
function scopeFor(filters: IssueFilters): IndexScope {
  return filters.visibility === "public" ? "public" : "all";
}

export function publicOnly(filters: IssueFilters): { publicOnly: boolean } {
  return { publicOnly: filters.visibility === "public" };
}

async function buildDocuments(input: {
  entries: IssueEntry[];
  includeDocs: boolean;
  scope: IndexScope;
}): Promise<IndexDocument[]> {
  const documents = input.entries.map((entry) => issueDocument(entry));
  // Once `--docs` has pulled the design docs in, keep refreshing them: dropping
  // the corpus would discard vectors already paid for.
  const indexed = await manifestPaths(REPO_ROOT, input.scope);
  const alreadyIndexed = indexed.some((entryPath) => entryPath.startsWith(`${DOCS_SUBDIR}/`));
  if (input.includeDocs || alreadyIndexed) documents.push(...(await loadDocDocuments(REPO_ROOT)));
  return documents;
}

/** Orama `where:` for the enum/enum[] fields; the rest is post-filtered exactly. */
export function whereClause(filters: IssueFilters, includeDocs: boolean): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  const enumIn = (field: string, values: string[]): void => {
    if (values.length > 0) where[field] = { in: values };
  };
  if (filters.status !== "all") where["status"] = { eq: filters.status };
  enumIn("category", filters.category);
  enumIn("area", filters.area);
  enumIn("workstream", filters.workstream);
  enumIn("discoveredInWorkstream", filters.discoveredIn);
  enumIn("priority", filters.priority);
  enumIn("nextAction", filters.nextAction);
  if (filters.research !== null) where["research"] = { eq: filters.research };
  if (filters.visibility !== null) where["visibility"] = { eq: filters.visibility };
  if (filters.labels.length > 0) where["labels"] = { containsAll: filters.labels };
  // enum[] has no "contains any", so only a single --needs maps to a clause;
  // several are left to the post-filter (and the wider fetch budget).
  if (filters.needs.length === 1) where["needs"] = { containsAll: filters.needs };
  if (!includeDocs) where["kind"] = { eq: "issue" };
  // A doc has none of the issue facets, so any narrowing filter would exclude
  // it anyway — but `status` alone must not, since docs index as "open".
  if (includeDocs && narrowsToIssues(filters)) where["kind"] = { eq: "issue" };
  return where;
}

/**
 * Recheck each hit against the exact JS predicate. Orama's `where:` covers the
 * enum fields; `--needs` with several values (OR over an enum[]) and `--since`
 * (a range over a string field) have no `where:` equivalent, and a hit that only
 * survived because of that gap must not reach the output.
 */
export function acceptHit(input: { hit: IndexHit; byPath: Map<string, IssueEntry>; filters: IssueFilters }): boolean {
  const { hit, byPath, filters } = input;
  const entry = byPath.get(hit.path);
  if (entry === undefined) return hit.kind === "doc" && !narrowsToIssues(filters);
  return matchesFilters(entry, filters);
}

export interface IndexContext {
  entries: IssueEntry[];
  byPath: Map<string, IssueEntry>;
  refreshed: Awaited<ReturnType<typeof refreshIndex>>;
  mode: SearchMode;
}

export async function openIndex(input: {
  values: ParsedValues;
  requestedMode: SearchMode | null;
  includeDocs: boolean;
  filters: IssueFilters;
  /** False for `similar`, whose ranking cannot fall back to BM25. */
  textFallbackOffered?: boolean;
}): Promise<IndexContext> {
  const { values, requestedMode, includeDocs, filters } = input;
  const scope = scopeFor(filters);
  const entries = await loadIssueEntries({ repoRoot: REPO_ROOT, publicOnly: scope === "public" });
  const documents = await buildDocuments({ entries, includeDocs, scope });

  // Mode resolution, in one place. An EXPLICIT --mode hybrid|semantic is a
  // statement that BM25 will not do, so it fails loudly rather than quietly
  // answering a different question; only the unspecified default degrades, and
  // it says so on stderr. --mode text never resolves a key and never embeds.
  const service = requestedMode === "text" ? null : resolveEmbeddingsService(process.env);
  // `similar` asks for semantic ranking itself, so "use --mode text instead" is
  // advice only the person who typed --mode can take.
  const textIsAnOption = input.textFallbackOffered !== false;
  if (requestedMode !== null && requestedMode !== "text" && service === null) {
    throw new MissingEmbeddingsKeyError({
      mode: requestedMode, keyVars: EMBEDDING_KEY_VARS, textIsAnOption,
    });
  }
  let mode: SearchMode = service === null ? "text" : (requestedMode ?? "hybrid");
  if (service === null && requestedMode === null) {
    process.stderr.write(
      `issues: no embeddings key set (${EMBEDDING_KEY_VARS.join(", ")}); falling back to --mode text\n`,
    );
  }

  const refreshed = await refreshIndex({
    repoRoot: REPO_ROOT,
    documents,
    scope,
    embeddings: service,
    ...(values.rebuild === true ? { rebuild: true } : {}),
  });
  for (const warning of refreshed.warnings) process.stderr.write(`issues: ${warning}\n`);
  if (refreshed.embeddedThisRun > 0) {
    process.stderr.write(`issues: embedded ${String(refreshed.embeddedThisRun)} changed document(s)\n`);
  }

  // Vector ranking over a half-embedded corpus ranks against placeholder
  // vectors (hybrid) or silently omits documents (semantic) — either way the
  // result is not the search that was asked for.
  const missing = documents.length - refreshed.embedded.size;
  if (mode !== "text" && missing > 0) {
    const detail = `${String(missing)} of ${String(documents.length)} document(s) are not embedded`;
    if (requestedMode !== null) {
      throw new CorpusNotEmbeddedError({ mode: requestedMode, detail, textIsAnOption });
    }
    process.stderr.write(`issues: ${detail}; falling back to --mode text\n`);
    mode = "text";
  }

  return { entries, byPath: new Map(entries.map((entry) => [entry.path, entry])), refreshed, mode };
}

export function resolveEntry(entries: IssueEntry[], needle: string): IssueEntry {
  const exact = entries.find((entry) => entry.path === needle);
  if (exact) return exact;
  const stripped = needle.replace(/^\.?\/*/u, "");
  for (const candidates of [
    entries.filter((entry) => entry.path === stripped || entry.relPath === stripped),
    entries.filter((entry) => entry.path.endsWith(`/${stripped}`)),
    entries.filter((entry) => entry.slug === stripped || entry.slug === stripped.replace(/\.md$/u, "")),
  ]) {
    const only = candidates[0];
    if (candidates.length === 1 && only !== undefined) return only;
    if (candidates.length > 1) throw new AmbiguousIssueError(needle, candidates.length);
  }
  throw new NoSuchIssueError(needle);
}

export async function requireQueryVector(text: string): Promise<number[]> {
  const service = resolveEmbeddingsService(process.env);
  if (service === null) throw new NoEmbeddingsKeyError();
  const [vector] = await service.embed([text]);
  if (vector === undefined) throw new NoQueryVectorError();
  return vector;
}
