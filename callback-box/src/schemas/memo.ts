/**
 * Memo card schema — text or voice notes.
 *
 * Memos are generic content that can carry any input not fitting a more
 * specific type. Voice memos have an audio attachment and a
 * transcription that ends up in the markdown body.
 */

import { body, cardSchema, type CardSchema } from "cardworks";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { type FileLoader, titleFromFilename, truncateTitle } from "../core/file-summary.js";

export const MemoStatus = z.enum(["new", "processing", "processed"]);
export type MemoStatusType = z.infer<typeof MemoStatus>;

const ContextEntry = z.object({
  url: z.string().url().optional(),
  title: z.string().optional(),
  text: z.string().optional(),
});

const TranscriptionEntry = z.object({
  language: z.string().optional(),
  "transcribed-at": z.string().datetime({ offset: true }).optional(),
  text: z.string(),
});

const TranscriptionError = z.object({
  permanent: z.boolean(),
  code: z.string().optional(),
  "attempted-at": z.string().datetime({ offset: true }).optional(),
  message: z.string(),
});

export const MemoSchema: CardSchema = cardSchema("memo", {
  fields: {
    status: MemoStatus.default("new"),
    created: z.string().datetime({ offset: true }),
    source: z.string().optional(),
    context: ContextEntry.optional(),
    transcription: TranscriptionEntry.optional(),
    "transcription-error": TranscriptionError.optional(),
    body: body(z.string()),
  },
  instructions: `# Memo Cards

A memo is a text or voice note. The card's markdown body is the
content of the note (the text the user wrote, or the transcribed
audio).

Frontmatter:
- \`source:\` — origin of the memo: \`text\`, \`voice\`, \`email\`,
  \`dropbox\`, \`telegram\`, etc.
- \`context:\` — optional \`{url?, title?, text?}\` for memos that
  originate from a browser selection or a referenced page.
- \`transcription:\` — for voice memos: \`{text, language?, transcribed-at?}\`
  set by the transcribe pre-action. The transcribed text also lands
  in the body when the agent processes the memo.
- \`transcription-error:\` — set if transcription failed; \`permanent: true\`
  means don't retry.

If \`source: voice\` with no \`transcription:\` and no
\`transcription-error:\`, the memo hasn't been transcribed yet —
don't treat the empty body as empty content.

Status: \`new\` → \`processing\` → \`processed\`.`,
});

export interface MemoFields {
  type: "memo";
  status: MemoStatusType;
  created: string;
  source?: string;
  context?: { url?: string; title?: string; text?: string };
  transcription?: { text: string; language?: string; "transcribed-at"?: string };
  "transcription-error"?: {
    permanent: boolean;
    code?: string;
    "attempted-at"?: string;
    message: string;
  };
  body: string;
}

export interface MemoAttrs {
  status: MemoStatusType;
}

/**
 * Memo loader — title comes from the body (text content of the memo)
 * or the transcription, falling back to the filename.
 */
export const memoLoader: FileLoader<MemoAttrs> = (raw) => {
  const fallback = titleFromFilename(raw.path);
  const fields = (raw as { fields?: Partial<MemoFields> }).fields;
  if (fields === undefined) {
    return { path: raw.path, tagName: "memo", title: fallback, attrs: { status: "new" } };
  }
  let title = "";
  if (typeof fields.body === "string" && fields.body.trim() !== "") {
    title = fields.body.trim();
  } else if (fields.transcription?.text !== undefined && fields.transcription.text.trim() !== "") {
    title = fields.transcription.text.trim();
  }
  if (title === "") title = fallback;
  title = truncateTitle(title, 80);
  return {
    path: raw.path,
    tagName: "memo",
    title,
    attrs: { status: fields.status ?? "new" },
  };
};

function buildMemoCard(input: {
  content: string;
  source?: string;
  context?: { url?: string; title?: string; text?: string };
  created?: string;
}): string {
  const fields: Record<string, unknown> = {
    status: "new",
    created: input.created ?? new Date().toISOString(),
  };
  if (input.source !== undefined && input.source !== "") {
    fields["source"] = input.source;
  }
  if (input.context !== undefined) {
    const ctx: Record<string, unknown> = {};
    if (input.context.url !== undefined) ctx["url"] = input.context.url;
    if (input.context.title !== undefined) ctx["title"] = input.context.title;
    if (input.context.text !== undefined) ctx["text"] = input.context.text;
    if (Object.keys(ctx).length > 0) fields["context"] = ctx;
  }
  const yamlText = stringifyYaml(fields);
  const bodyTail = input.content === ""
    ? ""
    : `${input.content}${input.content.endsWith("\n") ? "" : "\n"}`;
  return `---\n${yamlText}---\n${bodyTail}`;
}

export function createMemoTemplate(content: string, source?: string): string {
  return buildMemoCard({
    content,
    ...(source !== undefined && { source }),
  });
}

export function createVoiceMemoTemplate(): string {
  return buildMemoCard({ content: "", source: "voice" });
}

export function createDropboxMemoTemplate(options: {
  content: string;
  timestamp?: string | undefined;
  context?: { url?: string | undefined; title?: string | undefined; selectedText?: string | undefined } | undefined;
}): string {
  const context = options.context === undefined
    ? undefined
    : {
        ...(options.context.url !== undefined && { url: options.context.url }),
        ...(options.context.title !== undefined && { title: options.context.title }),
        ...(options.context.selectedText !== undefined && { text: options.context.selectedText }),
      };
  return buildMemoCard({
    content: options.content,
    source: "dropbox",
    ...(context !== undefined && { context }),
    ...(options.timestamp !== undefined && { created: options.timestamp }),
  });
}
