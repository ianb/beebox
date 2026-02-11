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
  text: z.string().optional(),
});

/**
 * Image card schema.
 *
 * Example:
 * ```xml
 * <image status="new">
 *   <filename name="photo-001.jpg" captured="2024-01-15T10:00:00Z" source="camera-environment" />
 *   <description></description>
 *   <text></text>
 * </image>
 * ```
 */
export const ImageSchema = element("image", {
  attrs: {
    status: ImageStatus.default("new"),
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
2. Write a description of what's in the image.
3. If the image contains readable text, extract it into the <text> element (OCR).
4. Set status to "analyzed" (or "invalid" if it's not useful).`,
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
