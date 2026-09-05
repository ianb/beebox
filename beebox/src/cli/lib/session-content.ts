/**
 * Session content-block transformation - turns raw message content from a
 * Claude Code JSONL entry into the structured {@link SessionContentBlock}
 * shape used by the CLI and web routes, plus the compact summaries used in
 * those blocks. Split out of `session.ts` to keep that file under the line cap.
 */

import { type KnownToolName, isKnownTool } from "../../shared/known-tools.js";
import { IMAGE_NOT_DISPLAYED } from "../../shared/chat-content-blocks.js";
import { encodeSessionMediaRef } from "../../shared/session-media.js";
import { STRIPPED_MEDIA_MARKER } from "./session-oversize.js";
import { isRecord } from "../../lib/is-record.js";

/**
 * Content block from a session log entry.
 */
export interface SessionContentBlock {
  type: "text" | "tool_use" | "tool_result" | "thinking" | "image";
  text?: string;
  toolName?: string;
  toolId?: string;
  inputSummary?: string;
  /** Raw input from the tool_use block, for richer formatting in CLI */
  input?: Record<string, unknown>;
  toolUseId?: string;
  resultSummary?: string;
  /** For image blocks: MIME type like "image/png" */
  mediaType?: string;
  /** For image blocks with base64 source: raw base64 (no data: prefix) */
  dataBase64?: string;
  /** For image blocks with URL source */
  imageUrl?: string;
  /**
   * For image blocks whose inline bytes were stripped on the way in: where to
   * fetch them from, as the `<sessionId>/<entryUuid>/<index>` path the
   * session-media route takes (`shared/session-media.ts`). The bytes are still
   * in the transcript; this is how a client asks for that one image without
   * the history read carrying any of them.
   */
  imageRef?: string;
}

/** Per-tool input summarizers, keyed on the shared tool vocabulary. */
const TOOL_INPUT_SUMMARIZERS: Partial<
  Record<KnownToolName, (input: Record<string, unknown>) => string>
> = {
  Read: (input) => String(input.file_path || ""),
  Edit: (input) => String(input.file_path || ""),
  Write: (input) => `${input.file_path} (${String(input.content || "").length} chars)`,
  Bash: (input) => String(input.description || input.command || "").substring(0, 120),
  Glob: (input) => String(input.pattern || ""),
  Grep: (input) => `${input.pattern} in ${input.path || "."}`,
  TodoWrite: () => "update todos",
  Task: (input) => String(input.description || input.prompt || "").substring(0, 120),
};

/**
 * Summarize tool input for compact display.
 */
export function summarizeToolInput(
  toolName: string,
  input: Record<string, unknown>
): string {
  if (isKnownTool(toolName)) {
    const summarize = TOOL_INPUT_SUMMARIZERS[toolName];
    if (summarize) return summarize(input);
  }
  return JSON.stringify(input).substring(0, 150);
}

/**
 * Summarize tool result content for compact display.
 */
export function summarizeToolResult(content: unknown): string {
  if (typeof content === "string") {
    return content.substring(0, 500);
  }
  if (Array.isArray(content)) {
    return content
      .map((c: unknown) =>
        typeof c === "string" ? c : isRecord(c) && typeof c["text"] === "string" ? c["text"] : ""
      )
      .join("\n")
      .substring(0, 500);
  }
  return "";
}

/**
 * Where a stripped image can be fetched from, when this scan knows: the
 * session and entry naming the line, plus the ordinal of the image within it.
 */
interface ImageBlockContext {
  mediaRef: { sessionId: string; entryUuid: string } | null;
  index: number;
}

