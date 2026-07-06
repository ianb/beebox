/**
 * Helpers for the describe-images command.
 *
 * EXIF extraction, MIME type mapping, image file utilities, and Gemini API calls.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { parseCardName } from "../../cli/lib/paths.js";

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

export function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

export function isImageCard(filePath: string): boolean {
  return filePath.endsWith(".image.card");
}

export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };
  return mimes[ext] || "image/jpeg";
}

/**
 * Find the image file attached to an image card.
 * Image files share the card's basename (e.g., photo-001.jpg for photo-001.image.card).
 */
export async function findAttachedImage(cardPath: string): Promise<string | null> {
  const dir = path.dirname(cardPath);
  const parsed = parseCardName(path.basename(cardPath));
  if (!parsed) return null;

  const baseName = parsed.name;
  const entries = await fs.readdir(dir);
  for (const entry of entries) {
    if (entry.startsWith(baseName) && isImageFile(entry)) {
      return path.join(dir, entry);
    }
  }
  return null;
}

export interface ExifData {
  date?: string;
  camera?: string;
  gps?: string;
  width?: string;
  height?: string;
}

export async function extractExif(imagePath: string): Promise<ExifData | null> {
  try {
    const exifr = await import("exifr");
    const data = await exifr.default.parse(imagePath, {
      pick: [
        "DateTimeOriginal", "CreateDate", "ModifyDate",
        "Make", "Model",
        "GPSLatitude", "GPSLongitude",
        "ImageWidth", "ImageHeight", "ExifImageWidth", "ExifImageHeight",
      ],
    });
    if (!data) return null;

    const result: ExifData = {};

    const dateField = data.DateTimeOriginal || data.CreateDate || data.ModifyDate;
    if (dateField instanceof Date) {
      result.date = dateField.toISOString();
    }

    const make = data.Make ? String(data.Make).trim() : null;
    const model = data.Model ? String(data.Model).trim() : null;
    if (make && model) {
      // Avoid "Apple Apple iPhone" — model often includes make
      result.camera = model.startsWith(make) ? model : `${make} ${model}`;
    } else if (model) {
      result.camera = model;
    }

    if (data.GPSLatitude != null && data.GPSLongitude != null) {
      const lat = Number(data.GPSLatitude).toFixed(6);
      const lon = Number(data.GPSLongitude).toFixed(6);
      result.gps = `${lat},${lon}`;
    }

    const w = data.ExifImageWidth || data.ImageWidth;
    const h = data.ExifImageHeight || data.ImageHeight;
    if (w && h) {
      result.width = String(w);
      result.height = String(h);
    }

    if (Object.keys(result).length === 0) return null;
    return result;
  } catch (_err) {
    return null;
  }
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
 * Structured output schema for Gemini's per-image response, and the single
 * source of truth for its shape (Track D.5: this used to be described three
 * times — a hand-written TS interface, the hand-written `responseSchema`
 * object below that drives Gemini's structured output, and a bare
 * `JSON.parse(...) as ImageAnalysis[]` cast on the result). `ImageAnalysis`
 * is now derived from this schema; the `responseSchema` JSON stays
 * hand-written (Gemini's schema dialect — `"STRING"`/`"INTEGER"` string
 * literals, no `additionalProperties`, `nullable` instead of optional — isn't
 * something zod emits cheaply) but is colocated with this schema in
 * `analyzeImagesWithGemini` below so the pairing is visible and reviewable
 * as one unit.
 */
export const imageAnalysisSchema = z.object({
  index: z.number(),
  description: z.string(),
  contains: z.string(),
  title: z.string(),
  has_text: z.boolean(),
  text_blocks: z.array(z.object({ source: z.string(), text: z.string() })),
  invalid: z.boolean(),
  subject_bbox: z.array(z.number()).nullable(),
  rotation: z.number(),
  is_document: z.boolean(),
  document_kind: z.string().nullable(),
  document_from: z.string().nullable(),
  document_dates: z.array(z.object({ label: z.string(), value: z.string() })),
});

export type ImageAnalysis = z.infer<typeof imageAnalysisSchema>;

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

/**
 * Call Gemini 2.5 Flash to analyze a batch of images.
 * Returns structured analysis for each image.
 */
export async function analyzeImagesWithGemini(
  apiKey: string,
  { imagePaths, thinkingBudget }: { imagePaths: string[]; thinkingBudget?: number }
): Promise<{ analyses: ImageAnalysis[]; usage: { prompt: number; output: number; thinking: number } | null }> {
  const ai = new GoogleGenAI({ apiKey });

  const imageParts = [];
  for (const imgPath of imagePaths) {
    const imgData = await fs.readFile(imgPath);
    imageParts.push({
      inlineData: {
        mimeType: getMimeType(imgPath),
        data: imgData.toString("base64"),
      },
    });
  }

  const prompt = `You are analyzing ${imagePaths.length} image(s) that were captured together in a session. They may be related to each other.

For each image (indexed 0 to ${imagePaths.length - 1}), provide:

1. description: one sentence describing what's in the image — visual, suitable as alt text.

1b. contains: one sentence stating what someone could learn from this image. When the information is concise, the sentence carries the information itself (e.g., "Boiler serial number K-44210" or "Dentist appointment moved to June 17") rather than pointing at it ("contains scheduling information"); when it isn't concise, say what's learnable (e.g., "Itemized 2003 ledger account figures"). Never a list of parts; under 200 characters.

2. title: a short filename-friendly title (2-4 words, underscores, retain capitals, e.g., "Utility_Bill" or "Piano_Business_Card").

3. has_text: true if the image contains readable text that is part of the subject (document, whiteboard, business card, sign, label, engraving). Ignore incidental background text — brand names on equipment, text in the scenery, etc. Must be true whenever is_document is true.

4. text_blocks: if has_text, extract the unique information the text is meant to convey, organized by source (what the text is physically on). Use Markdown. Use Markdown tables for tabular data. The original image is preserved, so you do NOT need to transcribe everything — focus on the data. KEEP: amounts, totals, line items, dates, names, addresses, account numbers, reference numbers, phone numbers, tables of figures, handwritten notes, specific values and labels that identify what the data means. DROP: legal/privacy/compliance footers, marketing copy, return addresses, page numbers, repeated column headers across pages, "see reverse for…" / "terms and conditions apply" / generic disclosures, slogans, decorative boilerplate. When in doubt about boilerplate, drop it. Empty array if no text.

5. invalid: true if this image is useless — accidental capture, too blurry to read, covered lens, etc.

6. subject_bbox: bounding box of the main subject as [y1, x1, y2, x2] on a 0-1000 scale (a document on a surface, a coin on a table, a specific object being photographed — whatever the photo is "of"). null if the subject fills the frame or there's no clear focal subject.

7. rotation: degrees clockwise the image needs to view correctly — 0 (upright), 90 (rotated 90° clockwise, needs counter-clockwise rotation to fix), 180 (upside down), or 270. Judge by text direction, face orientation, or natural object orientation. Use 0 if uncertain.

8. is_document: true if this is a photograph of a document — a piece of paper, a form, a letter, a bill or statement, a receipt, a contract, a certificate, a prescription, a report, a screen showing a document, etc. False for whiteboards, business cards, coins, signs, objects, scenes, people — even if they contain text.

9. If is_document is true, also fill:
   - document_kind: a short lowercase category, 2-5 words, describing what kind of document this is (e.g., "utility bill", "medical lab results", "pay stub", "insurance explanation of benefits", "handwritten note", "tax form w-2", "appointment reminder", "prescription label", "bank statement"). Be specific about the kind, but do not include the issuer's name.
   - document_from: the issuer or sender — the organization or person the document is from (e.g., "Con Edison", "Dr. Jane Smith", "IRS"). null if unclear.
   - document_dates: every date that appears on the document, each with a label describing what the date represents. Examples: {"label": "due", "value": "4/30/26"}, {"label": "billing period end", "value": "March 31, 2026"}, {"label": "statement", "value": "2026-04-01"}, {"label": "appointment", "value": "Fri May 8"}. Use the date string AS IT APPEARS on the document — do not reformat. Empty array if there are no dates.

   If is_document is false: document_kind null, document_from null, document_dates [].`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }, ...imageParts] }],
    config: {
      // Cap thinking tokens. Default (auto) burned ~11k thinking tokens on
      // 8-image batches of financial documents and tripped Gemini's RECITATION
      // filter, returning empty responses. Successful smaller batches use
      // ~400. 2048 leaves plenty of headroom for "what is this" reasoning
      // without giving the model room to internally reproduce document text.
      thinkingConfig: { thinkingBudget: thinkingBudget ?? 2048 },
      responseMimeType: "application/json",
      // Hand-written pairing with `imageAnalysisSchema` above: this drives
      // Gemini's structured-output constraint (its own schema dialect —
      // "STRING"/"INTEGER" string literals, `nullable` instead of optional —
      // isn't something zod emits cheaply), while `imageAnalysisSchema`
      // validates what actually comes back and is the type's source of
      // truth. Keep the two in sync by hand when either changes.
      responseSchema: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            index: { type: "INTEGER" },
            description: { type: "STRING" },
            contains: { type: "STRING" },
            title: { type: "STRING" },
            has_text: { type: "BOOLEAN" },
            text_blocks: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: { source: { type: "STRING" }, text: { type: "STRING" } },
                required: ["source", "text"],
              },
            },
            invalid: { type: "BOOLEAN" },
            subject_bbox: { type: "ARRAY", items: { type: "INTEGER" }, nullable: true },
            rotation: { type: "INTEGER" },
            is_document: { type: "BOOLEAN" },
            document_kind: { type: "STRING", nullable: true },
            document_from: { type: "STRING", nullable: true },
            document_dates: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: { label: { type: "STRING" }, value: { type: "STRING" } },
                required: ["label", "value"],
              },
            },
          },
          required: ["index", "description", "contains", "title", "has_text", "text_blocks", "invalid", "subject_bbox", "rotation", "is_document", "document_kind", "document_from", "document_dates"],
        },
      },
    },
  });

  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  const usageMeta = response.usageMetadata;
  if (!text) {
    throw new GeminiEmptyResponseError({
      finishReason: response.candidates?.[0]?.finishReason,
      finishMessage: response.candidates?.[0]?.finishMessage,
      blockReason: response.promptFeedback?.blockReason,
      blockReasonMessage: response.promptFeedback?.blockReasonMessage,
      promptTokens: usageMeta?.promptTokenCount,
      candidatesTokens: usageMeta?.candidatesTokenCount,
      thoughtsTokens: usageMeta?.thoughtsTokenCount,
      totalTokens: usageMeta?.totalTokenCount,
      imageCount: imagePaths.length,
    });
  }

  const analyses = parseGeminiJsonArray(text, { itemSchema: imageAnalysisSchema });
  const usage = usageMeta ? {
    prompt: usageMeta.promptTokenCount || 0,
    output: usageMeta.candidatesTokenCount || 0,
    thinking: usageMeta.thoughtsTokenCount || 0,
  } : null;

  return { analyses, usage };
}
