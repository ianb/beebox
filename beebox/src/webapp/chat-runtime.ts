/**
 * Per-box chat runtime accessor.
 *
 * The live `ChatSessionRegistry` + `ChatScheduleManager` are created once per
 * box in `registerChatRoutes` (they hold in-memory `ChatSession` subprocesses,
 * so they can't be rebuilt per request). The raw chat routes reach them through
 * a closure; the chat **tRPC** procedures reach them through this boxRoot-keyed
 * registry instead, so session controls (status/set-model/interrupt/…) can live
 * in tRPC rather than raw Fastify. `registerChatRoutes` sets the runtime on
 * setup and clears it on server close.
 */

import type { ChatSendInput, ChatSession } from "../core/chat/session/run/core.js";
import type { ChatSessionRegistry } from "../core/chat/session/registry/core.js";
import type { ChatScheduleManager } from "../core/chat/schedules/core.js";
import type { AgentEngine } from "../core/box/config.js";
import type { ChatChannel } from "../shared/chat-channel.js";
import type { SessionUser } from "./auth.js";

/** The status + body one `/api/chat/send` request answers with. */
export interface SendOutcome {
  status: number;
  body: { deduplicated: true } | { queued: true } | { turnId: string } | { error: string };
}

/** A resolved send target; `id` is null for a pending new chat. */
export interface ResolvedSendTarget {
  session: ChatSession;
  id: string | null;
}

export interface SendTargetArgs {
  sessionParam: string;
  contextDir: string | undefined;
  requestSeedFeatures: Record<string, string> | undefined;
  exactSession: boolean;
  /** Engine and model chosen before the chat existed; `"new"` sends only. */
  engine?: AgentEngine | undefined;
  model?: string | undefined;
}

/**
 * A send target, or the reply the route gives when there is none. A stale or
 * deleting session is a named 410 (`CHAT_SESSION_UNAVAILABLE`) that callers
 * branch on.
 */
export type SendTargetResult =
  | { ok: true; target: ResolvedSendTarget }
  | { ok: false; status: 400 | 404 | 410; error: string; code?: "CHAT_SESSION_UNAVAILABLE" };

export interface UserMessageSendArgs {
  target: ResolvedSendTarget;
  message: string;
  messageId?: string | undefined;
  user: SessionUser | null;
  channel: ChatChannel | undefined;
  images?: ChatSendInput["images"];
  cardFields?: Pick<ChatSendInput, "openCard" | "cardActivity" | "cardState" | "viewContext">;
}

/** The send route's body after target and identity resolution (routes/chat/user-message-sender.ts). */
export type UserMessageSender = (args: UserMessageSendArgs) => Promise<SendOutcome>;

export interface ChatRuntime {
  registry: ChatSessionRegistry;
  scheduleManager: ChatScheduleManager;
  /** Wire a session's events onto the shared event bus (idempotent). */
  wireSession: (session: ChatSession) => void;
  /** Startup backfill followed by husk reconciliation. */
  maintenance: Promise<void>;
  /** The send route's target resolution, for callers that are not routes. */
  resolveSendTarget: (args: SendTargetArgs) => Promise<SendTargetResult>;
  /** The send route's delivery, shared so one message id posts once on either path. */
  sendUserMessage: UserMessageSender;
}

const runtimes = new Map<string, ChatRuntime>();

export function setChatRuntime(boxRoot: string, runtime: ChatRuntime): void {
  runtimes.set(boxRoot, runtime);
}

export function clearChatRuntime(boxRoot: string): void {
  runtimes.delete(boxRoot);
}

/** The box's chat runtime, or undefined if its chat routes aren't registered. */
export function getChatRuntime(boxRoot: string): ChatRuntime | undefined {
  return runtimes.get(boxRoot);
}
