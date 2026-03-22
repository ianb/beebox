/** @jsxImportSource cardworks/jsx */
/**
 * Image card schema - photos from capture sessions.
 *
 * Created by the capture connector when pulling sessions.
 * Processed by the agent to add descriptions and OCR text.
 */

import { element, serialize } from "cardworks";
import { z } from "zod";

export const ImageStatus = z.enum(["new", "analyzed", "invalid"]);
export type ImageStatus = z.infer<typeof ImageStatus>;

export const ImageFilename = element("filename", {
  attrs: {
    name: z.string(),
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

/**
 * Image card schema.
 *
 * Example:
 * ```xml
 * <image status="analyzed" has-text="true">
 * <filename name="photo-001.jpg" captured="2024-01-15T10:00:00Z" source="camera-environment" />
 * <description>Whiteboard with project timeline and milestones</description>
 * <text source="whiteboard">## Project Timeline\n- Phase 1: Jan-Feb\n- Phase 2: Mar-Apr</text>
 * </image>
 * ```
 */
export const ImageSchema = element("image", {
  attrs: {
    status: ImageStatus.default("new"),
    "has-text": z.enum(["true", "false"]).optional(),
  },
  children: z.array(
    z.union([
      ImageFilename,
      ImageDescription,
      ImageText,
      ImageExif,
    ])
  ),
  instructions: `# Image Cards

An image card represents a photo, typically from a capture session. The attached image file shares the card's basename (e.g. \`photo-001.jpg\` alongside \`photo-001.image.card\`).

Elements:
- \`<filename>\` — the attached image file. The \`captured\` attribute is updated from EXIF data when available.
- \`<description>\` — one-sentence summary of what's in the image (filled during analysis)
- \`<text source="...">\` — transcribed text content from the image, if any (source describes what the text is on: "whiteboard", "business card", "printed page", "screen"). Multiple \`<text>\` elements allowed for different sources.
- \`<exif>\` — EXIF metadata extracted from the image file (date, camera, GPS, dimensions)
- \`has-text\` attribute — "true" if the image contains readable text, "false" otherwise

Analysis is done by \`cb describe-images\`, which sends images to Gemini Flash for OCR, description, and document bounding boxes, and extracts EXIF metadata. Pass multiple image cards or image files to process them as a batch (provides better context when images are related). Use \`--no-rename\` to skip automatic renaming.

Status: new (unanalyzed) → analyzed (description filled in) → invalid (accidental capture, too blurry, not useful).`,
});

export type Image = z.infer<typeof ImageSchema>;

/**
 * Template for creating an image card.
 */
export function createImageTemplate(options: {
  capturedAt: string;
  source: string;
  filename: string;
}): string {
  const image = (
    <image status="new">
      <filename name={options.filename} captured={options.capturedAt} source={options.source} />
      <description></description>
    </image>
  );

  return serialize(image) + "\n";
}
