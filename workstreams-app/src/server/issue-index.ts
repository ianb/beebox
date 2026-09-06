/**
 * The Orama index behind `bin/issues search` / `bin/issues similar` and this
 * app's `issues.related` procedure — one implementation, two callers, so a
 * "Related" row in the browser and a `bin/issues similar` row are the same row.
 *
 * Mirrors `beebox/src/core/search/` in shape (Orama + a stat manifest +
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

import { create, insert, type Orama } from "@orama/orama";
import { persistToFile, restoreFromFile } from "@orama/plugin-data-persistence/server";
import { z } from "zod";

import {
  createEmbeddingsService,
  EMBEDDER_ID,
  EMBEDDING_DIMENSIONS,
  type EmbeddingsService,
} from "../../../beebox/src/services/openai-embeddings.js";
import type { IndexDocument } from "./issue-index-documents.js";

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

/** The literal `vector[N]` above drifted from the embedder's real dimension. */
class EmbeddingDimensionMismatchError extends Error {
  constructor() {
    super("issues index: the Orama embedding field does not match EMBEDDING_DIMENSIONS");
    this.name = "EmbeddingDimensionMismatchError";
  }
}

if (issueOramaSchema.embedding !== `vector[${String(EMBEDDING_DIMENSIONS)}]`) {
  throw new EmbeddingDimensionMismatchError();
}

export type IssueIndex = Orama<typeof issueOramaSchema>;

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

export function indexDirectory(repoRoot: string, scope: IndexScope): string {
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

/** The stored manifest, or null when it is absent, corrupt, or from another era. */
function usableManifest(raw: unknown): IssueIndexManifest | null {
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) return null;
  if (parsed.data.schemaVersion !== ISSUE_INDEX_SCHEMA_VERSION) return null;
  if (parsed.data.embedderId !== EMBEDDER_ID) return null;
  return parsed.data;
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (_error) {
    return undefined;
  }
}

/**
 * A temp name no other writer can be using. The cache has no lock — the CLI
 * and the long-lived app both write it — and a SHARED `.tmp` name is the one
 * race that corrupts rather than merely wasting work: two writers interleave
 * into one file and whichever renames second publishes a spliced index.
 * Distinct names make the loser's write harmless; last rename wins, and both
 * candidates are internally whole.
 */
function tempName(filePath: string): string {
  return `${filePath}.${String(process.pid)}.${crypto.randomUUID()}.tmp`;
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = tempName(filePath);
  await fs.writeFile(tmp, `${JSON.stringify(value)}\n`);
  await fs.rename(tmp, filePath);
}

// ─── Embeddings service resolution ───────────────────────────────────────────

/**
 * Environment variables consulted for the embeddings key, in order. The first
 * is this repo's own; the other two are the keys a dev machine is likely to
 * already have exported for beebox's transcription and story-eval work,
 * so `bin/issues search` works without new setup.
 */
export const EMBEDDING_KEY_VARS = [
  "BBX_OPENAI_API_KEY",
  "THINKING_OPENAI_API_KEY",
  "SKE_OPENAI_API_KEY",
] as const;

export function resolveEmbeddingsService(env: NodeJS.ProcessEnv): EmbeddingsService | null {
  for (const name of EMBEDDING_KEY_VARS) {
    const key = env[name];
    // A direct OpenAI route: the dev-side index takes its key from the
    // environment and never consults a box's secret store or OpenRouter.
    if (key !== undefined && key.trim() !== "") return createEmbeddingsService({ via: "direct", apiKey: key });
  }
  return null;
}

// ─── Refresh ─────────────────────────────────────────────────────────────────

