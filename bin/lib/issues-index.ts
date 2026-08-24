/**
 * The Orama index behind `bin/issues search` and `bin/issues similar`.
 *
 * Mirrors `callback-box/src/core/search/` in shape (Orama + a stat manifest +
 * lazy re-embedding) at a much smaller scale: ~900 markdown files, no locking,
 * no partial-document extraction. The whole index is a disposable cache under a
 * gitignored `.issues-index/` at the repo root — delete it and the next run
 * rebuilds, paying for embeddings again.
 *
 * Three files, written in this order so a crash between them self-heals:
 *   `index.json`    the persisted Orama index (fast path when nothing changed)
 *   `vectors.json`  relPath → embedding, the durable record of what we paid for
 *   `manifest.json` `{ schemaVersion, embedderId, entries }` — written LAST, so
 *                   an interrupted run just re-diffs on the next one
 *
 * Vectors live outside the Orama index on purpose: rebuilding the index (which
 * happens whenever any file changed) must never re-embed unchanged files, and
 * reading them back out of a restored index couples the rebuild to a successful
 * restore. The sidecar makes the rebuild independent of it.
 */

import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

import { create, insert, search, type Orama, type Results, type TypedDocument } from "@orama/orama";
import { persistToFile, restoreFromFile } from "@orama/plugin-data-persistence/server";
import { z } from "zod";

import {
  createOpenAIEmbeddingsService,
  EMBEDDER_ID,
  EMBEDDING_DIMENSIONS,
  type EmbeddingsService,
} from "../../callback-box/src/services/openai-embeddings.js";
import type { IssueEntry } from "./issues-model.js";

// ─── Schema ──────────────────────────────────────────────────────────────────

/**
 * Bump when the document shape or the manifest shape changes; a mismatch forces
 * a full rebuild.
 * v2: the manifest splits `indexHash` (all indexed fields) from `embeddedHash`
 *     (the embed text the stored vector was actually computed from).
 */
export const ISSUE_INDEX_SCHEMA_VERSION = 2;

export const issueOramaSchema = {
  path: "string",
  title: "string",
  body: "string",
  kind: "enum",
  category: "enum",
  area: "enum",
  labels: "enum[]",
  workstream: "enum",
  discoveredInWorkstream: "enum",
  needs: "enum[]",
  priority: "enum",
  nextAction: "enum",
  research: "enum",
  status: "enum",
  visibility: "enum",
  date: "string",
  // Orama's schema typing needs a literal `vector[N]`; the assertion below is
  // the tripwire that keeps it tied to EMBEDDING_DIMENSIONS.
  embedding: "vector[512]",
} as const;

if (issueOramaSchema.embedding !== `vector[${String(EMBEDDING_DIMENSIONS)}]`) {
  throw new Error(
    `issues index: embedding field ${issueOramaSchema.embedding} does not match ${String(EMBEDDING_DIMENSIONS)} dims`,
  );
}

export type IssueIndex = Orama<typeof issueOramaSchema>;
type IssueDoc = TypedDocument<IssueIndex>;

/** Documents come from two corpora: the issue queue, and (opt-in) design docs. */
export type IndexKind = "issue" | "doc";

/** Full-text properties searched, and their retrieval weights. */
const TEXT_PROPERTIES = ["title", "body"] as const;
const BOOST = { title: 2 } as const;

/**
 * Vector-half cosine cutoff. Same value and rationale as callback-box's search
 * (`core/search/query.ts`): Orama's 0.8 default excludes nearly every real
 * text-embedding-3-small match, so the vector half would contribute nothing.
 */
const SIMILARITY = 0.35;

/**
 * Placeholder vector for a document with no embedding yet (no API key, or an
 * embed that failed). Unit length so Orama's cosine math stays finite; such
 * documents are excluded from vector results by path, not by score.
 */
function placeholderVector(): number[] {
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  vector[0] = 1;
  return vector;
}

// ─── Cache location + manifest ───────────────────────────────────────────────

/**
 * Which corpus a cache holds. `public` exists so `--visibility public` can be
 * honoured by never LOADING private issues rather than by filtering them out of
 * results: a post-filter would still have sent their text to OpenAI. Two
 * directories rather than one, so alternating between the scopes does not make
 * each run look like the other's entries vanished and re-appeared — which would
 * delete vectors and pay for them again.
 */
export type IndexScope = "all" | "public";

export function indexDirectory(repoRoot: string, scope: IndexScope = "all"): string {
  return path.join(repoRoot, ".issues-index", scope);
}

const manifestEntrySchema = z.object({
  /** Hash of every field the Orama document carries — the rebuild trigger. */
  indexHash: z.string(),
  /**
   * The embed-text hash the stored vector was computed from, or null when there
   * is no usable vector. Recording the hash the vector came FROM (rather than a
   * bare "has one") is what stops a stale vector from being adopted under a new
   * hash when a run is text-only or an embed call fails.
   */
  embeddedHash: z.string().nullable(),
});

