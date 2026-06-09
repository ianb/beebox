/**
 * API client for the Callback Box backend.
 *
 * Most endpoints have been migrated to tRPC (see lib/trpc.ts).
 * This file retains only functions that use patterns tRPC can't handle:
 * - SSE streaming (chat, command execution)
 * - File uploads (voice memos, file uploads)
 * - getApiBase() for SSE/WebSocket URL construction
 * - Legacy type exports still referenced by components
 *
 * Core primitives live in api-core.ts and the chat surface in api-chat.ts;
 * both are re-exported here so callers keep importing from "./api".
 */

import { RequestError } from "./lib/errors";
import { getApiBase, NoResponseBodyError } from "./api-core";

export {
  getApiBase,
  getEventSourceBase,
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
  sendChatMessage,
  setChatFeature,
  setChatModel,
} from "./api-chat";

// --- Types still imported by components ---

export interface CardInfo {
  path: string;
  relativePath: string;
  name: string;
  type: string;
  tagName: string;
  status?: string;
  prompt?: string;
  options?: string[];
  /** Subdirectory within the parent dir (e.g., "email" for inbox/email/) */
  subdir?: string;
}

/**
 * Element node structure from parsed XML.
 */
export interface ElementNode {
  tagName: string;
  attrs: Record<string, string>;
  text?: string;
  children?: ElementNode[];
}

export interface CommandResult {
  success: boolean;
  data?: unknown;
  error?: string;
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

// --- SSE streaming (can't use tRPC) ---

/**
 * Execute a command with streaming output.
 */
export interface ExecuteCommandParams {
  command: string;
  args: Record<string, unknown>;
  onOutput?: (text: string) => void;
}

export async function executeCommand(
  params: ExecuteCommandParams
): Promise<CommandResult> {
  const { command, args, onOutput } = params;
  const response = await fetch(`${getApiBase()}/commands/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ command, args }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new RequestError(error.error || "Command execution failed");
  }

  // Parse SSE stream
  const reader = response.body?.getReader();
  if (!reader) throw new NoResponseBodyError();

  const decoder = new TextDecoder();
  let result: CommandResult = { success: false, error: "No result received" };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value);
    const lines = text.split("\n");

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6));
        if (data.type === "output" && data.text) {
          onOutput?.(data.text);
        } else if (data.type === "result") {
          result = {
            success: data.success,
            data: data.data,
            error: data.error,
          };
        }
      }
    }
  }

  return result;
}
