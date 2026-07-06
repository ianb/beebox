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
import type { ActivityKind, CardStateDetails } from "./chat-card-activity.js";
import type {
  SDKMessage,
  SDKTaskNotificationMessage,
  SDKTaskProgressMessage,
  SDKTaskStartedMessage,
  SDKTaskUpdatedMessage,
} from "@anthropic-ai/claude-agent-sdk";

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
 * A background-task lifecycle event, normalized across the SDK's four
 * `task_*` system messages (`task_started`, `task_progress`, `task_updated`,
 * `task_notification`). The SDK reports a richer lifecycle than the settled
 * `<task-notification>` transcript marker alone; this carries the in-flight
 * states so the UI can show a task starting and progressing, not just its
 * terminal result.
 */
export interface TaskEvent {
  /** Lifecycle phase this event represents. */
  phase: "started" | "progress" | "updated" | "settled";
  taskId: string;
  /** Tool_use block that launched the task, when known. */
  toolUseId?: string;
  /** Human-readable label for the task (started/progress/updated). */
  description?: string;
  /** Short progress or settle summary. */
  summary?: string;
  /**
   * Lifecycle status. Terminal values are `completed | failed | stopped |
   * killed`; in-flight values are `pending | running`. Absent on bare
   * progress ticks.
   */
  status?: "pending" | "running" | "completed" | "failed" | "stopped" | "killed";
  /** Captured output file path, for settled tasks. */
  outputFile?: string;
  /** Elapsed wall time in ms (from the SDK `usage.duration_ms`). */
  elapsedMs?: number;
  /** Most recent tool the task ran (progress ticks only). */
  lastToolName?: string;
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
    | "task"
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
  /** For `task` messages — the normalized background-task lifecycle event. */
  task?: TaskEvent;
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
  /**
   * Where the user is sending from (e.g. "web-desktop", "web-mobile"),
   * classified per request by the route layer. Surfaces to the agent as
   * the snapshot's `channel` attribute so it can shape output for the
   * device. Omitted when the transport doesn't know.
   */
  channel?: string;
  /**
   * Box-relative path of the card open in the chat's companion pane when
   * this message was sent. Surfaces to the agent as the read-only
   * `open-card` snapshot attribute. Omitted when no card is open.
   */
  openCard?: string;
  /**
   * What the user did to the companion-pane card since the agent's last
   * reply (see `ActivityKind`). Unioned across queued sends and surfaced as
   * the read-only `card-activity` snapshot attribute. Omitted when empty.
   */
  cardActivity?: ActivityKind[];
  /**
   * Per-kind free-text detail for the companion-pane activity (e.g. the
   * embedding query typed, the path modified). Latest-wins per kind across
   * queued sends; surfaced as the text of the read-only `<card-activity>`
   * snapshot child elements.
   */
  cardState?: CardStateDetails;
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
 * Normalize one of the SDK's four `task_*` system messages into a `task`
 * ChatMessage. Returns null for ambient/housekeeping tasks (`skip_transcript`)
 * so they don't clutter the inline transcript — progress/updated ticks for
 * such tasks are dropped downstream because no `started` ever registered them.
 */
function adaptTaskMessage(
  msg:
    | SDKTaskStartedMessage
    | SDKTaskProgressMessage
    | SDKTaskUpdatedMessage
    | SDKTaskNotificationMessage,
): ChatMessage | null {
  const base = { type: "task" as const, session_id: msg.session_id, uuid: msg.uuid };
  switch (msg.subtype) {
    case "task_started": {
      if (msg.skip_transcript === true) return null;
      const task: TaskEvent = { phase: "started", taskId: msg.task_id, status: "running" };
      if (msg.tool_use_id !== undefined) task.toolUseId = msg.tool_use_id;
      if (msg.description) task.description = msg.description;
      return { ...base, task };
    }
    case "task_progress": {
      const task: TaskEvent = { phase: "progress", taskId: msg.task_id, status: "running" };
      if (msg.tool_use_id !== undefined) task.toolUseId = msg.tool_use_id;
      if (msg.description) task.description = msg.description;
      if (msg.summary) task.summary = msg.summary;
      if (msg.last_tool_name) task.lastToolName = msg.last_tool_name;
      task.elapsedMs = msg.usage.duration_ms;
      return { ...base, task };
    }
    case "task_updated": {
      const task: TaskEvent = { phase: "updated", taskId: msg.task_id };
      if (msg.patch.status !== undefined) task.status = msg.patch.status;
      if (msg.patch.description !== undefined) task.description = msg.patch.description;
      return { ...base, task };
    }
    case "task_notification": {
      if (msg.skip_transcript === true) return null;
      const task: TaskEvent = { phase: "settled", taskId: msg.task_id, status: msg.status };
      if (msg.tool_use_id !== undefined) task.toolUseId = msg.tool_use_id;
      if (msg.summary) task.summary = msg.summary;
      if (msg.output_file) task.outputFile = msg.output_file;
      if (msg.usage) task.elapsedMs = msg.usage.duration_ms;
      return { ...base, task };
    }
    default:
      return null;
  }
}

/**
 * Map an SDKMessage to a ChatMessage (the stable wire shape).
 * Returns null for SDK message types we don't surface (partials, hooks,
 * status, etc.) — those stay internal to the SDK pipeline.
 */
export function adaptSdkMessage(msg: SDKMessage): ChatMessage | null {
  switch (msg.type) {
    case "system": {
      if (msg.subtype === "init") {
        return {
          type: "system",
          subtype: "init",
          session_id: msg.session_id,
        };
      }
      // Background-task lifecycle events are `type:"system"` with their own
      // subtypes — forward them as normalized `task` messages so the UI can
      // surface a task starting and progressing, not just its settled marker.
      if (
        msg.subtype === "task_started" ||
        msg.subtype === "task_progress" ||
        msg.subtype === "task_updated" ||
        msg.subtype === "task_notification"
      ) {
        return adaptTaskMessage(msg);
      }
      return null;
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
    case "tool_progress":
    case "auth_status":
    case "tool_use_summary":
    case "rate_limit_event":
    case "prompt_suggestion":
      // SDK-internal partials/status events; not surfaced as ChatMessages.
      return null;
    default:
      // Exhaustive over the SDK's known message types (a new known type is a
      // compile error above); this default only catches a future SDK version's
      // unknown type at runtime, kept graceful rather than crashing the stream.
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
 * Warn loudly when a turn ends with `is_error=true`. Causes vary —
 * unavailable model (fails in ~500ms, subtype=success), an unresumable
 * session id (would-be ghost row in chat-session-history), or a server
 * error — so log the SDK's own result text and the timing rather than
 * asserting one cause. Makes the failure recoverable from logs.
 */
export function warnErroredTurn(
  { sessionId, msg }: { sessionId: string | null; msg: ChatMessage },
): void {
  const sid = sessionId === null ? "<unassigned>" : sessionId;
  const subtype = msg.subtype === undefined ? "unknown" : msg.subtype;
  const turns = msg.num_turns === undefined ? "?" : String(msg.num_turns);
  const dur = msg.duration_ms === undefined ? "?" : String(msg.duration_ms);
  const detail = typeof msg.result === "string" && msg.result.trim()
    ? ` result=${JSON.stringify(msg.result.trim().slice(0, 300))}`
    : "";
  console.warn(
    `[chat-session] Turn ended with is_error=true (session ${sid}). Likely an unavailable model, an unresumable session, or a server error. subtype=${subtype} num_turns=${turns} duration_ms=${dur}${detail}`,
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
