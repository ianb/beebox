/**
 * Scan-mode Gemini analysis: the prompt, response schema, shared page/usage
 * types, and the single-batch model call. The scan-import-helpers module and
 * its reconciliation sibling import the types from here, keeping this the
 * leaf module of the scan-import helper graph.
 */

import * as fs from "node:fs/promises";
import { GoogleGenAI } from "@google/genai";
import { getMimeType, GeminiEmptyResponseError } from "./describe-images-helpers.js";

/**
 * Per-page output from the scan-mode analyzer. The model classifies each
 * page and (when applicable) names a partner page within the same batch.
 *
 * `index` is the GLOBAL page index in the PDF after we translate from the
 * model's batch-relative indices.
 */
export interface ScanPageAnalysis {
  index: number;
  kind: "photo" | "back" | "blank" | "unsure";
  /** Global page index of the partner, or null. */
  paired_with_index: number | null;
  description: string;
  title: string;
  rotation: number;
  subject_bbox: number[] | null;
  has_text: boolean;
  text_blocks: Array<{ source: string; text: string }>;
  /** Date hint extracted from a back, in document form (e.g. "May 1985"). */
  date_hint: string | null;
  /** True when the model has low confidence in classification or transcription. */
  flag_for_review: boolean;
  flag_reason: string | null;
}

export interface RawScanAnalysis {
  index: number;
  kind: "photo" | "back" | "blank" | "unsure";
  paired_with_index: number | null;
  description: string;
  title: string;
  rotation: number;
  subject_bbox: number[] | null;
  has_text: boolean;
  text_blocks: Array<{ source: string; text: string }>;
  date_hint: string | null;
  flag_for_review: boolean;
  flag_reason: string | null;
}

export interface BatchUsage {
  prompt: number;
  output: number;
  thinking: number;
}

const SCAN_PROMPT = `You are analyzing scanned pages from a stack of physical photographs. Some photos have backs (often handwriting: a name, date, or short description; sometimes blank); some photos are single-sided with no back. Where a photo has a back, the back almost always immediately follows the photo — a photo at index i is paired with its back at i+1. Treat "back follows photo at i+1" as a strong default; deviate only on clear visual evidence (e.g. the page at i+1 is itself another photograph).

The pages you see are numbered 0..N-1 in the order they appear in this batch. Your job, for each page, is to:

1. Classify the page as one of:
   - "photo": a photograph of a scene, person, object, etc.
   - "back": the back of a photo — typically blank paper or paper with handwriting (a name, date, location). Backs of photos do NOT show pictures.
   - "blank": an entirely blank page with no markings worth keeping.
   - "unsure": you can't confidently classify it.

2. For "photo" and "back" pages, identify the partner page by index within this batch using paired_with_index. The dominant pattern is photo at i, back at i+1 — start there. Use other visual cues (handwriting referring to the photo's content, a date that fits the photo's apparent era) only as tiebreakers. If a photo has no back in this batch (single-sided photo, or partner is in another batch), set paired_with_index to null. Same for a back with no matching photo in this batch.

3. For PHOTO pages, fill:
   - description: one sentence describing what's in the photo (subjects, setting, era cues if visible).
   - title: a short filename-friendly title (2-4 words, underscores, retain capitals, e.g., "Beach_Vacation" or "Grandma_Birthday").
   - rotation: degrees clockwise the image needs to be rotated to view correctly — 0, 90, 180, 270. Judge by face orientation, sky/ground, text within the scene. Use 0 if uncertain.
   - subject_bbox: bounding box of the actual photo within the scanned page as [y1, x1, y2, x2] on a 0-1000 scale. The scanner typically captures whitespace around the photo; identify the photo's edges. null if the photo fills the page or you cannot tell.
   - has_text: true only if the photograph itself contains meaningful text (a sign in the scene, a banner, etc.) — NOT for handwriting on the back.
   - text_blocks: any meaningful text visible IN the photograph (signs, banners). Empty if none.

4. For BACK pages, fill:
   - description: empty string — backs don't get descriptions of their own.
   - title: empty string.
   - rotation: 0 (backs are read by the human; we don't rotate them).
   - subject_bbox: null.
   - has_text: true if there's handwriting or printing.
   - text_blocks: transcribe handwriting/printing exactly as written. Use source: "back" for each block. Preserve line breaks. Leave empty if the back is essentially blank.
   - date_hint: if the back contains a date that appears to refer to when the photo was taken, capture it as it appears (e.g. "May 1985", "8/14/72", "Christmas '63"). null otherwise.

5. For BLANK pages: leave all text fields empty, paired_with_index null, kind "blank".

6. flag_for_review: true when something is uncertain — handwriting that's hard to read, a back that might also be a photo, ambiguous pairing, unclear orientation. flag_reason: a short human-readable note explaining what to check. Set false / null when confident.

Important: paired_with_index is the index WITHIN THIS BATCH (0..N-1), not a global PDF page number. If the partner is not present in this batch, set it to null even if you suspect the partner exists elsewhere.`;

