/**
 * Helpers for the describe-images command.
 *
 * EXIF extraction, MIME type mapping, image file utilities, and Gemini API calls.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { GoogleGenAI } from "@google/genai";
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
 * Structured output schema for Gemini's response.
 */
export interface ImageAnalysis {
  index: number;
  description: string;
  title: string;
  has_text: boolean;
  text_blocks: Array<{
    source: string;
    text: string;
  }>;
  invalid: boolean;
  subject_bbox: number[] | null;
  rotation: number;
}

/**
 * Call Gemini 2.5 Flash to analyze a batch of images.
 * Returns structured analysis for each image.
 */
export async function analyzeImagesWithGemini(
  apiKey: string,
  { imagePaths }: { imagePaths: string[] }
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
1. A one-sentence description of what's in the image
2. A short title suitable for a filename (2-4 words, use underscores, retain capitals, e.g., "Utility_Bill" or "Piano_Business_Card")
3. Whether the image contains readable text that is part of the subject (has_text). Ignore incidental or background text — text on objects in the background, brand names on equipment, etc. Only count text that the photographer intended to capture.
4. If it has text: extract all readable text that is part of the subject, organized by source (what the text is physically on). Use Markdown formatting. For tables, use Markdown tables. Do not extract incidental text from the background.
5. Whether this image seems invalid or useless (accidental capture, too blurry to read, etc.)
6. The bounding box of the main subject or item of interest as [y1, x1, y2, x2] on a 0-1000 scale. This could be a document on a surface, a coin on a table, a specific object being photographed, etc. — whatever the photo is "of". null only if the subject fills the entire frame or there's no clear focal subject.
7. The rotation needed to view the image correctly, in degrees clockwise: 0 (upright), 90 (rotated 90° clockwise, needs counter-clockwise rotation to fix), 180 (upside down), or 270. Judge by text direction, face orientation, or natural object orientation. Use 0 if uncertain.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }, ...imageParts] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            index: { type: "INTEGER" },
            description: { type: "STRING" },
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
          },
          required: ["index", "description", "title", "has_text", "text_blocks", "invalid", "subject_bbox", "rotation"],
        },
      },
    },
  });

  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Empty response from Gemini");
  }

  const analyses: ImageAnalysis[] = JSON.parse(text);
  const usageMeta = response.usageMetadata;
  const usage = usageMeta ? {
    prompt: usageMeta.promptTokenCount || 0,
    output: usageMeta.candidatesTokenCount || 0,
    thinking: usageMeta.thoughtsTokenCount || 0,
  } : null;

  return { analyses, usage };
}
