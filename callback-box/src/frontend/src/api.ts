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
  return `/${firstSegment}/api`;
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
}

export interface SessionContentBlock {
  type: "text" | "tool_use" | "tool_result" | "thinking";
  text?: string;
  toolName?: string;
  toolId?: string;
  input?: Record<string, unknown>;
  inputSummary?: string;
  toolUseId?: string;
  resultSummary?: string;
}

export interface SessionEntry {
  uuid: string;
  type: "user" | "assistant";
  timestamp: string;
  content: SessionContentBlock[];
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

export async function getChatHistory(): Promise<{ sessionId: string | null; entries: SessionEntry[] }> {
  return fetchJson(`${getApiBase()}/chat/history`);
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
 */
export async function sendChatMessage(params: {
  message: string;
  onMessage: (msg: Record<string, unknown>) => void;
}): Promise<void> {
  const { message, onMessage } = params;
  const response = await fetch(`${getApiBase()}/chat/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    throw new Error(error.error || "Chat send failed");
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
