/**
 * The chat wire protocol types: the content-block shape and the discriminated
 * `ChatMessage` union emitted by ChatSession to consumers and serialized to the
 * frontend over the tRPC turn stream.
 *
 * Leaf module (types only, no value imports beyond the SDK task-message types
 * TaskEvent narrows) so it can be imported anywhere without cycles.
 * `chat-session-messages.ts` re-exports these plus the adapter/helper functions.
 */

/**
 * Content block in a chat message, for the wire shape consumed by the frontend
 * over the turn stream.
 */
export interface ChatMessageContent {
  /**
   * The block kinds we construct or narrow on. Assistant content adapted from
   * the SDK is cast into this shape at the producer boundary (SDK blocks carry
   * more kinds we don't surface individually); everything we *build* here is
   * one of these.
   */
  type: "text" | "image" | "tool_use";
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
 * A message emitted by ChatSession to consumers (chat routes, activity pool),
 * and the stable wire shape serialized to the frontend over the tRPC turn
 * stream. A discriminated union keyed on `type`: each variant carries only the
 * fields its kind actually populates, so a consumer that narrows on `type` sees
 * exactly the fields that exist. The `unknown` variant is the wire-tolerance
 * sentinel — produced ONLY by the adapter boundary (see `unknownChatMessage`)
 * for an SDK message type we don't recognize, so a future SDK addition surfaces
 * as a handled, logged, counted case rather than being silently dropped.
 */
export type ChatMessage =
  | ChatMessageSystem
  | ChatMessageAssistant
  | ChatMessageUser
  | ChatMessageStreamEvent
  | ChatMessageResult
  | ChatMessageTask
  | ChatMessageUnknown;

/** `system` init message — carries the assigned session id. */
export interface ChatMessageSystem {
  type: "system";
  subtype: "init";
  session_id: string;
}

/** An assistant turn's content blocks. */
export interface ChatMessageAssistant {
  type: "assistant";
  session_id: string;
  uuid?: string;
  message: {
    role: string;
    content: ChatMessageContent[];
    stop_reason?: string | null;
  };
}

/** The user turn the assistant just consumed, echoed for the UI. */
export interface ChatMessageUser {
  type: "user";
  session_id?: string;
  message: {
    role: string;
    content: ChatMessageContent[];
  };
}

/** A raw SDK streaming event (text deltas etc.). */
export interface ChatMessageStreamEvent {
  type: "stream_event";
  session_id: string;
  uuid?: string;
  /**
   * The raw `BetaRawMessageStreamEvent` payload. Always set by the producer,
   * but typed optional: a required `unknown` field doesn't survive tRPC's
   * output-type inference (it re-emerges optional over the wire), so this keeps
   * the source type and the inferred wire type structurally identical.
   */
  event?: unknown;
  /** Link to the parent assistant turn (or null). */
  parent_tool_use_id: string | null;
}

/** Terminal turn result — timing, cost, and (on success) the final text. */
export interface ChatMessageResult {
  type: "result";
  subtype: string;
  session_id: string;
  is_error: boolean;
  total_cost_usd: number;
  duration_ms: number;
  num_turns: number;
  /** The SDK's final-turn text; present only on a `success` result. */
  result?: string;
}

/** A normalized background-task lifecycle event. */
export interface ChatMessageTask {
  type: "task";
  session_id: string;
  uuid: string;
  task: TaskEvent;
}

/**
 * Wire-tolerance sentinel for an unrecognized SDK message type. Produced only
 * by `unknownChatMessage` at the adapter boundary; `raw` holds the original SDK
 * payload for debugging. Downstream switches handle it as a real case (usually
 * a no-op) so the union stays exhaustive.
 */
export interface ChatMessageUnknown {
  type: "unknown";
  /**
   * The original SDK payload, for debugging. Always set by the producer, but
   * typed optional for the same tRPC-inference reason as `stream_event.event`:
   * a required `unknown` field re-emerges optional over the wire.
   */
  raw?: unknown;
}
