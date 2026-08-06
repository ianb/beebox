/**
 * Shared types, constants, and logging for the chat machine and its actors.
 * Kept in a leaf module so `chatMachine.ts` and `chat-actors.ts` can both
 * depend on it without forming a value import cycle.
 */

import type {
  SessionEntry,
  PendingSessionEntry,
  SessionContentBlock,
  ChatImageAttachment,
} from "../api";
import type { HistorySlice } from "../api-chat";
import type { ActivityKind, CardStateDetails } from "@core/chat/card-activity.js";

// -- Events --

export type ChatEvent =
  | { type: "SEND"; message: string; messageId: string; images?: ChatImageAttachment[]; openCard?: string; cardActivity?: ActivityKind[]; cardState?: CardStateDetails }
  | { type: "INTERRUPT" }
  | { type: "DISMISS_ERROR" }
  | { type: "STREAM_TEXT"; text: string }
  | { type: "STREAM_TOOL"; tool: SessionContentBlock }
  | { type: "STREAM_BUSY" }
  | { type: "STREAM_QUEUED" }
  | { type: "STREAM_ERROR"; error: string }
  | { type: "STREAM_RESULT" }
  | { type: "STREAM_FAILED"; error: string; accepted: boolean }
  // Like STREAM_FAILED but silent (no error banner): the per-turn stream went
  // quiet — typically its connection was dropped while the tab was backgrounded
  // — but the server reports the turn already finished, so recover by refreshing
  // history rather than waiting on a terminal event that will never arrive.
  | { type: "STREAM_RECOVER" }
  | { type: "REFRESH" }
  | { type: "SET_MESSAGES"; messages: SessionEntry[]; sessionId: string | null }
  | { type: "OTHER_USER_MESSAGE"; message: string; userName: string; timestamp: string }
  | { type: "PREPEND_MESSAGES"; messages: SessionEntry[] }
  | { type: "SET_SEED_FEATURE"; feature: string; value: string }
  | { type: "SESSION_ASSIGNED"; sessionId: string };

// -- Context --

/**
 * How many recent entries to load initially and on refresh. Mirrors the
 * server's `CHAT_HISTORY_TAIL` (`core/chat/session/load-history.ts`), which is
 * what the schedule-fire broadcast uses, so both surfaces show the same window.
 */
export const HISTORY_TAIL = 200;
/** Floor on how many real (typed/spoken) user messages the initial load must cover. */
export const MIN_REAL_USER_MESSAGES = 2;

/** The live chat's history request: the last {@link HISTORY_TAIL} entries. */
export function chatTailSlice(): HistorySlice {
  return { mode: "tail", tail: HISTORY_TAIL, minRealUserMessages: MIN_REAL_USER_MESSAGES };
}

export interface ChatContext {
  messages: SessionEntry[];
  /** Client-created messages preserved across snapshots until server history echoes them. */
  pendingMessages: PendingSessionEntry[];
  streamText: string;
  streamTools: SessionContentBlock[];
  /** True when tools ran since the last text — the next text block needs a paragraph separator. */
  streamNeedsSeparator: boolean;
  error: string | null;
  /**
   * True once the user clicked stop for the current turn. The SDK ends an
   * interrupted turn with is_error / subtype "error_during_execution" — a
   * user-initiated abort, not a failure — so this flag tells the result
   * handler to suppress the error banner. Set by INTERRUPT, cleared when the
   * error is suppressed and when the next turn starts (SEND from idle).
   * `error_during_execution` can also be a real crash, so the flag, not the
   * subtype, is the discriminator.
   */
  interrupting: boolean;
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
  /**
   * Chat-feature seeds chosen before the session exists (e.g. turning on
   * narration in a brand-new chat). Folded into the first send of a `"new"`
   * session so the choice applies to the very first turn; cleared once the
   * session id is assigned (the backend has persisted them by then).
   */
  seedFeatures?: Record<string, string>;
  /** Subprocess is alive (true once first send has started; stays true between turns). */
  processRunning: boolean;
  /** Subprocess is currently mid-turn — drives the "agent is processing" indicator. */
  processBusy: boolean;
  /** Total number of entries in the full session log. */
  totalEntries: number;
  /**
   * Stable id for the turn currently streaming (or most recently finalized),
   * set when a turn starts and held until the next send. Keys the live
   * assistant bubble so the streamed and finalized render share one DOM node —
   * finalize becomes an in-place update, not a remount/flash. Null before the
   * first turn of the session.
   */
  liveTurnId: string | null;
  /**
   * The caller-supplied initial load, consumed by the `loading` state's
   * `fetchInitial` and cleared when it leaves. Transient (and not
   * serializable-forever like the rest of context) — it exists here only
   * because an invoke's `input` can read nothing but context.
   */
  initial?: ChatInitialLoad | undefined;
}

/**
 * A session's initial history + status, already fetched by the mounting page
 * (`ChatPage` gets it from `chat.bootstrap`, which resolves the session and
 * loads both in one round trip). Handed to the machine as input so its
 * `loading` state consumes this instead of asking the server again — the
 * duplicate that used to make opening a chat cost two serial stages.
 *
 * `failed` carries a load that already failed: the machine reproduces it
 * through the same `fetchInitial` onError path a live fetch failure takes, so
 * there is one error surface regardless of who did the fetching.
 */
export type ChatInitialLoad =
  | {
      status: "loaded";
      entries: SessionEntry[];
      total: number;
      sessionId: string | null;
      running: boolean;
      busy: boolean;
    }
  | { status: "failed"; error: string };

/** A preloaded initial load reported as failed — see `ChatInitialLoad`. */
export class ChatInitialLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatInitialLoadError";
  }
}

export interface ChatMachineInput {
  /** `"new"` for a fresh conversation, or an existing session id. */
  sessionInput: string;
  /**
   * History + status for `sessionInput`, already fetched. Optional: a caller
   * without it (or a `"new"` chat, which has nothing to load) leaves the
   * machine to fetch for itself.
   */
  initial?: ChatInitialLoad | undefined;
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

export interface InitialSessionInput extends SessionInput {
  /** Preloaded history + status for `sessionInput`, when the caller had it. */
  initial?: ChatInitialLoad | undefined;
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
