/**
 * Image card schema — photos from capture sessions.
 *
 * Created by the capture connector. Processed by `cb describe-images`
 * (Gemini Flash) to add description, OCR text blocks, subject bbox,
 * rotation, and document metadata.
 *
 * Layout: `photo-001.image.card` next to `photo-001.attach/photo-001.jpg`.
 * `filename.ref:` points into the attach scope via the `attach/` virtual
 * prefix.
 */

import { cardSchema, type CardSchema } from "cardworks";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { type FileLoader, titleFromFilename, truncateTitle } from "../core/file-summary.js";

export const ImageStatus = z.enum(["new", "analyzed", "invalid"]);
export type ImageStatus = z.infer<typeof ImageStatus>;

export const ImageSource = z.enum([
  "camera-user",
  "camera-environment",
  "gallery",
  "screenshot",
  "download",
  "scan",
  "generated",
]);
export type ImageSource = z.infer<typeof ImageSource>;

export const ImageRotation = z.enum(["0", "90", "180", "270"]);
export type ImageRotation = z.infer<typeof ImageRotation>;

const FilenameEntry = z.object({
  ref: z.string(),
  captured: z.string().datetime({ offset: true }),
  source: ImageSource,
});

const TextBlock = z.object({
  source: z.string().optional(),
  content: z.string(),
});

const ExifMeta = z.object({
  date: z.string().datetime({ offset: true }).optional(),
  camera: z.string().optional(),
  gps: z.string().optional(),
  width: z.string().optional(),
  height: z.string().optional(),
});

const SubjectBbox = z.object({
  y1: z.string(),
  x1: z.string(),
  y2: z.string(),
  x2: z.string(),
});

const DocumentDate = z.object({
  label: z.string(),
  value: z.string(),
});

const DocumentMeta = z.object({
  kind: z.string().optional(),
  from: z.string().optional(),
  dates: z.array(DocumentDate).optional(),
});

export const ImageSchema: CardSchema = cardSchema("image", {
  fields: {
    status: ImageStatus.default("new"),
    "has-text": z.boolean().optional(),
    rotation: ImageRotation.optional(),
    filename: FilenameEntry,
    description: z.string().optional(),
    creation: z.string().optional(),
    text: z.array(TextBlock).optional(),
    exif: ExifMeta.optional(),
    "subject-bbox": SubjectBbox.optional(),
    document: DocumentMeta.optional(),
  },
  instructions: `# Image Cards

An image card represents a photo, typically from a capture session.
The attached image file lives in the card's attach scope (e.g.
\`photo-001.image.card\` with \`photo-001.attach/photo-001.jpg\`);
\`filename.ref:\` points into that scope via the \`attach/\` prefix.

Frontmatter fields:
- \`filename:\` — \`{ref, captured, source}\` for the attached image
  file. \`captured\` is set from EXIF when available.
- \`description:\` — one-sentence summary of what's in the image
  (filled during analysis).
- \`creation:\` — optional free-text notes on how the image came to
  be. Only include when there's something worth recording. For
  AI-generated images (\`source: generated\`), use \`model: {modelId}\\nprompt: {prompt text}\`.
- \`text:\` — array of \`{source?, content}\` entries with transcribed
  text content from the image, if any. \`source\` describes what the
  text is on ("whiteboard", "business card", "printed page",
  "screen").
- \`exif:\` — EXIF metadata extracted from the image file.
- \`subject-bbox:\` — bounding box of the main subject on a 0-1000
  scale (\`{y1, x1, y2, x2}\`). Present when the subject doesn't fill
  the entire frame.
- \`document:\` — present when the image is a photograph of a document
  (bill, letter, form, receipt, statement, …). \`kind\` is a short
  free-text category ("utility bill", "lab results"), \`from\` is the
  issuer/sender, \`dates\` is an array of \`{label, value}\` entries.
  Date values are kept as they appear in the document; normalization
  happens downstream.
- \`has-text\` — true if the image contains readable text, false
  otherwise. Always true when a \`document:\` field is present.
- \`rotation\` — degrees clockwise the image needs to be rotated to
  appear upright: \`"0"\`, \`"90"\`, \`"180"\`, or \`"270"\`.

Analysis is done by \`cb describe-images\`, which sends images to
Gemini Flash for OCR, description, subject detection, and rotation,
and extracts EXIF metadata. Pass multiple image cards or image files
to process them as a batch (provides better context when images are
related). Use \`--no-rename\` to skip automatic renaming.

Status: new (unanalyzed) → analyzed (description filled in) → invalid
(accidental capture, too blurry, not useful).`,
});

export interface ImageFields {
  type: "image";
  status: ImageStatus;
  "has-text"?: boolean;
  rotation?: ImageRotation;
  filename: { ref: string; captured: string; source: ImageSource };
  description?: string;
  creation?: string;
  text?: Array<{ source?: string; content: string }>;
  exif?: { date?: string; camera?: string; gps?: string; width?: string; height?: string };
  "subject-bbox"?: { y1: string; x1: string; y2: string; x2: string };
  document?: { kind?: string; from?: string; dates?: Array<{ label: string; value: string }> };
}

/**
 * Loader summary used by the file viewer: derives a title from
 * description, filename, or path. Falls back gracefully when the file
 * isn't a parsed card yet.
 */
export interface ImageAttrs {
  status: ImageStatus;
  "has-text"?: boolean;
  rotation?: ImageRotation;
  filename?: string;
}

export const imageLoader: FileLoader<ImageAttrs> = (raw) => {
  const fallback = titleFromFilename(raw.path);
  // For Phase 2 image cards the raw input is the parsed YAML fields object.
  // eslint-disable-next-line no-restricted-syntax -- raw is the loosely-typed loader input; reading the optional Phase-2 `fields` object off it requires one boundary cast.
  const fields = (raw as { fields?: Partial<ImageFields> }).fields;
  if (fields === undefined) {
    return { path: raw.path, tagName: "image", title: fallback, attrs: { status: "new" } };
  }
  const description = fields.description;
  const ref = fields.filename?.ref;
  let title = "";
  if (typeof description === "string" && description.trim() !== "") {
    title = description.trim();
  } else if (typeof ref === "string" && ref !== "") {
    title = titleFromFilename(ref);
  }
  if (title === "") title = fallback;
  title = truncateTitle(title, 80);
  const attrs: ImageAttrs = { status: fields.status ?? "new" };
  if (typeof fields["has-text"] === "boolean") attrs["has-text"] = fields["has-text"];
  if (fields.rotation !== undefined) attrs.rotation = fields.rotation;
  if (typeof ref === "string" && ref !== "") attrs.filename = ref;
  return { path: raw.path, tagName: "image", title, attrs };
};

/**
 * Build the file content for a new image card. Used by the capture
 * connector when first storing a photo — analysis fields are filled
 * in later by `cb describe-images`.
 */
export function createImageTemplate(options: {
  capturedAt: string;
  source: ImageSource;
  filename: string;
}): string {
  const fields = {
    status: "new",
    filename: {
      ref: `attach/${options.filename}`,
      captured: options.capturedAt,
      source: options.source,
    },
  };
  return `---\n${stringifyYaml(fields)}---\n`;
}
