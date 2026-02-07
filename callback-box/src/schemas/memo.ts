/**
 * Memo card schema - simple test input type.
 *
 * Memos are generic text content that can be used for testing
 * and for any input that doesn't fit a more specific type.
 * Voice memos have audio attachments and get transcribed.
 */

import { element } from "cardworks";
import { z } from "zod";

/**
 * Valid memo statuses.
 */
export const MemoStatus = z.enum(["new", "processing", "processed"]);
export type MemoStatus = z.infer<typeof MemoStatus>;

/**
 * Child element for created timestamp.
 */
export const MemoCreated = element("created", {
  text: z.string().datetime({ offset: true }),
});

/**
 * Child element for memo content.
 * Text is optional for voice memos which may have empty content initially.
 */
export const MemoContent = element("content", {
  text: z.string().optional(),
});

/**
 * Child element for optional source information.
 */
export const MemoSource = element("source", {
  text: z.string(),
});

/**
 * Child element for transcription (added by pre-action).
 */
export const MemoTranscription = element("transcription", {
  attrs: {
    language: z.string().optional(),
    "transcribed-at": z.string().datetime({ offset: true }).optional(),
  },
  text: z.string(),
});

/**
 * Child element for transcription error (added by pre-action).
 */
export const MemoTranscriptionError = element("transcription-error", {
  attrs: {
    permanent: z.enum(["true", "false"]),
    code: z.string().optional(),
    "attempted-at": z.string().datetime({ offset: true }).optional(),
  },
  text: z.string(),
});

/**
 * Memo card schema.
 *
 * Text memo example:
 * ```xml
 * <memo status="new">
 *   <created>2024-01-15T10:00:00Z</created>
 *   <content>Test content here</content>
 *   <source>text</source>
 * </memo>
 * ```
 *
 * Voice memo example (after transcription):
 * ```xml
 * <memo status="new">
 *   <created>2024-01-15T10:00:00Z</created>
 *   <content></content>
 *   <source>voice</source>
 *   <transcription language="en" transcribed-at="2024-01-15T10:01:00Z">
 *     The transcribed text goes here.
 *   </transcription>
 * </memo>
 * ```
 */
export const MemoSchema = element("memo", {
  attrs: {
    status: MemoStatus.default("new"),
  },
  // Use loose array validation to allow transcription elements
  children: z.array(
    z.union([
      MemoCreated,
      MemoContent,
      MemoSource,
      MemoTranscription,
      MemoTranscriptionError,
    ])
  ),
  instructions: `# Handling Memos

Voice memos require transcription before they can be processed. Check for a <transcription> child element — if absent and <source> is "voice", the memo isn't ready yet. Skip it and move on.

If a <transcription-error permanent="true"> exists, the audio cannot be transcribed. Don't retry — treat the memo as unprocessable and skip it.

The <content> element may be empty for voice memos. That's expected — the transcription IS the content for voice memos.

Status transitions: new → processing → processed. Set status to "processing" before you start working on it, "processed" when done.`,
});

export type Memo = z.infer<typeof MemoSchema>;

/**
 * Template for creating a new text memo card.
 */
export function createMemoTemplate(content: string, source?: string): string {
  const now = new Date().toISOString();
  const sourceElement = source ? `\n  <source>${escapeXml(source)}</source>` : "";

  return `<memo status="new">
  <created>${now}</created>
  <content>${escapeXml(content)}</content>${sourceElement}
</memo>
`;
}

/**
 * Template for creating a voice memo card (audio will be attached separately).
 */
export function createVoiceMemoTemplate(): string {
  const now = new Date().toISOString();

  return `<memo status="new">
  <created>${now}</created>
  <content></content>
  <source>voice</source>
</memo>
`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
