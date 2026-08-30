/**
 * API client for the Bee Box backend.
 *
 * Most endpoints have been migrated to tRPC (see lib/trpc.ts).
 * This file retains only functions that use patterns tRPC can't handle:
 * - SSE streaming (chat)
 * - getApiBase() for SSE/WebSocket URL construction
 * - Legacy type exports still referenced by components
 *
 * Core primitives live in api-core.ts and the chat surface in api-chat.ts;
 * both are re-exported here so callers keep importing from "./api".
 *
 * `HistoryCommit` is a plain type export (no transport), kept here because
 * components already import it from this path. (Question surfaces now derive
 * their card type from the tRPC output — `RouterOutput["status"]["questions"]`
 * — rather than a hand-written duplicate.)
 */

export {
  apiRawFileUrl,
  getApiBase,
  getWebSocketUrl,
  joinBaseAndPath,
  withBase,
} from "./api-core";

export type {
  ChatImageAttachment,
  ChatSessionInfo,
  DeadChatInfo,
  HqTranscriptionResult,
  PendingSessionEntry,
  SessionContentBlock,
  SessionEntry,
} from "./api-chat";

export {
  getChatFeatures,
  getChatHistory,
  getChatSessions,
  getChatStatus,
  setDefaultChatModel,
  interruptChat,
  postAudioForHqTranscription,
  restartChatSubprocess,
  startChatTurn,
  setChatFeature,
  setChatModel,
} from "./api-chat";

// --- Types still imported by components ---

export interface HistoryCommit {
  hash: string;
  date: string;
  subject: string;
  body?: string;
  trailers?: Record<string, string | string[]>;
  fileStat?: { added: number; modified: number; deleted: number; renamed: number; insertions: number; deletions: number };
}