export interface RefreshOptions {
  repoRoot: string;
  documents: IndexDocument[];
  /** Which cache to read and write. Defaults to the whole corpus. */
  scope?: IndexScope | undefined;
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

/** Vectors carried over from the last run, minus every one that went stale. */
async function usableVectors(input: {
  vectorsPath: string;
  manifest: IssueIndexManifest | null;
  documents: IndexDocument[];
}): Promise<{ vectors: Map<string, number[]>; vanished: string[]; pending: IndexDocument[] }> {
  const entries = input.manifest?.entries ?? {};
  const parsed = input.manifest === null
    ? undefined
    : vectorsSchema.safeParse(await readJson(input.vectorsPath));
  const vectors = new Map<string, number[]>(
    parsed?.success === true
      ? Object.entries(parsed.data).filter(([, value]) => value.length === EMBEDDING_DIMENSIONS)
      : [],
  );
  const present = new Set(input.documents.map((document) => document.path));
  const vanished = Object.keys(entries).filter((key) => !present.has(key));
  for (const gone of vanished) vectors.delete(gone);
  const pending = input.documents.filter((document) => {
    const known = entries[document.path];
    return known === undefined
      || known.embeddedHash !== document.embedHash
      || !vectors.has(document.path);
  });
  // A pending document's stored vector describes text that no longer exists.
  // Dropping it BEFORE the embed attempt is what keeps a failed or text-only
  // run honest: the document comes back as unembedded rather than keeping a
  // vector for the old text under the new hash.
  for (const document of pending) vectors.delete(document.path);
  return { vectors, vanished, pending };
}

/** Embed what changed, in one batched call. A failure is reported, not thrown. */
async function embedPending(input: {
  service: EmbeddingsService | null;
  pending: IndexDocument[];
  vectors: Map<string, number[]>;
}): Promise<{ embeddedThisRun: number; warnings: string[] }> {
  const { service, pending, vectors } = input;
  if (service === null || pending.length === 0) return { embeddedThisRun: 0, warnings: [] };
  let embeddedThisRun = 0;
  try {
    const produced = await service.embed(pending.map((document) => document.embedText));
    for (const [position, document] of pending.entries()) {
      const vector = produced[position];
      if (vector === undefined) continue;
      vectors.set(document.path, vector);
      embeddedThisRun += 1;
    }
  } catch (error) {
    return {
      embeddedThisRun,
      warnings: [`embedding failed: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  return { embeddedThisRun, warnings: [] };
}

function isIndexStale(input: {
  manifest: IssueIndexManifest | null;
  next: IssueIndexManifest["entries"];
  documents: IndexDocument[];
  vanished: string[];
  embeddedThisRun: number;
}): boolean {
  const entries = input.manifest?.entries ?? {};
  if (input.vanished.length > 0 || input.embeddedThisRun > 0) return true;
  if (Object.keys(entries).length !== input.documents.length) return true;
  return input.documents.some((document) =>
    entries[document.path]?.indexHash !== document.indexHash
    // A vector that was dropped and not replaced also changes the stored docs.
    || (entries[document.path]?.embeddedHash ?? null) !== input.next[document.path]?.embeddedHash);
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

  if (options.rebuild === true) await fs.rm(directory, { recursive: true, force: true });

  const manifest = usableManifest(await readJson(manifestPath));
  const { vectors, vanished, pending } = await usableVectors({ vectorsPath, manifest, documents });
  const embedded = await embedPending({
    service: options.embeddings ?? null, pending, vectors,
  });

  const nextEntries: IssueIndexManifest["entries"] = {};
  for (const document of documents) {
    nextEntries[document.path] = {
      indexHash: document.indexHash,
      embeddedHash: vectors.has(document.path) ? document.embedHash : null,
    };
  }
  const stale = isIndexStale({
    manifest, next: nextEntries, documents, vanished, embeddedThisRun: embedded.embeddedThisRun,
  });

  let db: IssueIndex | null = stale ? null : await restoreIndex(indexPath);
  if (db === null) {
    db = await buildIndex(documents, vectors);
    await fs.mkdir(directory, { recursive: true });
    const tmp = tempName(indexPath);
    await persistToFile(db, "json", tmp);
    await fs.rename(tmp, indexPath);
    await writeJsonAtomic(vectorsPath, Object.fromEntries(vectors));
    await writeJsonAtomic(manifestPath, {
      schemaVersion: ISSUE_INDEX_SCHEMA_VERSION, embedderId: EMBEDDER_ID, entries: nextEntries,
    });
  }

  return {
    db,
    vectors,
    embedded: new Set(
      documents.filter((document) => nextEntries[document.path]?.embeddedHash !== null)
        .map((document) => document.path),
    ),
    embeddedThisRun: embedded.embeddedThisRun,
    warnings: embedded.warnings,
  };
}

/**
 * Paths the manifest already tracks. The CLI uses this to keep indexing
 * `beebox/docs` once `--docs` has pulled it in: dropping the corpus again
 * would delete vectors that were paid for, and re-adding it would pay twice.
 */
export async function manifestPaths(repoRoot: string, scope: IndexScope): Promise<string[]> {
  const stored = usableManifest(await readJson(path.join(indexDirectory(repoRoot, scope), "manifest.json")));
  return stored === null ? [] : Object.keys(stored.entries);
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