const manifestSchema = z.object({
  schemaVersion: z.number(),
  embedderId: z.string(),
  entries: z.record(z.string(), manifestEntrySchema),
});
export type IssueIndexManifest = z.infer<typeof manifestSchema>;

const vectorsSchema = z.record(z.string(), z.array(z.number()));

function emptyManifest(): IssueIndexManifest {
  return { schemaVersion: ISSUE_INDEX_SCHEMA_VERSION, embedderId: EMBEDDER_ID, entries: {} };
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (_error) {
    return undefined;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value)}\n`);
  await fs.rename(tmp, filePath);
}

// ─── Documents ───────────────────────────────────────────────────────────────

/** One indexable file, issue or doc, reduced to what the index and embedder need. */
export interface IndexDocument {
  path: string;
  kind: IndexKind;
  title: string;
  body: string;
  category: string;
  area: string;
  labels: string[];
  workstream: string;
  discoveredInWorkstream: string;
  needs: string[];
  priority: string;
  nextAction: string;
  research: string;
  status: "open" | "closed";
  visibility: string;
  date: string;
  /** Hash of every indexed field above. Changes here mean the index is stale. */
  indexHash: string;
  /** Hash of {@link embedText}. Changes here mean the vector is stale. */
  embedHash: string;
  /** Title + facets + body, truncated — exactly what gets embedded. */
  embedText: string;
}

/** An {@link IndexDocument} before its hashes are computed. */
type IndexFields = Omit<IndexDocument, "indexHash" | "embedHash" | "embedText">;

/**
 * Attach both hashes. They are deliberately separate: the frontmatter fields the
 * `where:` clauses filter on (workstream, needs, priority, next-action,
 * research, visibility) and the body past the embed truncation are all indexed
 * but NOT embedded, so a frontmatter-only edit must rebuild the index while
 * costing nothing in embeddings.
 */
function withHashes(fields: IndexFields, embedText: string): IndexDocument {
  return {
    ...fields,
    indexHash: hash(JSON.stringify(Object.entries(fields).toSorted())),
    embedHash: hash(embedText),
    embedText,
  };
}

const EMBED_TEXT_LIMIT = 8000;

function embedTextFor(options: { title: string; labels: string[]; area: string; body: string }): string {
  const facets = [
    options.title,
    options.area ? `area: ${options.area}` : "",
    options.labels.length > 0 ? `labels: ${options.labels.join(", ")}` : "",
  ].filter((line) => line !== "").join("\n");
  return `${facets}\n\n${options.body}`.slice(0, EMBED_TEXT_LIMIT);
}

function hash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function issueDocument(entry: IssueEntry): IndexDocument {
  const embedText = embedTextFor({
    title: entry.title, labels: entry.labels, area: entry.area ?? "", body: entry.body,
  });
  return withHashes({
    path: entry.path,
    kind: "issue",
    title: entry.title,
    body: entry.body,
    category: entry.category,
    area: entry.area ?? "",
    labels: entry.labels,
    workstream: entry.workstream,
    discoveredInWorkstream: entry.discoveredInWorkstream ?? "",
    needs: entry.needs,
    priority: entry.priority,
    nextAction: entry.nextAction ?? "",
    research: entry.research,
    status: entry.closed ? "closed" : "open",
    visibility: entry.visibility,
    date: entry.date ?? "",
  }, embedText);
}

function docDocument(options: { relPath: string; source: string }): IndexDocument {
  const { relPath, source } = options;
  const title = /^#\s+(?<heading>.+)$/mu.exec(source)?.groups?.["heading"]?.trim()
    ?? path.basename(relPath, ".md");
  const embedText = embedTextFor({ title, labels: [], area: "", body: source });
  return withHashes({
    path: relPath,
    kind: "doc",
    title,
    body: source,
    category: "",
    area: "",
    labels: [],
    workstream: "",
    discoveredInWorkstream: "",
    needs: [],
    priority: "",
    nextAction: "",
    research: "",
    status: "open",
    visibility: "public",
    date: "",
  }, embedText);
}

async function walkMarkdown(root: string, relative = ""): Promise<string[]> {
  let dirents;
  try {
    dirents = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  } catch (_error) {
    return [];
  }
  const found: string[] = [];
  for (const dirent of dirents) {
    const next = relative === "" ? dirent.name : `${relative}/${dirent.name}`;
    if (dirent.isDirectory()) found.push(...(await walkMarkdown(root, next)));
    else if (dirent.isFile() && dirent.name.endsWith(".md")) found.push(next);
  }
  return found;
}

export const DOCS_SUBDIR = "callback-box/docs";

export async function loadDocDocuments(repoRoot: string): Promise<IndexDocument[]> {
  const root = path.join(repoRoot, DOCS_SUBDIR);
  const relatives = await walkMarkdown(root);
  return Promise.all(relatives.toSorted().map(async (relative) => docDocument({
    relPath: `${DOCS_SUBDIR}/${relative}`,
    source: await fs.readFile(path.join(root, relative), "utf8"),
  })));
}

// ─── Embeddings service resolution ───────────────────────────────────────────

/**
 * Environment variables consulted for the embeddings key, in order. The first
 * is this repo's own; the other two are the keys a dev machine is likely to
 * already have exported for callback-box's transcription and story-eval work,
 * so `bin/issues search` works without new setup.
 */
export const EMBEDDING_KEY_VARS = [
  "CALLBACK_OPENAI_API_KEY",
  "THINKING_OPENAI_API_KEY",
  "SKE_OPENAI_API_KEY",
] as const;

export function resolveEmbeddingsService(
  env: NodeJS.ProcessEnv = process.env,
): EmbeddingsService | null {
  for (const name of EMBEDDING_KEY_VARS) {
    const key = env[name];
    if (key !== undefined && key.trim() !== "") return createOpenAIEmbeddingsService(key);
  }
  return null;
}

// ─── Refresh ─────────────────────────────────────────────────────────────────

export interface RefreshOptions {
  repoRoot: string;
  documents: IndexDocument[];
  /** Which cache to read and write. Defaults to the whole corpus. */
  scope?: IndexScope;
  /** Absent (or null) means text-only: nothing is embedded and nothing is re-embedded. */
  embeddings?: EmbeddingsService | null;
  /** Discard the persisted index, vectors, and manifest before refreshing. */
  rebuild?: boolean;
}

export interface RefreshResult {
  db: IssueIndex;
  /** Stored embedding per path — the query vector for `similar` comes from here. */
  vectors: Map<string, number[]>;
  /** Paths with a real embedding — the eligible set for vector ranking. */
  embedded: Set<string>;
  embeddedThisRun: number;
  /** Non-fatal problems worth telling the user about (e.g. a failed embed call). */
  warnings: string[];
}

/**
 * Bring the cache in line with `documents` and return a queryable index.
 *
 * Every file is re-read by the caller on every run (cheap at this corpus size),
 * so the manifest answers only the two questions re-reading cannot: is the
 * persisted index stale (`indexHash`), and is a stored vector stale
 * (`embeddedHash`). The second is the one whose wrong answer costs money.
 */
export async function refreshIndex(options: RefreshOptions): Promise<RefreshResult> {
  const { repoRoot, documents } = options;
  const directory = indexDirectory(repoRoot, options.scope ?? "all");
  const manifestPath = path.join(directory, "manifest.json");
  const vectorsPath = path.join(directory, "vectors.json");
  const indexPath = path.join(directory, "index.json");
  const warnings: string[] = [];

  if (options.rebuild === true) await fs.rm(directory, { recursive: true, force: true });

  const parsedManifest = manifestSchema.safeParse(await readJson(manifestPath));
  const usable = parsedManifest.success
    && parsedManifest.data.schemaVersion === ISSUE_INDEX_SCHEMA_VERSION
    && parsedManifest.data.embedderId === EMBEDDER_ID;
  const manifest = usable && parsedManifest.success ? parsedManifest.data : emptyManifest();

  const parsedVectors = usable ? vectorsSchema.safeParse(await readJson(vectorsPath)) : undefined;
  const vectors = new Map<string, number[]>(
    parsedVectors?.success === true
      ? Object.entries(parsedVectors.data).filter(([, v]) => v.length === EMBEDDING_DIMENSIONS)
      : [],
  );

  const present = new Set(documents.map((document) => document.path));
  const vanished = Object.keys(manifest.entries).filter((key) => !present.has(key));
  for (const gone of vanished) vectors.delete(gone);

  const pending = documents.filter((document) => {
    const known = manifest.entries[document.path];
    return known === undefined
      || known.embeddedHash !== document.embedHash
      || !vectors.has(document.path);
  });
  // A pending document's stored vector describes text that no longer exists.
  // Dropping it BEFORE the embed attempt is what keeps a failed or text-only
  // run honest: the document comes back as unembedded rather than keeping a
  // vector for the old text under the new hash.
  for (const document of pending) vectors.delete(document.path);

  const service = options.embeddings ?? null;
  let embeddedThisRun = 0;
  if (service !== null && pending.length > 0) {
    try {
      const produced = await service.embed(pending.map((document) => document.embedText));
      for (const [position, document] of pending.entries()) {
        const vector = produced[position];
        if (vector === undefined) continue;
        vectors.set(document.path, vector);
        embeddedThisRun += 1;
      }
    } catch (error) {
      warnings.push(`embedding failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const nextEntries: IssueIndexManifest["entries"] = {};
  for (const document of documents) {
    nextEntries[document.path] = {
      indexHash: document.indexHash,
      embeddedHash: vectors.has(document.path) ? document.embedHash : null,
    };
  }

  const indexStale = vanished.length > 0
    || embeddedThisRun > 0
    || Object.keys(manifest.entries).length !== documents.length
    || documents.some((document) => manifest.entries[document.path]?.indexHash !== document.indexHash)
    // A vector that was dropped and not replaced also changes the stored docs.
    || documents.some((document) => (manifest.entries[document.path]?.embeddedHash ?? null) !== nextEntries[document.path]?.embeddedHash);

  const embedded = new Set(
    documents.filter((document) => nextEntries[document.path]?.embeddedHash !== null)
      .map((document) => document.path),
  );

  let db: IssueIndex | null = indexStale ? null : await restoreIndex(indexPath);
  if (db === null) {
    db = await buildIndex(documents, vectors);
    await fs.mkdir(directory, { recursive: true });
    const tmp = `${indexPath}.tmp`;
    await persistToFile(db, "json", tmp);
    await fs.rename(tmp, indexPath);
    await writeJsonAtomic(vectorsPath, Object.fromEntries(vectors));
    await writeJsonAtomic(manifestPath, {
      schemaVersion: ISSUE_INDEX_SCHEMA_VERSION, embedderId: EMBEDDER_ID, entries: nextEntries,
    });
  }

  return { db, vectors, embedded, embeddedThisRun, warnings };
}

