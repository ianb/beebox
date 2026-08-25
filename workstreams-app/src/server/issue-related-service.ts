/**
 * "Related" for one issue: its nearest issues and design docs.
 *
 * This is `bin/issues similar <path> --all --docs` with a different front end.
 * It opens the SAME index over the SAME `.issues-index/all` cache at the
 * monorepo root, ranks with the same stored vector, and reports the same
 * scores — so a row here and a row from the CLI are the same row. Anything
 * that made the two disagree would make the browser's answer untrustworthy
 * exactly where an agent and a human are meant to compare notes.
 *
 * The app is long-lived, so unlike the CLI it does not open the index per
 * request: it holds the built index in process, and re-reads the corpus at
 * most every {@link FRESHNESS_MS} to decide whether anything changed. Reading
 * ~900 small markdown files is the cheap half; rebuilding Orama and embedding
 * is the expensive half, and only a changed `indexHash` reaches it.
 */

import crypto from "node:crypto";

import type { IssueVisibility, RelatedResult, RelatedRow } from "../shared/documents.js";
import type { IssueRelatedService } from "./services.js";
import { issueDocument, loadDocDocuments, type IndexDocument } from "./issue-index-documents.js";
import { runSearch } from "./issue-index-query.js";
import {
  EMBEDDING_KEY_VARS, refreshIndex, resolveEmbeddingsService, type RefreshResult,
} from "./issue-index.js";
import type { EmbeddingsService } from "../../../callback-box/src/services/openai-embeddings.js";
import { loadIssueEntries, type IssueEntry } from "./issue-search-model.js";

/** Rows shown under an issue. Eight is what fits without becoming a second list. */
const RELATED_LIMIT = 8;
/**
 * Ranked hits asked of the index. This is the CLI's default `--limit`, kept
 * deliberately: the rows shown are the top {@link RELATED_LIMIT} of exactly
 * the ranking `bin/issues similar` would print.
 */
const RELATED_BUDGET = 20;

/** How long a corpus read is trusted before the files are re-stat'd. */
const FRESHNESS_MS = 30_000;

export interface IssueRelatedServiceOptions {
  /** The main checkout — the one whose `issues/` the browser lists. */
  mainRoot: string;
  /**
   * Where the embeddings key is read from, in {@link EMBEDDING_KEY_VARS}
   * order. The router hands the app child its own environment, so in the
   * running app this is whatever `pnpm dev` was started with.
   */
  env?: NodeJS.ProcessEnv;
  /**
   * Replaces key resolution entirely. Tests inject a deterministic embedder;
   * nothing in production sets it. To exercise the keyless state, pass an
   * `env` with none of {@link EMBEDDING_KEY_VARS} instead.
   */
  embeddings?: EmbeddingsService;
  now?: () => number;
}

/** The index, open and queryable, plus what the caller must know about it. */
interface OpenIndex {
  refreshed: RefreshResult | null;
  byPath: Map<string, IssueEntry>;
  documentCount: number;
}

/**
 * Whether an unchanged corpus may reuse this open rather than refreshing.
 *
 * Only a complete one may. A keyless open, a failed embed call, or a corpus
 * that is only partly embedded are all TRANSIENT states — the key arrives,
 * the network recovers — and the corpus signature does not change when they
 * clear. Reusing on signature alone would freeze the first bad answer in
 * place for as long as nobody edits an issue, which is the one way a
 * long-lived reader can be permanently more wrong than the CLI.
 */
function isComplete(open: OpenIndex): boolean {
  if (open.refreshed === null) return false;
  if (open.refreshed.warnings.length > 0) return false;
  return open.refreshed.embedded.size === open.documentCount;
}

/** The whole corpus in one string — cheap to compare, changes when anything does. */
function signatureOf(documents: IndexDocument[]): string {
  const hash = crypto.createHash("sha256");
  for (const document of documents) hash.update(document.path).update(document.indexHash);
  return hash.digest("hex");
}

/** `bugs/2026-01-02-x.md` + private → `private-issues/bugs/2026-01-02-x.md`. */
function indexPath(input: { relPath: string; visibility: IssueVisibility }): string {
  return `${input.visibility === "private" ? "private-issues" : "issues"}/${input.relPath}`;
}

