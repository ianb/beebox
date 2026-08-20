/**
 * Image card schema — photos from capture sessions.
 *
 * Created by the capture preparation worker (or `cb scan-import` for
 * standalone photo/PDF batches). A capture-session image starts at
 * `status: new`; the chat agent working the parent capture card fills in
 * description/OCR/rotation/document metadata itself (via subagents reading
 * the image file) as part of annotating that capture. `cb scan-import` runs
 * its own Gemini analysis at import time instead, so its image cards can
 * arrive already `analyzed`.
 *
 * Layout: `photo-001.image.card` next to `photo-001.attach/photo-001.jpg`.
 * `filename.ref:` points into the attach scope via the `attach/` virtual
 * prefix.
 */

import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { cardSchema, type InferCardFields } from "../cards/index.js";
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

export const ImageSchema = cardSchema("image", {
  description: "A photo (typically from a capture session) — the image file lives in the attach scope; analysis fills description/OCR/EXIF",
  category: "synced",
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
The image file itself lives in the card's attach scope, pointed to by
\`filename.ref:\` (attach scope: see ABOUT_CARDS).

Frontmatter fields:
- \`filename:\` — \`{ref, captured, source}\` for the attached image
  file. \`captured\` is the acquisition timestamp supplied by the
  capture/upload/import flow (for example, camera shutter time,
  gallery selection time, or import-session start). It is not
  derived from EXIF.
- \`description:\` — one sentence describing what the image *looks
  like* (filled during analysis) — the visual field, used as alt text.
- \`contains:\` — one sentence stating what someone could *learn* from
  this image — the retrieval field (also filled during analysis; when
  absent, search falls back to \`description\`). Carry the fact when
  it's concise ("Boiler serial number K-44210"), don't point at it.
- \`creation:\` — optional free-text notes on how the image came to
  be. Only include when there's something worth recording. For
  AI-generated images (\`source: generated\`), use \`model: {modelId}\\nprompt: {prompt text}\`.
- \`text:\` — array of \`{source?, content}\` entries with transcribed
  text content from the image, if any. \`source\` describes what the
  text is on ("whiteboard", "business card", "printed page",
  "screen").
- \`exif:\` — EXIF metadata extracted from the image file. Put the
  camera's original photographic timestamp in \`exif.date\` when
  available; it may differ from \`filename.captured\`.
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

For an image that arrived as part of a capture, analysis is your
job: OCR any text and write a description via a subagent that reads
the actual image file (don't infer content from the transcript
alone), then fill in the fields above and set \`status: analyzed\`.
For an image dropped by \`cb scan-import\`, analysis already ran
(Gemini) at import time — treat those fields as authoritative unless
something looks wrong.

Status: new (unanalyzed) → analyzed (description filled in) → invalid
(accidental capture, too blurry, not useful).`,
});

export type ImageFields = InferCardFields<typeof ImageSchema>;

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
    return { path: raw.path, type: "image", title: fallback, attrs: { status: "new" } };
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
  return { path: raw.path, type: "image", title, attrs };
};

/**
 * Build the file content for a new image card. Used when first storing a
 * captured photo — analysis fields are filled in later by the chat agent
 * annotating the parent capture card.
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