/**
 * Paths the manifest already tracks. The CLI uses this to keep indexing
 * `callback-box/docs` once `--docs` has pulled it in: dropping the corpus again
 * would delete vectors that were paid for, and re-adding it would pay twice.
 */
export async function manifestPaths(repoRoot: string, scope: IndexScope = "all"): Promise<string[]> {
  const parsed = manifestSchema.safeParse(
    await readJson(path.join(indexDirectory(repoRoot, scope), "manifest.json")),
  );
  return parsed.success ? Object.keys(parsed.data.entries) : [];
}

async function restoreIndex(indexPath: string): Promise<IssueIndex | null> {
  try {
    await fs.access(indexPath);
  } catch (_error) {
    return null;
  }
  try {
    return await restoreFromFile<IssueIndex>("json", indexPath);
  } catch (_error) {
    return null;
  }
}

async function buildIndex(
  documents: IndexDocument[],
  vectors: Map<string, number[]>,
): Promise<IssueIndex> {
  const db: IssueIndex = await create({ schema: issueOramaSchema });
  for (const document of documents) {
    await insert(db, {
      path: document.path,
      title: document.title,
      body: document.body,
      kind: document.kind,
      category: document.category,
      area: document.area,
      labels: document.labels,
      workstream: document.workstream,
      discoveredInWorkstream: document.discoveredInWorkstream,
      needs: document.needs,
      priority: document.priority,
      nextAction: document.nextAction,
      research: document.research,
      status: document.status,
      visibility: document.visibility,
      date: document.date,
      embedding: vectors.get(document.path) ?? placeholderVector(),
    });
  }
  return db;
}

