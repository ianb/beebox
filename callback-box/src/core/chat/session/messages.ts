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
} from "../../../cli/lib/session.js";
import { assertNever } from "../../../lib/invariant.js";
import { buildChatContentBlocks } from "../../../shared/chat-content-blocks.js";
import type { ChatContentBlock } from "../../../services/claude-chat.js";
import type { ActivityKind, CardStateDetails } from "../card-activity.js";
import type {
  SDKMessage,
  SDKTaskNotificationMessage,
  SDKTaskProgressMessage,
  SDKTaskStartedMessage,
  SDKTaskUpdatedMessage,
} from "@anthropic-ai/claude-agent-sdk";

import type {
  ChatMessage,
  ChatMessageAssistant,
  ChatMessageResult,
  ChatMessageStreamEvent,
  ChatMessageUnknown,
  ChatMessageUser,
  ChatMessageContent,
  TaskEvent,
} from "../message-types.js";

// The wire types live in a leaf module; re-export so existing importers of this
// file (and, transitively, chat-session.ts) are unaffected.
export type {
  ChatMessage,
  ChatMessageContent,
  ChatMessageSystem,
  ChatMessageAssistant,
  ChatMessageUser,
  ChatMessageStreamEvent,
  ChatMessageResult,
  ChatMessageTask,
  ChatMessageUnknown,
  TaskEvent,
} from "../message-types.js";

/** Count of unknown SDK messages surfaced as sentinels this process. */
let unknownMessageCount = 0;

/**
 * Produce the wire-tolerance sentinel for an SDK message whose `type` we don't
 * recognize. Logs and counts every occurrence — a parser/SDK-version drift can
 * degrade the stream but can never do so silently.
 */
export function unknownChatMessage(msg: SDKMessage): ChatMessageUnknown {
  unknownMessageCount++;
  console.warn(
    `[chat-session] Unrecognized SDK message type "${msg.type}" surfaced as an \`unknown\` sentinel (count=${unknownMessageCount}) — update adaptSdkMessage if this type should be handled.`,
  );
  return { type: "unknown", raw: msg };
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
      // Exhaustive over the four task subtypes — a new one is a compile error.
      return assertNever(msg);
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
      const result: ChatMessageAssistant = {
        type: "assistant",
        session_id: msg.session_id,
        message: {
          role: msg.message.role,
          content: msg.message.content as ChatMessageContent[],
          ...(msg.message.stop_reason !== null
            ? { stop_reason: msg.message.stop_reason }
            : {}),
        },
      };
      result.uuid = msg.uuid;
      return result;
    }
    case "user": {
      // SDK's SDKUserMessage carries content the assistant turn just consumed
      // (i.e., the user message we pushed in). Forward so the UI can echo it.
      const content = (msg.message as { content?: ChatMessageContent[] }).content;
      const out: ChatMessageUser = {
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
      const out: ChatMessageStreamEvent = {
        type: "stream_event",
        session_id: msg.session_id,
        event: msg.event,
        parent_tool_use_id: msg.parent_tool_use_id,
      };
      out.uuid = msg.uuid;
      return out;
    }
    case "result": {
      const r: ChatMessageResult = {
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
      // SDK-internal partials/status events; deliberately not surfaced (distinct
      // from the `unknown` sentinel below, which catches types we don't know).
      return null;
    case "conversation_reset":
      // New in SDK 0.3.x: signals /clear, plan-mode exit, and fresh-session
      // flows, and asks the surface to mount a fresh transcript under
      // new_conversation_id. Not yet wired up on our side (chat sessions
      // don't currently re-key on this) — dropped rather than surfaced as
      // `unknown` since it IS a recognized type, just not one we act on yet.
      // See issues/features/2026-07-11-adapt-conversation-reset-sdk-message.md.
      return null;
    default:
      // A future SDK version's unrecognized type: surface it as the logged,
      // counted wire-tolerance sentinel rather than dropping it silently.
      return unknownChatMessage(msg);
  }
}

/**
 * Build the content array for a single compose (text + image attachments).
 *
 * `[imageN]` tokens in the text are replaced with the corresponding image
 * block. Attachments whose token is absent from the text are appended at
 * the end. Unknown tokens (id not in attachments) are left as literal text.
 *
 * Delegates the token-parsing algorithm to the shared
 * `buildChatContentBlocks` (src/shared/chat-content-blocks.ts) so the
 * frontend's optimistic-bubble builder can't drift from this one — it
 * supplies the SDK-shaped image block and asks for the trailing-text-block
 * guarantee this stored session log relies on (see that option's doc
 * comment for why the frontend passes `false` instead).
 */
export function buildContentBlocks(
  input: ChatSendInput
): ChatMessageContent[] {
  const { text, images } = input;
  return buildChatContentBlocks<ChatMessageContent>({
    text,
    images: images ?? [],
    makeTextBlock: (blockText): ChatMessageContent => ({ type: "text", text: blockText }),
    makeImageBlock: (img): ChatMessageContent => ({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mimeType,
        data: img.dataBase64,
      },
    }),
    ensureTrailingTextBlock: true,
  });
}

/**
 * Concatenate the text blocks of an assistant message onto an accumulator.
 * Used to build the full turn text for schedule / `<chat-app>` delta parsing.
 */
export function accumulateAssistantText(prior: string, msg: ChatMessage): string {
  if (msg.type !== "assistant") return prior;
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
  { sessionId, msg }: { sessionId: string | null; msg: ChatMessageResult },
): void {
  const sid = sessionId === null ? "<unassigned>" : sessionId;
  const subtype = msg.subtype;
  const turns = String(msg.num_turns);
  const dur = String(msg.duration_ms);
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
