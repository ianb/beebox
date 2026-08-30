/**
 * Helpers for scan-import's Gemini image analysis: image file utilities,
 * MIME type mapping, and Gemini structured-output response parsing.
 */

import * as path from "node:path";
import type { z } from "zod";
import { extensionToMimetype } from "../../lib/mimetype.js";

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

export function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

export function getMimeType(filePath: string): string {
  // Only ever called on files that passed isImageFile (jpg/jpeg/png/webp/gif),
  // so the fallback is a defensive default; image/jpeg per the original.
  const ext = path.extname(filePath).toLowerCase();
  return extensionToMimetype(ext, { fallback: "image/jpeg" });
}

/**
 * Thrown when Gemini returns no text in the response. Captures finishReason,
 * promptFeedback, and token usage so the caller can tell whether the cause was
 * MAX_TOKENS (often: thinking budget exhausted by a too-large image batch),
 * SAFETY blocking, or something else. The message embeds these fields so it
 * surfaces in procedure run logs without extra plumbing.
 */
export class GeminiEmptyResponseError extends Error {
  finishReason: string | undefined;
  finishMessage: string | undefined;
  blockReason: string | undefined;
  blockReasonMessage: string | undefined;
  promptTokens: number | undefined;
  candidatesTokens: number | undefined;
  thoughtsTokens: number | undefined;
  totalTokens: number | undefined;
  imageCount: number;

  constructor({
    finishReason,
    finishMessage,
    blockReason,
    blockReasonMessage,
    promptTokens,
    candidatesTokens,
    thoughtsTokens,
    totalTokens,
    imageCount,
  }: {
    finishReason: string | undefined;
    finishMessage: string | undefined;
    blockReason: string | undefined;
    blockReasonMessage: string | undefined;
    promptTokens: number | undefined;
    candidatesTokens: number | undefined;
    thoughtsTokens: number | undefined;
    totalTokens: number | undefined;
    imageCount: number;
  }) {
    const parts: string[] = ["Empty response from Gemini"];
    parts.push(`images=${imageCount}`);
    if (finishReason) parts.push(`finishReason=${finishReason}`);
    if (finishMessage) parts.push(`finishMessage=${JSON.stringify(finishMessage)}`);
    if (blockReason) parts.push(`blockReason=${blockReason}`);
    if (blockReasonMessage) parts.push(`blockReasonMessage=${JSON.stringify(blockReasonMessage)}`);
    if (promptTokens != null) parts.push(`promptTokens=${promptTokens}`);
    if (candidatesTokens != null) parts.push(`candidatesTokens=${candidatesTokens}`);
    if (thoughtsTokens != null) parts.push(`thoughtsTokens=${thoughtsTokens}`);
    if (totalTokens != null) parts.push(`totalTokens=${totalTokens}`);
    super(parts.join(" "));
    this.name = "GeminiEmptyResponseError";
    this.finishReason = finishReason;
    this.finishMessage = finishMessage;
    this.blockReason = blockReason;
    this.blockReasonMessage = blockReasonMessage;
    this.promptTokens = promptTokens;
    this.candidatesTokens = candidatesTokens;
    this.thoughtsTokens = thoughtsTokens;
    this.totalTokens = totalTokens;
    this.imageCount = imageCount;
  }
}

/**
 * Thrown when a Gemini structured-output response isn't valid JSON, or isn't
 * the array-of-objects shape the schema requires at the top level. Distinct
 * from {@link GeminiEmptyResponseError} (an API-level failure — Gemini
 * declined to answer) — this is a boundary-validation failure on content
 * Gemini *did* return, so callers can tell "the API failed" apart from "the
 * API answered but the shape was unusable."
 */
export class GeminiResponseShapeError extends Error {
  constructor(reason: string) {
    super(["Gemini response was not the expected shape", reason].join(": "));
    this.name = "GeminiResponseShapeError";
  }
}

/**
 * Parse a Gemini structured-output response as a JSON array and validate
 * each element against `itemSchema`. A malformed top-level shape (not JSON,
 * or not an array) throws {@link GeminiResponseShapeError} — the whole
 * response is unusable. Elements that fail per-item validation are dropped
 * and logged individually (mirrors the existing out-of-range-index drop
 * pattern in `scan-import-helpers.ts`'s `translateIndices`) rather than
 * failing the whole batch over one bad element.
 */
export function parseGeminiJsonArray<T>(
  text: string,
  { itemSchema, log }: { itemSchema: z.ZodType<T>; log?: ((line: string) => void) | undefined }
): T[] {
  let warn: (line: string) => void;
  if (log) {
    warn = log;
  } else {
    warn = (line: string) => console.warn(line);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    const parseErrorMessage = e instanceof Error ? e.message : String(e);
    const reason = ["invalid JSON", parseErrorMessage].join(": ");
    throw new GeminiResponseShapeError(reason);
  }
  if (!Array.isArray(raw)) {
    const reason = ["expected a JSON array, got", typeof raw].join(" ");
    throw new GeminiResponseShapeError(reason);
  }
  const items: T[] = [];
  for (const [i, entry] of raw.entries()) {
    const result = itemSchema.safeParse(entry);
    if (!result.success) {
      warn(`Gemini response entry ${i} failed validation, dropping: ${result.error.issues.map((issue) => issue.message).join("; ")}`);
      continue;
    }
    items.push(result.data);
  }
  return items;
}
