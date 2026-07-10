/**
 * OpenAI Embeddings service — typed interface for text embedding.
 *
 * Real implementation calls the OpenAI REST API. Fake derives deterministic
 * unit vectors from each text so tests never need a real key.
 *
 * Provider decision (sticky, see docs/plans/semantic-search.md § Direction):
 * text-embedding-3-small at 512 dims via Matryoshka truncation. Model + dims
 * are code constants, not per-box config — a config knob would let boxes
 * drift apart for no benefit; changing the model is a code change whose cost
 * (re-embedding every card) should look like a code change.
 */

import ky from "ky";
import { errorMessage } from "../lib/error-guards.js";

// ─── Constants ───────────────────────────────────────────────────────────────

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 512;
/** `"<provider>:<model>@<dims>"` — folded into every embedded-text hash. */
export const EMBEDDER_ID = `openai:${EMBEDDING_MODEL}@${String(EMBEDDING_DIMENSIONS)}`;

/** OpenAI's `/v1/embeddings` accepts at most this many inputs per request. */
const MAX_INPUTS_PER_REQUEST = 2048;
/**
 * Conservative character budget per request. The API caps a request at
 * 300k tokens summed across inputs; ~4 chars/token makes 400k chars a
 * comfortable margin even for adversarial tokenization.
 */
const MAX_CHARS_PER_REQUEST = 400_000;

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * Thrown when the embeddings API fails or returns a shape we didn't request.
 * `detail` is built by the caller from structured data (never a literal),
 * so the message always carries the specific status/shape context.
 */
export class EmbeddingsError extends Error {
  constructor(detail: string, opts?: { cause?: unknown }) {
    super(`OpenAI embeddings error: ${detail}`, opts);
    this.name = "EmbeddingsError";
  }
}

// ─── Service interface ───────────────────────────────────────────────────────

export interface EmbeddingsService {
  /** Embed texts in order; result[i] has EMBEDDING_DIMENSIONS entries. */
  embed(texts: string[]): Promise<number[][]>;
}

// ─── Real implementation ─────────────────────────────────────────────────────

/**
 * Validate an untrusted `/v1/embeddings` response body into vectors, in
 * request order. Every malformed shape — non-object body, missing/short
 * `data`, null items, wrong `index`, absent/misshapen/non-finite
 * `embedding` — becomes a typed EmbeddingsError, never a raw TypeError:
 * the refresh and query layers degrade on EmbeddingsError specifically.
 * Exported for doctests (no real key can exercise this boundary in CI).
 */
export function parseEmbeddingsResponse(body: unknown, expectedCount: number): number[][] {
  if (typeof body !== "object" || body === null || !Array.isArray((body as { data?: unknown }).data)) {
    const noDataDetail = `response body had no data array (got ${body === null ? "null" : typeof body})`;
    throw new EmbeddingsError(noDataDetail);
  }
  const data = (body as { data: unknown[] }).data;
  if (data.length !== expectedCount) {
    const countMismatchDetail = `response had ${String(data.length)} entries for ${String(expectedCount)} inputs`;
    throw new EmbeddingsError(countMismatchDetail);
  }
  const vectors: number[][] = Array.from<number[]>({ length: expectedCount });
  for (const [position, rawItem] of data.entries()) {
    if (typeof rawItem !== "object" || rawItem === null) {
      const nonObjectDetail = `response entry at position ${String(position)} was not an object`;
      throw new EmbeddingsError(nonObjectDetail);
    }
    const item = rawItem as { index?: unknown; embedding?: unknown };
    if (item.index !== position) {
      const indexMismatchDetail = `response index ${String(item.index)} did not match request position ${String(position)}`;
      throw new EmbeddingsError(indexMismatchDetail);
    }
    const embedding = item.embedding;
    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
      const receivedDims = Array.isArray(embedding) ? String(embedding.length) : "no";
      const dimensionMismatchDetail = `response vector at index ${String(position)} had ${receivedDims} dims, expected ${String(EMBEDDING_DIMENSIONS)}`;
      throw new EmbeddingsError(dimensionMismatchDetail);
    }
    if (!embedding.every((v) => typeof v === "number" && Number.isFinite(v))) {
      const nonNumericDetail = `response vector at index ${String(position)} held non-finite or non-number entries`;
      throw new EmbeddingsError(nonNumericDetail);
    }
    vectors[position] = embedding as number[];
  }
  return vectors;
}

