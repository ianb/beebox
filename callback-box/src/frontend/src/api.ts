/**
 * API client for the Callback Box backend.
 *
 * Most endpoints have been migrated to tRPC (see lib/trpc.ts).
 * This file retains only functions that use patterns tRPC can't handle:
 * - SSE streaming (chat, command execution)
 * - File uploads (voice memos, file uploads)
 * - getApiBase() for SSE/WebSocket URL construction
 * - Legacy type exports still referenced by components
 */

/**
 * Get the API base URL for the current box, derived from the URL's first path segment.
 * e.g., /test1/chat → /test1/api
 */
export function getApiBase(): string {
  const firstSegment = window.location.pathname.split("/")[1] || "";
  if (!firstSegment) return "/api";
  return `/${firstSegment}/api`;
}

/**
 * Get the base URL for EventSource (SSE) connections.
 * In dev mode (Vite dev server on port 3210), connects directly to the
 * Fastify backend (port 3211) to bypass Vite's proxy which unreliably
 * handles long-lived SSE connections.
 * In production, uses the same origin as the page.
 */
export function getEventSourceBase(): string {
  // Runtime check: Vite dev server runs on port 3210
  if (window.location.port === "3210") {
    const firstSegment = window.location.pathname.split("/")[1] || "";
    return `http://${window.location.hostname}:3211/${firstSegment}/api`;
  }
  return getApiBase();
}

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
  /** Subdirectory within the parent dir (e.g., "news" for inbox/news/) */
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

export interface SessionContentBlock {
  type: "text" | "tool_use" | "tool_result" | "thinking" | "image";
  text?: string;
  toolName?: string;
  toolId?: string;
  input?: Record<string, unknown>;
  inputSummary?: string;
  toolUseId?: string;
  resultSummary?: string;
  /** For image blocks: MIME type like "image/png" */
  mediaType?: string;
  /** For image blocks with base64 source: raw base64 (no data: prefix) */
  dataBase64?: string;
  /** For image blocks with URL source */
  imageUrl?: string;
}

/**
 * An image attachment sent with a chat message, addressable by numeric id
 * via `[imageN]` tokens in the text.
 */
export interface ChatImageAttachment {
  id: number;
  mimeType: string;
  /** Raw base64 data (no data: URL prefix) */
  dataBase64: string;
}

export interface SessionEntry {
  uuid: string;
  type: "user" | "assistant" | "compaction";
  timestamp: string;
  content: SessionContentBlock[];
  /** Display name of the sender (for user messages in multi-user chat) */
  user?: string;
  /** Email of the sender (for identity matching across devices) */
  userEmail?: string;
}

// --- Shared fetch helper ---

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (response.status === 401) {
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/auth/login?returnTo=${returnTo}`;
    // Never resolves — page is navigating away
    return new Promise(() => {});
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || error.message || "Request failed");
  }

  return response.json();
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
    throw new Error(error.error || error.message || "Request failed");
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
    throw new Error(error.error || error.message || "Upload failed");
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
    throw new Error(error.error || "Command execution failed");
  }

  // Parse SSE stream
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

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

// --- Chat API (SSE streaming — can't use tRPC) ---

export async function getChatStatus(): Promise<{ sessionId: string | null; running: boolean; busy: boolean }> {
  return fetchJson(`${getApiBase()}/chat/status`);
}

export async function getChatHistory(params?: { sessionId?: string; tail?: number; offset?: number; limit?: number }): Promise<{ sessionId: string | null; entries: SessionEntry[]; total: number }> {
  const searchParams = new URLSearchParams();
  if (params?.sessionId) searchParams.set("session", params.sessionId);
  if (params?.tail) searchParams.set("tail", String(params.tail));
  if (params?.offset != null) searchParams.set("offset", String(params.offset));
  if (params?.limit) searchParams.set("limit", String(params.limit));
  const qs = searchParams.toString();
  return fetchJson(`${getApiBase()}/chat/history${qs ? `?${qs}` : ""}`);
}

export interface ChatSessionInfo {
  sessionId: string;
  source: string;
  label: string;
  lastUsedAt: string;
  isActive: boolean;
}

export async function getChatSessions(): Promise<{ sessions: ChatSessionInfo[] }> {
  return fetchJson(`${getApiBase()}/chat/sessions`);
}

export async function interruptChat(): Promise<{ ok: boolean }> {
  return fetchJson(`${getApiBase()}/chat/interrupt`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function resetChatSession(): Promise<{ ok: boolean }> {
  return fetchJson(`${getApiBase()}/chat/reset`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

/**
 * Send a chat message and stream the response via SSE.
 * Calls onMessage for each streamed JSON message from Claude.
 * Returns when the turn is complete.
 *
 * Retries once on network failure with a messageId to prevent duplicates.
 */
export async function sendChatMessage(params: {
  message: string;
  images?: ChatImageAttachment[];
  onMessage: (msg: Record<string, unknown>) => void;
}): Promise<void> {
  const { message, images, onMessage } = params;
  const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const attempt = async (_retry: boolean): Promise<Response> => {
    const response = await fetch(`${getApiBase()}/chat/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        messageId,
        ...(images && images.length > 0 ? { images } : {}),
      }),
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: response.statusText }));
      throw new Error(error.error || "Chat send failed");
    }

    return response;
  };

  let response: Response;
  try {
    response = await attempt(false);
  } catch (err) {
    // Retry once on network errors (not HTTP errors — those already threw above).
    // fetch() throws TypeError on network failure.
    if (err instanceof TypeError) {
      console.warn("[chat] Send failed with network error, retrying...", err.message);
      await new Promise((r) => setTimeout(r, 2000));
      response = await attempt(true);
    } else {
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          onMessage(data);
        } catch {
          // Skip unparseable lines
        }
      }
    }
  }

  // Process remaining buffer
  if (buffer.startsWith("data: ")) {
    try {
      const data = JSON.parse(buffer.slice(6));
      onMessage(data);
    } catch {
      // Skip
    }
  }
}
