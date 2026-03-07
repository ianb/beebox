/**
 * Memo card schema - simple test input type.
 *
 * Memos are generic text content that can be used for testing
 * and for any input that doesn't fit a more specific type.
 * Voice memos have audio attachments and get transcribed.
 */

import { element, escapeText, escapeAttr } from "cardworks";
import { z } from "zod";

/**
 * Valid memo statuses.
 */
export const MemoStatus = z.enum(["new", "processing", "processed"]);
export type MemoStatusType = typeof MemoStatus._type;

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
 * Child element for context (URL, page title, selected text from browser).
 */
export const MemoContext = element("context", {
  attrs: {
    url: z.string().url().optional(),
    title: z.string().optional(),
  },
  text: z.string().optional(),
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
 * <created>2024-01-15T10:00:00Z</created>
 * <content>Test content here</content>
 * <source>text</source>
 * </memo>
 * ```
 *
 * Voice memo example (after transcription):
 * ```xml
 * <memo status="new">
 * <created>2024-01-15T10:00:00Z</created>
 * <content></content>
 * <source>voice</source>
 * <transcription language="en" transcribed-at="2024-01-15T10:01:00Z">
 * The transcribed text goes here.
 * </transcription>
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
      MemoContext,
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
  const sourceElement = source ? `\n<source>${escapeText(source)}</source>` : "";

  return `<memo status="new">
<created>${now}</created>
<content>${escapeText(content)}</content>${sourceElement}
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

/**
 * Template for creating a memo card from the browser extension (legacy dropbox name).
 */
export function createDropboxMemoTemplate(options: {
  content: string;
  timestamp?: string | undefined;
  context?: { url?: string | undefined; title?: string | undefined; selectedText?: string | undefined } | undefined;
}): string {
  const created = options.timestamp || new Date().toISOString();
  let contextElement = "";
  if (options.context) {
    const attrs: string[] = [];
    if (options.context.url) attrs.push(` url="${escapeAttr(options.context.url)}"`);
    if (options.context.title) attrs.push(` title="${escapeAttr(options.context.title)}"`);
    const text = options.context.selectedText ? escapeText(options.context.selectedText) : "";
    contextElement = `\n<context${attrs.join("")}>${text}</context>`;
  }

  return `<memo status="new">
<created>${created}</created>
<content>${escapeText(options.content)}</content>
<source>dropbox</source>${contextElement}
</memo>
`;
}