/**
 * Null for an issue hit the corpus no longer knows — a row from an index
 * built moments before a file moved. The CLI drops such a hit too; rendering
 * it as a doc would give it a document-browser link to a path that is not a
 * document (and is not there).
 */
function toRow(input: { hit: { score: number; path: string; title: string; kind: "issue" | "doc" }; entry: IssueEntry | undefined }): RelatedRow | null {
  const { hit, entry } = input;
  if (hit.kind === "doc") {
    return { score: hit.score, path: hit.path, title: hit.title, kind: "doc", status: null, issue: null };
  }
  if (entry === undefined) return null;
  return {
    score: hit.score,
    path: hit.path,
    title: hit.title,
    kind: "issue",
    status: entry.closed ? "closed" : "open",
    issue: { relPath: entry.relPath, visibility: entry.visibility },
  };
}

export function createIssueRelatedService(options: IssueRelatedServiceOptions): IssueRelatedService {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  let cache: { at: number; signature: string; open: OpenIndex } | null = null;
  let inFlight: Promise<OpenIndex> | null = null;

  async function reopen(): Promise<OpenIndex> {
    const entries = await loadIssueEntries({ repoRoot: options.mainRoot });
    const byPath = new Map(entries.map((entry) => [entry.path, entry]));
    const documents = [
      ...entries.map((entry) => issueDocument(entry)),
      ...(await loadDocDocuments(options.mainRoot)),
    ];
    const signature = signatureOf(documents);
    // Nothing changed AND the last open was complete: keep the built index
    // rather than restoring it from disk.
    if (cache !== null && cache.signature === signature && isComplete(cache.open)) {
      cache = { at: now(), signature, open: { ...cache.open, byPath } };
      return cache.open;
    }
    const embeddings = options.embeddings ?? resolveEmbeddingsService(env);
    const open: OpenIndex = {
      // With no key nothing can be ranked, so building the index would be
      // work spent to produce a "no key" answer we already know.
      refreshed: embeddings === null
        ? null
        : await refreshIndex({ repoRoot: options.mainRoot, documents, scope: "all", embeddings }),
      byPath,
      documentCount: documents.length,
    };
    cache = { at: now(), signature, open };
    return open;
  }

  /** One refresh at a time: two concurrent opens would embed the same changes twice. */
  async function openIndex(): Promise<OpenIndex> {
    if (cache !== null && now() - cache.at < FRESHNESS_MS) return cache.open;
    inFlight ??= reopen().finally(() => { inFlight = null; });
    return inFlight;
  }

  return {
    async related(input): Promise<RelatedResult> {
      const open = await openIndex();
      if (open.refreshed === null) {
        return {
          rows: [],
          unembedded: open.documentCount,
          problem: {
            reason: "no-key",
            detail: `the semantic index needs an OpenAI key — set one of ${EMBEDDING_KEY_VARS.join(", ")}`,
          },
        };
      }
      const { db, vectors, embedded, warnings } = open.refreshed;
      const unembedded = open.documentCount - embedded.size;
      const target = indexPath(input);
      const vector = vectors.get(target);
      if (vector === undefined) {
        return {
          rows: [],
          unembedded,
          problem: warnings.length > 0
            ? { reason: "failed", detail: warnings.join("; ") }
            : { reason: "no-vector", detail: `${target} has no stored embedding yet` },
        };
      }
      // Deliberate divergence from the CLI: `bin/issues similar` REFUSES to
      // rank a half-embedded corpus, because a person who typed
      // `--mode semantic` asserted BM25 would not do and can re-run. A reader
      // who opened an issue asserted nothing, and blanking the section over
      // one just-filed neighbour would be worse than ranking the rest — so
      // the partial ranking is served WITH its `unembedded` count, which the
      // browser renders. Partial is shown as partial, never as complete.
      const hits = await runSearch({
        db,
        mode: "semantic",
        vector,
        limit: RELATED_BUDGET,
        exclude: new Set([target]),
        eligible: embedded,
      });
      return {
        rows: hits.map((hit) => toRow({ hit, entry: open.byPath.get(hit.path) }))
          .filter((row) => row !== null)
          .slice(0, RELATED_LIMIT),
        unembedded,
        problem: null,
      };
    },
  };
}
