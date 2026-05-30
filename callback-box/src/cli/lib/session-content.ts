/**
 * Session content-block transformation - turns raw message content from a
 * Claude Code JSONL entry into the structured {@link SessionContentBlock}
 * shape used by the CLI and web routes, plus the compact summaries used in
 * those blocks. Split out of `session.ts` to keep that file under the line cap.
 */

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
}

/**
 * Summarize tool input for compact display.
 */
export function summarizeToolInput(
  toolName: string,
  input: Record<string, unknown>
): string {
  if (!input) return "";

  switch (toolName) {
    case "Read":
      return String(input.file_path || "");
    case "Edit":
      return String(input.file_path || "");
    case "Write":
      return `${input.file_path} (${String(input.content || "").length} chars)`;
    case "Bash":
      return String(input.description || input.command || "").substring(0, 120);
    case "Glob":
      return String(input.pattern || "");
    case "Grep":
      return `${input.pattern} in ${input.path || "."}`;
    case "TodoWrite":
      return "update todos";
    case "Task":
      return String(input.description || input.prompt || "").substring(0, 120);
    default:
      return JSON.stringify(input).substring(0, 150);
  }
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
        typeof c === "string" ? c : (c as { text?: string })?.text || ""
      )
      .join("\n")
      .substring(0, 500);
  }
  return "";
}

/** Build a SessionContentBlock from a raw image block, or null if not an image. */
function imageBlock(block: Record<string, unknown>): SessionContentBlock {
  // Preserve image blocks so user-pasted images render in history.
  // PDF-reading plumbing (user-role turns containing only images) is
  // filtered at the message level by callers — turns with no text content
  // get dropped entirely, so synthetic image-only plumbing stays hidden.
  const source = block.source as
    | { type?: string; media_type?: string; data?: string; url?: string }
    | undefined;
  const imgBlock: SessionContentBlock = { type: "image" };
  if (source?.media_type) imgBlock.mediaType = String(source.media_type);
  if (source?.type === "base64" && source.data) {
    imgBlock.dataBase64 = String(source.data);
  }
  if (source?.type === "url" && source.url) {
    imgBlock.imageUrl = String(source.url);
  }
  return imgBlock;
}

/**
 * Transform raw message content into SessionContentBlocks.
 */
export function transformContent(content: unknown): SessionContentBlock[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }

  if (!Array.isArray(content)) return [];

  const blocks: SessionContentBlock[] = [];
  for (const block of content as Array<Record<string, unknown>>) {
    if (block.type === "text") {
      blocks.push({ type: "text", text: String(block.text || "") });
      continue;
    }

    if (block.type === "tool_use") {
      const input = (block.input || {}) as Record<string, unknown>;
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
      blocks.push(imageBlock(block));
      continue;
    }

    // Unknown block types: fall through with a placeholder so we don't
    // silently swallow something new. This is visible in the UI, which is
    // the point — we want to notice new block types.
    blocks.push({ type: "text", text: `[${String(block.type)}]` });
  }
  return blocks;
}
