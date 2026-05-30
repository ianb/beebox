/**
 * Wire types and pure message-shaping helpers for ChatSession.
 *
 * These are the stable SSE wire shapes plus the leaf functions that adapt
 * SDK messages, build content blocks from user input, and compute history
 * tail sizes. They hold no reference to the ChatSession class, so they live
 * here as a self-contained module; `chat-session.ts` re-exports the public
 * pieces (`ChatMessageContent`, `ChatMessage`, `ChatImage`, `ChatSendInput`,
 * `buildContentBlocks`) so existing importers are unaffected.
 */

import {
  tailForMinUserMessages,
  type SessionEntry,
} from "../cli/lib/session.js";
import type { ChatContentBlock } from "../services/claude-chat.js";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

/**
 * Content block in a chat message, for the wire shape consumed by the
 * frontend over SSE.
 */
export interface ChatMessageContent {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  /** For image blocks */
  source?: {
    type: "base64" | "url";
    media_type?: string;
    data?: string;
    url?: string;
  };
}

/**
 * A message emitted by ChatSession to consumers (chat routes, activity
 * pool). Stable wire shape for the frontend.
 */
export interface ChatMessage {
  type:
    | "system"
    | "assistant"
    | "user"
    | "stream_event"
    | "result"
    | "rate_limit_event";
  subtype?: string;
  session_id?: string;
  uuid?: string;
  message?: {
    role: string;
    content: ChatMessageContent[];
    stop_reason?: string | null;
  };
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  /** For `stream_event` messages — the raw `BetaRawMessageStreamEvent` payload. */
  event?: unknown;
  /** For `stream_event` — link to the parent assistant turn (or null). */
  parent_tool_use_id?: string | null;
}

/**
 * An image attachment pasted/uploaded by the user, addressable by numeric id
 * via `[imageN]` tokens in the message text.
 */
export interface ChatImage {
  id: number;
  mimeType: string;
  /** Raw base64 data (no data: URL prefix) */
  dataBase64: string;
}

export interface ChatSendInput {
  text: string;
  images?: ChatImage[];
}

/**
 * Compute the tail size honoring both an explicit tail and a minimum number
 * of real user messages to include. Returns null to mean "no trimming".
 */
export function effectiveTailSize(
  entries: SessionEntry[],
  params?: { tail?: number; minRealUserMessages?: number },
): number | null {
  const tail = params ? params.tail : undefined;
  const minUsers = params ? params.minRealUserMessages : undefined;
  const userTail = minUsers && minUsers > 0
    ? tailForMinUserMessages(entries, minUsers)
    : 0;
  if (tail !== undefined && tail > 0) {
    return Math.max(tail, userTail);
  }
  if (userTail > 0) return userTail;
  return null;
}

/**
 * Map an SDKMessage to a ChatMessage (the stable wire shape).
 * Returns null for SDK message types we don't surface (partials, hooks,
 * status, etc.) — those stay internal to the SDK pipeline.
 */
export function adaptSdkMessage(msg: SDKMessage): ChatMessage | null {
  switch (msg.type) {
    case "system": {
      // We only forward the init system message, the only one with session_id.
      if (msg.subtype !== "init") return null;
      return {
        type: "system",
        subtype: "init",
        session_id: msg.session_id,
      };
    }
    case "assistant": {
      const result: ChatMessage = {
        type: "assistant",
        session_id: msg.session_id,
        message: {
          role: msg.message.role,
          content: msg.message.content as ChatMessageContent[],
          ...(msg.message.stop_reason !== null && msg.message.stop_reason !== undefined
            ? { stop_reason: msg.message.stop_reason }
            : {}),
        },
      };
      if (msg.uuid) result.uuid = msg.uuid;
      return result;
    }
    case "user": {
      // SDK's SDKUserMessage carries content the assistant turn just consumed
      // (i.e., the user message we pushed in). Forward so the UI can echo it.
      const content = (msg.message as { content?: ChatMessageContent[] }).content;
      const out: ChatMessage = {
        type: "user",
        message: {
          role: "user",
          content: Array.isArray(content) ? content : [],
        },
      };
      if (msg.session_id !== undefined) out.session_id = msg.session_id;
      return out;
    }
    case "stream_event": {
      const out: ChatMessage = {
        type: "stream_event",
        session_id: msg.session_id,
        event: msg.event,
        parent_tool_use_id: msg.parent_tool_use_id,
      };
      if (msg.uuid) out.uuid = msg.uuid;
      return out;
    }
    case "result": {
      const r: ChatMessage = {
        type: "result",
        subtype: msg.subtype,
        session_id: msg.session_id,
        is_error: msg.is_error,
        duration_ms: msg.duration_ms,
        num_turns: msg.num_turns,
        total_cost_usd: msg.total_cost_usd,
      };
      if (msg.subtype === "success") r.result = msg.result;
      return r;
    }
    default:
      return null;
  }
}