/**
 * Split texts into request chunks respecting both input-count and char
 * budgets. Exported for doctests only — the real service applies it inside
 * embed().
 */
export function chunkTexts(texts: string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentChars = 0;
  for (const text of texts) {
    const over =
      current.length >= MAX_INPUTS_PER_REQUEST
      || (current.length > 0 && currentChars + text.length > MAX_CHARS_PER_REQUEST);
    if (over) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(text);
    currentChars += text.length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export function createOpenAIEmbeddingsService(apiKey: string): EmbeddingsService {
  const api = ky.create({
    prefixUrl: "https://api.openai.com/v1",
    headers: { Authorization: `Bearer ${apiKey}` },
    retry: 2,
    timeout: 60_000,
  });

  async function embedChunk(texts: string[]): Promise<number[][]> {
    let body: unknown;
    try {
      body = await api
        .post("embeddings", {
          json: { model: EMBEDDING_MODEL, input: texts, dimensions: EMBEDDING_DIMENSIONS },
        })
        .json<unknown>();
    } catch (e) {
      const requestFailedDetail = `request failed: ${errorMessage(e)}`;
      throw new EmbeddingsError(requestFailedDetail, { cause: e });
    }
    return parseEmbeddingsResponse(body, texts.length);
  }

  return {
    async embed(texts) {
      if (texts.length === 0) return [];
      const results: number[][] = [];
      for (const chunk of chunkTexts(texts)) {
        results.push(...(await embedChunk(chunk)));
      }
      return results;
    },
  };
}

// ─── Fake implementation ─────────────────────────────────────────────────────

export interface FakeEmbeddingsOptions {
  /** The first N embed() calls throw an EmbeddingsError; calls after that succeed. */
  failTimes?: number;
}

export interface FakeEmbeddingsService extends EmbeddingsService {
  /** Every embed() call's input texts, in order. */
  calls: string[][];
  describe(): string;
}

export function createFakeEmbeddings(opts?: FakeEmbeddingsOptions): FakeEmbeddingsService {
  const failTimes = opts?.failTimes ?? 0;
  let attempt = 0;

  const fake: FakeEmbeddingsService = {
    calls: [],

    async embed(texts) {
      fake.calls.push(texts);
      attempt += 1;
      if (attempt <= failTimes) {
        const scriptedFailureDetail = `scripted failure (attempt ${String(attempt)} of ${String(failTimes)})`;
        throw new EmbeddingsError(scriptedFailureDetail);
      }
      if (texts.length === 0) return [];
      return texts.map((text) => deterministicUnitVector(text));
    },

    describe(): string {
      const lines = [`calls: ${String(fake.calls.length)}`];
      for (const [i, texts] of fake.calls.entries()) {
        lines.push(`[${String(i)}] ${texts.join(" | ")}`);
      }
      return lines.join("\n");
    },
  };

  return fake;
}

/** Simple string hash → seed for a deterministic PRNG (mulberry32). */
function stringSeed(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ (text.codePointAt(i) ?? 0), 2654435761) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Identical text always yields the identical unit-length vector. */
function deterministicUnitVector(text: string): number[] {
  const random = mulberry32(stringSeed(text));
  const raw = Array.from({ length: EMBEDDING_DIMENSIONS }, () => random() * 2 - 1);
  const magnitude = Math.sqrt(raw.reduce((sum, v) => sum + v * v, 0)) || 1;
  return raw.map((v) => v / magnitude);
}