/** Build a SessionContentBlock from a raw image block. */
function imageBlock(block: Record<string, unknown>, context: ImageBlockContext): SessionContentBlock {
  // Preserve image blocks so user-pasted images render in history.
  // PDF-reading plumbing (user-role turns containing only images) is
  // filtered at the message level by callers — turns with no text content
  // get dropped entirely, so synthetic image-only plumbing stays hidden.
  const source = isRecord(block["source"]) ? block["source"] : undefined;
  // A base64 source with no data reaches here two ways: the oversize guard stripped
  // the payload so the rest of the turn could be read (`session-oversize.ts`), or the
  // bytes never arrived in the first place. The placeholder states what is observable
  // and does not claim to know which — an earlier wording said "not retained in
  // history", which read as a false explanation when an upload had simply failed.
  //
  // It also does not say "unavailable". This is reached when replaying a stored
  // session, so the usual reader is someone looking at a conversation whose images
  // were fine when they sent them and whose work from those images is still there.
  // "Unavailable" reads as loss; "not displayed" is what actually happened.
  // Stripped by the oversize guard: the photo is still in the transcript, so
  // hand back its coordinates instead of a placeholder. The client fetches the
  // bytes only if this image is ever actually looked at, which is what keeps a
  // long scrollback from paying for photographs nobody scrolls to.
  //
  // Keyed on the marker the guard wrote, NOT on "something on this line was
  // stripped": an entry can carry a stripped photo AND a failed upload, and
  // only the first has anything to fetch.
  if (source?.["type"] === "base64" && source["data"] === STRIPPED_MEDIA_MARKER) {
    if (context.mediaRef !== null) {
      const stripped: SessionContentBlock = {
        type: "image",
        imageRef: encodeSessionMediaRef({ ...context.mediaRef, index: context.index }),
      };
      if (source["media_type"]) stripped.mediaType = String(source["media_type"]);
      return stripped;
    }
    // Stripped, but this reader has no session to address it by (a CLI
    // renderer reading a transcript it will never serve). Say the image is
    // there and not shown, which is exactly what happened.
    return { type: "text", text: IMAGE_NOT_DISPLAYED };
  }
  if (source?.["type"] === "base64" && !source["data"]) {
    // Never stripped, and empty: the bytes never arrived (a failed upload).
    // There is nothing to point at, and offering a URL would only 404.
    return { type: "text", text: IMAGE_NOT_DISPLAYED };
  }
  const imgBlock: SessionContentBlock = { type: "image" };
  if (source?.["media_type"]) imgBlock.mediaType = String(source["media_type"]);
  if (source?.["type"] === "base64" && source["data"]) {
    imgBlock.dataBase64 = String(source["data"]);
  }
  if (source?.["type"] === "url" && source["url"]) {
    imgBlock.imageUrl = String(source["url"]);
  }
  return imgBlock;
}

/** What a scan can tell {@link transformContent} about the line it came from. */
export interface TransformContentOptions {
  /**
   * The line's identity, when its image payloads were stripped on the way in.
   * Null for every ordinary line — see {@link ImageBlockContext}.
   */
  mediaRef: { sessionId: string; entryUuid: string } | null;
}

/**
 * Transform raw message content into SessionContentBlocks.
 *
 * `options` is optional because most callers (the CLI's own renderers) read a
 * transcript they will never serve over HTTP, and have no session to name.
 * Those get today's behavior exactly: a stripped image stays a placeholder.
 */
export function transformContent(
  content: unknown,
  options?: TransformContentOptions
): SessionContentBlock[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }

  if (!Array.isArray(content)) return [];

  const mediaRef = options?.mediaRef ?? null;
  // Counts image blocks only, in document order: the ordinal half of a media
  // reference. `session-media-extract.ts` enumerates the same array the same
  // way to find its way back, so the two must not drift.
  let imageIndex = 0;
  const blocks: SessionContentBlock[] = [];
  for (const block of content.filter(isRecord)) {
    if (block.type === "text") {
      blocks.push({ type: "text", text: String(block.text || "") });
      continue;
    }

    if (block.type === "tool_use") {
      const input = isRecord(block["input"]) ? block["input"] : {};
      blocks.push({
        type: "tool_use",
        toolName: String(block.name || ""),
        toolId: String(block.id || ""),
        input,
        inputSummary: summarizeToolInput(String(block.name || ""), input),
      });
      continue;
    }

    if (block.type === "tool_result") {
      blocks.push({
        type: "tool_result",
        toolUseId: String(block.tool_use_id || ""),
        resultSummary: summarizeToolResult(block.content),
      });
      continue;
    }

    if (block.type === "thinking") {
      blocks.push({ type: "thinking", text: String(block.thinking || "") });
      continue;
    }
    if (block.type === "redacted_thinking") {
      blocks.push({ type: "thinking", text: "[redacted]" });
      continue;
    }

    if (block.type === "image") {
      blocks.push(imageBlock(block, { mediaRef, index: imageIndex }));
      imageIndex += 1;
      continue;
    }

    // Unknown block types: fall through with a placeholder so we don't
    // silently swallow something new. This is visible in the UI, which is
    // the point — we want to notice new block types.
    blocks.push({ type: "text", text: `[${String(block.type)}]` });
  }
  return blocks;
}