// ─── Query ───────────────────────────────────────────────────────────────────

export type SearchMode = "text" | "hybrid" | "semantic";

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

export async function runSearch(options: RunSearchOptions): Promise<IndexHit[]> {
  const { db, mode, where, limit } = options;
  const fetchLimit = Math.max(limit * FETCH_MULTIPLIER, limit + 20);
  const common = { limit: fetchLimit, ...(where && Object.keys(where).length > 0 ? { where } : {}) };
  const term = options.term ?? "";
  const vector = options.vector;

  if (mode !== "text" && vector === undefined) {
    // Silently answering a semantic request with BM25 is the failure this
    // whole layer exists to avoid; the caller resolves the mode, so reaching
    // here without a vector is a programming error, not a degraded state.
    throw new Error(`issues index: ${mode} search was called without a query vector`);
  }

  let results: Results<IssueDoc>;
  if (mode === "text" || vector === undefined) {
    results = await search(db, { term, properties: [...TEXT_PROPERTIES], boost: BOOST, ...common });
  } else if (mode === "semantic") {
    results = await search(db, {
      mode: "vector", vector: { value: vector, property: "embedding" }, similarity: SIMILARITY, ...common,
    });
  } else {
    results = await search(db, {
      mode: "hybrid", term, vector: { value: vector, property: "embedding" },
      similarity: SIMILARITY, properties: [...TEXT_PROPERTIES], boost: BOOST, ...common,
    });
  }

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
    if (hits.length >= limit) break;
  }
  return hits;
}
