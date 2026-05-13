/** @jsxImportSource cardworks/jsx */
/**
 * Image card schema - photos from capture sessions.
 *
 * Created by the capture connector when pulling sessions.
 * Processed by the agent to add descriptions and OCR text.
 */

import { element, serialize } from "cardworks";
import { z } from "zod";
import { type FileLoader, titleFromFilename, truncateTitle } from "../core/file-summary.js";

export const ImageStatus = z.enum(["new", "analyzed", "invalid"]);
export type ImageStatus = z.infer<typeof ImageStatus>;

export const ImageFilename = element("filename", {
  attrs: {
    ref: z.string(),
    captured: z.string().datetime({ offset: true }),
    source: z.enum(["camera-user", "camera-environment", "gallery"]),
  },
});

export const ImageDescription = element("description", {
  text: z.string().optional(),
});

export const ImageText = element("text", {
  attrs: {
    source: z.string().optional(),
  },
  text: z.string().optional(),
});

export const ImageExif = element("exif", {
  attrs: {
    date: z.string().datetime({ offset: true }).optional(),
    camera: z.string().optional(),
    gps: z.string().optional(),
    width: z.string().optional(),
    height: z.string().optional(),
  },
});

export const ImageSubjectBbox = element("subject-bbox", {
  attrs: {
    y1: z.string(),
    x1: z.string(),
    y2: z.string(),
    x2: z.string(),
  },
});

export const ImageDate = element("date", {
  attrs: {
    label: z.string(),
  },
  text: z.string(),
});

export const ImageDocument = element("document", {
  attrs: {
    kind: z.string().optional(),
    from: z.string().optional(),
  },
  children: z.array(ImageDate).optional(),
});

/**
 * Image card schema.
 *
 * Example:
 * ```xml
 * <image status="analyzed" has-text="true">
 * <filename ref="attach/photo-001.jpg" captured="2024-01-15T10:00:00Z" source="camera-environment" />
 * <description>Whiteboard with project timeline and milestones</description>
 * <text source="whiteboard">## Project Timeline\n- Phase 1: Jan-Feb\n- Phase 2: Mar-Apr</text>
 * </image>
 * ```
 */
export const ImageSchema = element("image", {
  attrs: {
    status: ImageStatus.default("new"),
    "has-text": z.enum(["true", "false"]).optional(),
    rotation: z.enum(["0", "90", "180", "270"]).optional(),
  },
  children: z.array(
    z.union([
      ImageFilename,
      ImageDescription,
      ImageText,
      ImageExif,
      ImageSubjectBbox,
      ImageDocument,
    ])
  ),
  instructions: `# Image Cards

An image card represents a photo, typically from a capture session. The attached image file lives in the card's attach scope (e.g. \`photo-001.image.card\` with \`photo-001.image.attach/photo-001.jpg\`); the \`<filename ref="attach/…">\` prefix points into that scope.

Elements:
- \`<filename>\` — the attached image file. The \`captured\` attribute is updated from EXIF data when available.
- \`<description>\` — one-sentence summary of what's in the image (filled during analysis)
- \`<text source="...">\` — transcribed text content from the image, if any (source describes what the text is on: "whiteboard", "business card", "printed page", "screen"). Multiple \`<text>\` elements allowed for different sources.
- \`<exif>\` — EXIF metadata extracted from the image file (date, camera, GPS, dimensions)
- \`<subject-bbox y1="..." x1="..." y2="..." x2="...">\` — bounding box of the main subject on a 0-1000 scale (coordinates are [y1, x1, y2, x2]). Present when the subject doesn't fill the entire frame.
- \`<document kind="..." from="...">\` — present when the image is a photograph of a document (bill, letter, form, receipt, statement, etc.). \`kind\` is a short free-text category ("utility bill", "lab results"), \`from\` is the issuer/sender. Contains \`<date label="...">value</date>\` children, one per date on the document. Date values are kept as they appear in the document; normalization happens downstream.
- \`has-text\` attribute — "true" if the image contains readable text, "false" otherwise. Always "true" when a \`<document>\` child is present.
- \`rotation\` attribute — degrees clockwise the image needs to be rotated to appear upright: "0", "90", "180", or "270"

Analysis is done by \`cb describe-images\`, which sends images to Gemini Flash for OCR, description, subject detection, and rotation, and extracts EXIF metadata. Pass multiple image cards or image files to process them as a batch (provides better context when images are related). Use \`--no-rename\` to skip automatic renaming.

Status: new (unanalyzed) → analyzed (description filled in) → invalid (accidental capture, too blurry, not useful).`,
});

export type Image = z.infer<typeof ImageSchema>;

/**
 * Attrs shape returned by the image loader. Includes the schema's own attrs
 * plus the attached image filename pulled from the `<filename>` child — useful
 * for rendering a thumbnail without re-parsing the card.
 */
export type ImageAttrs = Image["attrs"] & {
  filename?: string;
};

/**
 * Image loader — title derived from <description>, <filename name>, or the path.
 */
export const imageLoader: FileLoader<ImageAttrs> = (raw) => {
  const el = raw.element;
  const fallback = titleFromFilename(raw.path);
  if (!el) {
    return { path: raw.path, tagName: "image", title: fallback, attrs: { status: "new" } };
  }

  let title = "";
  let filename: string | undefined;
  for (const child of el.children) {
    if (child.tagName === "filename") {
      const ref = child.attrs["ref"];
      if (typeof ref === "string" && ref.length > 0) filename = ref;
    }
    if (child.tagName === "description" && typeof child.text === "string" && child.text.trim()) {
      title = child.text.trim();
    }
  }
  if (!title && filename) title = titleFromFilename(filename);
  if (!title) title = fallback;
  title = truncateTitle(title, 80);

  const status = el.attrs["status"];
  const hasText = el.attrs["has-text"];
  const rotation = el.attrs["rotation"];
  const attrs: ImageAttrs = {
    status: (status === "new" || status === "analyzed" || status === "invalid") ? status : "new",
    ...(hasText === "true" || hasText === "false" ? { "has-text": hasText } : {}),
    ...(rotation === "0" || rotation === "90" || rotation === "180" || rotation === "270"
      ? { rotation }
      : {}),
    ...(filename ? { filename } : {}),
  };

  return { path: raw.path, tagName: "image", title, attrs };
};

/**
 * Template for creating an image card.
 *
 * `filename` is the bare attached filename (e.g. `photo-001.jpg`). The template
 * emits it with the `attach/` virtual prefix, pointing into the card's attach
 * scope.
 */
export function createImageTemplate(options: {
  capturedAt: string;
  source: string;
  filename: string;
}): string {
  const image = (
    <image status="new">
      <filename ref={`attach/${options.filename}`} captured={options.capturedAt} source={options.source} />
      <description></description>
    </image>
  );

  return serialize(image) + "\n";
}
