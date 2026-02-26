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

/**
 * Image card schema.
 *
 * Example:
 * ```xml
 * <image status="analyzed" has-text="true">
 *   <filename name="photo-001.jpg" captured="2024-01-15T10:00:00Z" source="camera-environment" />
 *   <description>Whiteboard with project timeline and milestones</description>
 *   <text source="whiteboard">## Project Timeline\n- Phase 1: Jan-Feb\n- Phase 2: Mar-Apr</text>
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
    ])
  ),
  instructions: `# Handling Images

Images are photos from capture sessions. Each image card has an attached image file (same basename, e.g. photo-001.jpg alongside photo-001.image.card).

- **status="new"**: Just pulled from capture, not yet analyzed.
- **status="analyzed"**: Description has been filled in after viewing the image.
- **status="invalid"**: The image is a mistake — accidental capture, too blurry to be useful, or otherwise not meaningful content. Set this status and leave description empty or with a brief note about why it's invalid.

When analyzing:
1. View the attached image file.
2. Write a one-sentence \`<description>\` oriented toward telling a future agent what's useful in this image.
3. If the image contains readable text, set \`has-text="true"\` and create one or more \`<text source="...">\` elements with the transcribed content in Markdown. The source attribute describes what the text is on (e.g. "whiteboard", "business card", "printed page", "screen"). Multiple \`<text>\` elements are allowed for different text sources in the same image.
4. If there's no text, set \`has-text="false"\`.
5. Rename the card via \`cb mv\` to \`photo-NNN-short-name.image.card\` where the short name helps identify the content.
6. Set status to "analyzed" (or "invalid" if it's not useful).`,
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
