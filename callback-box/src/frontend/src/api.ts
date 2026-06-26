/**
 * API client for the Callback Box backend.
 *
 * Most endpoints have been migrated to tRPC (see lib/trpc.ts).
 * This file retains only functions that use patterns tRPC can't handle:
 * - SSE streaming (chat)
 * - File uploads (voice memos, file uploads)
 * - getApiBase() for SSE/WebSocket URL construction
 * - Legacy type exports still referenced by components
 *
 * Core primitives live in api-core.ts and the chat surface in api-chat.ts;
 * both are re-exported here so callers keep importing from "./api".
 */

import { RequestError } from "./lib/errors";
import { getApiBase } from "./api-core";

export {
  getApiBase,
  getWebSocketUrl,
  joinBaseAndPath,
  withBase,
} from "./api-core";

export type {
  ChatImageAttachment,
  ChatSessionInfo,
  HqTranscriptionResult,
  SessionContentBlock,
  SessionEntry,
} from "./api-chat";

export {
  getChatFeatures,
  getChatHistory,
  getChatSessions,
  getChatStatus,
  getDefaultChatSession,
  interruptChat,
  postAudioForHqTranscription,
  restartChatSubprocess,
  startChatTurn,
  setChatFeature,
  setChatModel,
} from "./api-chat";

// --- Types still imported by components ---

export interface CardInfo {
  path: string;
  relativePath: string;
  name: string;
  type: string;
  status?: string;
  prompt?: string;
  options?: string[];
  /** Subdirectory within the parent dir (e.g., "email" for inbox/email/) */
  subdir?: string;
}

export interface HistoryCommit {
  hash: string;
  date: string;
  subject: string;
  body?: string;
  trailers?: Record<string, string | string[]>;
  fileStat?: { added: number; modified: number; deleted: number; renamed: number; insertions: number; deletions: number };
}

// --- File uploads (multipart — can't use tRPC) ---

export async function createVoiceMemo(
  audioBlob: Blob
): Promise<{ success: boolean; path: string; audioPath: string }> {
  const formData = new FormData();
  formData.append("file", audioBlob, "recording.webm");

  const response = await fetch(`${getApiBase()}/actions/create-voice-memo`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new RequestError(error.error || error.message || "Request failed");
  }

  return response.json();
}

/**
 * Upload a file to temp storage and return the path.
 */
export async function uploadFile(
  blob: Blob,
  filename?: string
): Promise<{ success: boolean; path: string; mimetype: string; size: number }> {
  const formData = new FormData();
  formData.append("file", blob, filename ?? "upload");

  const response = await fetch(`${getApiBase()}/upload`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new RequestError(error.error || error.message || "Upload failed");
  }

  return response.json();
}

