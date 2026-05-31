/**
 * Shared types, constants, and logging for the chat machine and its actors.
 * Kept in a leaf module so `chatMachine.ts` and `chat-actors.ts` can both
 * depend on it without forming a value import cycle.
 */

import type {
  SessionEntry,
  SessionContentBlock,
  ChatImageAttachment,
} from "../api";

// -- Events --

export type ChatEvent =
  | { type: "SEND"; message: string; messageId: string; images?: ChatImageAttachment[] }
  | { type: "INTERRUPT" }
  | { type: "DISMISS_ERROR" }
  | { type: "STREAM_TEXT"; text: string }
  | { type: "STREAM_TOOL"; tool: SessionContentBlock }
  | { type: "STREAM_BUSY" }
  | { type: "STREAM_QUEUED" }
  | { type: "STREAM_ERROR"; error: string }
  | { type: "STREAM_RESULT" }
  | { type: "STREAM_FAILED"; error: string }
  | { type: "REFRESH" }
  | { type: "SET_MESSAGES"; messages: SessionEntry[]; sessionId: string | null }
  | { type: "OTHER_USER_MESSAGE"; message: string; userName: string; timestamp: string }
  | { type: "PREPEND_MESSAGES"; messages: SessionEntry[] }
  | { type: "SESSION_ASSIGNED"; sessionId: string };

// -- Context --

/** How many recent entries to load initially and on refresh. */
export const HISTORY_TAIL = 200;
/** Floor on how many real (typed/spoken) user messages the initial load must cover. */
export const MIN_REAL_USER_MESSAGES = 2;

export interface ChatContext {
  messages: SessionEntry[];
  /** Messages sent while agent was busy — preserved across refreshes until server catches up. */
  pendingMessages: SessionEntry[];
  streamText: string;
  streamTools: SessionContentBlock[];
  /** True when tools ran since the last text — the next text block needs a paragraph separator. */
  streamNeedsSeparator: boolean;
  error: string | null;
  /**
   * What to address backend chat calls by — either an existing session id
   * or `"new"` to start a fresh conversation. Held alongside `sessionId`
   * because for a freshly-created chat the server-assigned id arrives
   * after the first send completes.
   */
  sessionInput: string;
  sessionId: string | null;
  /**
   * Box-relative landmark directory this chat is bound to, set only when
   * the chat was opened from a landmark with `sessionInput === "new"`.
   * Passed to the backend on the first send so the SDK is spawned with
   * `cwd` at that directory; cleared once the session id is assigned (by
   * which point the backend has persisted the association).
   */
  contextDir?: string;
  /** Subprocess is alive (true once first send has started; stays true between turns). */
  processRunning: boolean;
  /** Subprocess is currently mid-turn — drives the "agent is processing" indicator. */
  processBusy: boolean;
  /** Total number of entries in the full session log. */
  totalEntries: number;
}

export interface ChatMachineInput {
  /** `"new"` for a fresh conversation, or an existing session id. */
  sessionInput: string;
  /**
   * Landmark directory binding for fresh chats. Only honored when
   * `sessionInput === "new"`; ignored for resumed sessions (those read
   * the binding from `chat-session-history` on the backend).
   */
  contextDir?: string | undefined;
}

export interface SessionInput {
  /** Either a known session id or the "new" sentinel. Null/undefined means brand-new shell with no history. */
  sessionInput: string;
}

/**
 * Logged at console.debug so it's silent by default in Chrome (visible
 * only with the Verbose filter on). Not forwarded to the server debug
 * log. Kept terse and structured for local grepping when investigating
 * a chat-machine wedge.
 */
export function logFsm(event: string, detail?: Record<string, unknown>): void {
  const parts = [`[chatfsm] ${event}`];
  if (detail) {
    for (const [k, v] of Object.entries(detail)) {
      parts.push(`${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
    }
  }
  console.debug(parts.join(" "));
}