const SCAN_RESPONSE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      index: { type: "INTEGER" },
      kind: { type: "STRING", enum: ["photo", "back", "blank", "unsure"] },
      paired_with_index: { type: "INTEGER", nullable: true },
      description: { type: "STRING" },
      title: { type: "STRING" },
      rotation: { type: "INTEGER" },
      subject_bbox: { type: "ARRAY", items: { type: "INTEGER" }, nullable: true },
      has_text: { type: "BOOLEAN" },
      text_blocks: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: { source: { type: "STRING" }, text: { type: "STRING" } },
          required: ["source", "text"],
        },
      },
      date_hint: { type: "STRING", nullable: true },
      flag_for_review: { type: "BOOLEAN" },
      flag_reason: { type: "STRING", nullable: true },
    },
    required: [
      "index",
      "kind",
      "paired_with_index",
      "description",
      "title",
      "rotation",
      "subject_bbox",
      "has_text",
      "text_blocks",
      "date_hint",
      "flag_for_review",
      "flag_reason",
    ],
  },
} as const;

/**
 * Build the full Gemini prompt, optionally prefixed with boxholder-supplied
 * context (names of recurring people, eras, places, etc.). The context block
 * is wrapped with explicit guardrails so the model uses it for
 * disambiguation rather than inventing identifications.
 */
export function buildScanPrompt(boxholderContext: string | null): string {
  if (!boxholderContext || boxholderContext.trim().length === 0) {
    return SCAN_PROMPT;
  }
  const contextSection = `# Context from the boxholder

The following notes were provided by the person whose photos these are. Use them to:
- Disambiguate handwriting (a name on the back that fits a person mentioned here is more likely correct)
- Interpret eras, places, and relationships referenced in handwriting or visible in photos
- Write more meaningful descriptions when you can plausibly tie what you see to the notes

DO NOT invent identifications without strong visual or textual evidence. If you're not confident, prefer generic descriptions ("a young woman") or hedged ones ("possibly Noor, based on era and back caption") over confident misidentification.

---

${boxholderContext.trim()}

---

`;
  return contextSection + SCAN_PROMPT;
}

/**
 * Analyze a batch of consecutive scanned pages with Gemini Flash. Returns
 * analyses with batch-relative indices (0..N-1); the caller translates to
 * global indices.
 */
export async function analyzeScanBatchWithGemini(
  apiKey: string,
  {
    imagePaths,
    thinkingBudget,
    boxholderContext,
  }: { imagePaths: string[]; thinkingBudget?: number; boxholderContext?: string | null }
): Promise<{ analyses: RawScanAnalysis[]; usage: BatchUsage | null }> {
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

  const prompt = buildScanPrompt(boxholderContext ?? null);
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }, ...imageParts] }],
    config: {
      thinkingConfig: { thinkingBudget: thinkingBudget ?? 2048 },
      responseMimeType: "application/json",
      responseSchema: SCAN_RESPONSE_SCHEMA,
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

  const analyses: RawScanAnalysis[] = JSON.parse(text);
  const usage: BatchUsage | null = usageMeta
    ? {
        prompt: usageMeta.promptTokenCount || 0,
        output: usageMeta.candidatesTokenCount || 0,
        thinking: usageMeta.thoughtsTokenCount || 0,
      }
    : null;
  return { analyses, usage };
}