/**
 * Push the SDK image block for an attachment onto the output array.
 */
function pushImageBlock(blocks: ChatMessageContent[], img: ChatImage): void {
  blocks.push({
    type: "image",
    source: {
      type: "base64",
      media_type: img.mimeType,
      data: img.dataBase64,
    },
  } as ChatMessageContent);
}

/**
 * Build the content array for a single compose (text + image attachments).
 *
 * `[imageN]` tokens in the text are replaced with the corresponding image
 * block. Attachments whose token is absent from the text are appended at
 * the end. Unknown tokens (id not in attachments) are left as literal text.
 */
export function buildContentBlocks(
  input: ChatSendInput
): ChatMessageContent[] {
  const { text, images } = input;
  const attached = images ?? [];
  if (attached.length === 0) {
    return [{ type: "text", text }];
  }

  const byId = new Map<number, ChatImage>();
  for (const img of attached) byId.set(img.id, img);
  const used = new Set<number>();

  const blocks: ChatMessageContent[] = [];
  const tokenRe = /\[image(\d+)]/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(text)) !== null) {
    const idStr = match[1];
    if (!idStr) continue;
    const id = parseInt(idStr, 10);
    const img = byId.get(id);
    if (!img) continue; // leave orphan token as literal text in the next chunk
    if (match.index > cursor) {
      blocks.push({ type: "text", text: text.slice(cursor, match.index) });
    }
    pushImageBlock(blocks, img);
    used.add(id);
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    blocks.push({ type: "text", text: text.slice(cursor) });
  }

  // Append any unreferenced images at the end
  for (const img of attached) {
    if (used.has(img.id)) continue;
    pushImageBlock(blocks, img);
  }

  // If only images were appended (no text at all), still include an empty
  // text marker so downstream filters can tell this was a user turn (not
  // PDF-plumbing). Shouldn't happen in practice since messages are wrapped
  // in <typed>/<speech> tags by the caller, but defensive.
  if (blocks.every((b) => b.type !== "text")) {
    blocks.unshift({ type: "text", text: "" });
  }

  return blocks;
}

/**
 * Concatenate the text blocks of an assistant message onto an accumulator.
 * Used to build the full turn text for schedule / `<chat-app>` delta parsing.
 */
export function accumulateAssistantText(prior: string, msg: ChatMessage): string {
  if (msg.type !== "assistant" || !msg.message) return prior;
  let acc = prior;
  for (const block of msg.message.content) {
    if (block.type === "text" && block.text) {
      acc += block.text;
    }
  }
  return acc;
}

/**
 * Warn loudly when a turn ends with `is_error=true`: such a turn can leave a
 * "ghost" row in chat-session-history (the id was assigned, but the SDK wrote
 * no JSONL), and future landmark "Chat" clicks would re-hit the same resume
 * failure. The log line makes that recoverable from logs.
 */
export function warnGhostEntry(
  { sessionId, msg }: { sessionId: string | null; msg: ChatMessage },
): void {
  const sid = sessionId === null ? "<unassigned>" : sessionId;
  const subtype = msg.subtype === undefined ? "unknown" : msg.subtype;
  const turns = msg.num_turns === undefined ? "?" : String(msg.num_turns);
  const dur = msg.duration_ms === undefined ? "?" : String(msg.duration_ms);
  console.warn(
    `[chat-session] Turn ended with is_error=true; session ${sid} may now be a ghost entry in chat-session-history. subtype=${subtype} num_turns=${turns} duration_ms=${dur}`,
  );
}

/**
 * Convert a ChatMessageContent array into the SDK's ChatContentBlock array.
 * The shapes are compatible — we just narrow the type so downstream type
 * checks pass.
 */
export function toBackendContent(blocks: ChatMessageContent[]): ChatContentBlock[] {
  const out: ChatContentBlock[] = [];
  for (const b of blocks) {
    if (b.type === "text") {
      out.push({ type: "text", text: b.text ?? "" });
    } else if (b.type === "image" && b.source) {
      out.push({ type: "image", source: b.source });
    }
  }
  return out;
}
