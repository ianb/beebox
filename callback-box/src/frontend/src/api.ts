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
 * Pure helper exported for testability: combine a base URL prefix and a
 * path. Kept separate from `withBase()` so the join logic can be unit-
 * tested without import.meta.env runtime dependency.
 *
 *   joinBaseAndPath("/",      "/api/foo") === "/api/foo"
 *   joinBaseAndPath("/main/", "/api/foo") === "/main/api/foo"
 *   joinBaseAndPath("/main",  "/api/foo") === "/main/api/foo"
 *   joinBaseAndPath("/main/", "api/foo")  === "/main/api/foo"
 */
export function joinBaseAndPath(base: string, p: string): string {
  const prefix = base.replace(/\/$/, "");
  if (!prefix) return p.startsWith("/") ? p : `/${p}`;
  return p.startsWith("/") ? `${prefix}${p}` : `${prefix}/${p}`;
}

/**
 * Prefix an absolute path with the Vite base URL (set via the `base` option
 * in vite.config.ts, surfaced at runtime as `import.meta.env.BASE_URL`).
 *
 * Use this any time you have a hardcoded URL like "/api/something" or
 * "/auth/login" that goes through Vite/the router. Without prefixing,
 * the router sees the first segment as the worktree name and 404s.
 *
 * In prod (base="/", the Vite default) this is a no-op — BASE_URL is "/"
 * which the helper treats as empty prefix.
 */
export function withBase(p: string): string {
  return joinBaseAndPath(import.meta.env.BASE_URL ?? "/", p);
}

/**
 * Get the API base URL for the current box, derived from the URL's first
 * path segment after the Vite base path.
 *
 * In dev under the monorepo router the URL shape is
 *   /<worktree>/<box>/... → API base is /<worktree>/<box>/api
 * Vite's `base` is set to `/<worktree>/` at build/dev time and exposed via
 * import.meta.env.BASE_URL, so we strip it before parsing the box.
 *
 * In prod (and dev without a base) the URL shape is just /<box>/...
 */
export function getApiBase(): string {
  const base = import.meta.env.BASE_URL ?? "/"; // e.g. "/main/" or "/"
  const pathname = window.location.pathname;
  // Strip the base prefix if present.
  const stripped = pathname.startsWith(base)
    ? pathname.slice(base.length - (base.endsWith("/") ? 1 : 0))
    : pathname;
  const firstSegment = stripped.split("/")[1] || "";
  const prefix = base.replace(/\/$/, "");
  if (!firstSegment) return `${prefix}/api`;
  return `${prefix}/${firstSegment}/api`;
}

/**
 * Get the base URL for EventSource (SSE) connections.
 *
 * Used to direct-connect to the backend port (bypassing Vite's proxy for
 * long-lived SSE). Under the monorepo router that backdoor doesn't apply —
 * the router proxies SSE just fine, and the backend port is dynamic anyway.
 * So we just use the same origin as the page in all cases now.
 */
export function getEventSourceBase(): string {
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
  type: "user" | "assistant" | "compaction" | "interrupted";
  timestamp: string;
  content: SessionContentBlock[];
  /** Display name of the sender (for user messages in multi-user chat) */
  user?: string;
  /** Email of the sender (for identity matching across devices) */
  userEmail?: string;
  /**
   * Client-only flag: this entry was queued because the agent was busy
   * and hasn't yet been confirmed by the server as delivered. Rendered
   * with a "sending" indicator. Cleared when the server history catches
   * up (see reconcilePending in chatMachine).
   */
  pending?: boolean;
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
    window.location.href = withBase(`/auth/login?returnTo=${returnTo}`);
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

export async function getChatStatus(params: { sessionId: string | null }): Promise<{ sessionId: string | null; running: boolean; busy: boolean; model: string | null }> {
  const qs = params.sessionId ? `?session=${encodeURIComponent(params.sessionId)}` : "";
  return fetchJson(`${getApiBase()}/chat/status${qs}`);
}

export async function getDefaultChatSession(): Promise<{ sessionId: string | null }> {
  return fetchJson(`${getApiBase()}/chat/default`);
}

export async function setChatModel(params: { sessionId: string; model: string | null }): Promise<{ ok: boolean; model: string | null }> {
  return fetchJson(`${getApiBase()}/chat/set-model`, {
    method: "POST",
    body: JSON.stringify({ session: params.sessionId, model: params.model }),
  });
}

export async function getChatFeatures(params: { sessionId: string }): Promise<{ features: Record<string, string> }> {
  return fetchJson(`${getApiBase()}/chat/features?session=${encodeURIComponent(params.sessionId)}`);
}

export async function setChatFeature(params: { sessionId: string; feature: string; value: string }): Promise<{ ok: boolean; features: Record<string, string> }> {
  return fetchJson(`${getApiBase()}/chat/set-feature`, {
    method: "POST",
    body: JSON.stringify({ session: params.sessionId, feature: params.feature, value: params.value }),
  });
}

/**
 * Send a recorded audio blob to the HQ transcription pass used by narration
 * mode. Returns the transcribed text, or null on failure — the caller falls
 * back to the realtime transcript in that case.
 */
export async function postAudioForHqTranscription(blob: Blob): Promise<string | null> {
  const form = new FormData();
  const ext = blob.type.includes("wav") ? "wav" : "webm";
  form.append("file", blob, `segment.${ext}`);
  try {
    const res = await fetch(`${getApiBase()}/chat/transcribe-audio`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      console.warn(`[hq-transcribe] HTTP ${res.status}: ${await res.text()}`);
      return null;
    }
    const body: unknown = await res.json();
    if (body === null || typeof body !== "object" || !("text" in body) || typeof body.text !== "string") {
      console.warn(`[hq-transcribe] response missing text field: ${JSON.stringify(body)}`);
      return null;
    }
    return body.text;
  } catch (e) {
    console.warn(`[hq-transcribe] request failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

export async function getChatHistory(params: { sessionId: string; tail?: number; offset?: number; limit?: number; minRealUserMessages?: number }): Promise<{ sessionId: string | null; entries: SessionEntry[]; total: number }> {
  const searchParams = new URLSearchParams();
  searchParams.set("session", params.sessionId);
  if (params.tail) searchParams.set("tail", String(params.tail));
  if (params.offset != null) searchParams.set("offset", String(params.offset));
  if (params.limit) searchParams.set("limit", String(params.limit));
  if (params.minRealUserMessages) searchParams.set("minRealUserMessages", String(params.minRealUserMessages));
  return fetchJson(`${getApiBase()}/chat/history?${searchParams.toString()}`);
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

export async function interruptChat(params: { sessionId: string }): Promise<{ ok: boolean }> {
  return fetchJson(`${getApiBase()}/chat/interrupt`, {
    method: "POST",
    body: JSON.stringify({ session: params.sessionId }),
  });
}

/**
 * Kill the chat subprocess without resetting the session id. Queued
 * messages drain into the fresh subprocess automatically. Use this to
 * unstick a wedged chat.
 */
export async function restartChatSubprocess(params: { sessionId: string }): Promise<{ ok: boolean }> {
  return fetchJson(`${getApiBase()}/chat/restart`, {
    method: "POST",
    body: JSON.stringify({ session: params.sessionId }),
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
  /** Session to send into. Pass `"new"` to start a fresh conversation. */
  session: string;
  message: string;
  /** Stable id used by the backend to dedupe retries. If omitted, one is
   *  generated per call — pass an explicit id to dedupe across separate
   *  callers (e.g. an actor body that runs twice under StrictMode). */
  messageId?: string;
  images?: ChatImageAttachment[];
  /**
   * Box-relative landmark directory to bind a fresh chat to. Only honored
   * when `session === "new"`; the backend uses it to spawn the SDK with
   * `cwd` set to that directory and persists the association.
   */
  contextDir?: string;
  onMessage: (msg: Record<string, unknown>) => void;
}): Promise<void> {
  const { session, message, images, contextDir, onMessage } = params;
  const messageId = params.messageId ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const attempt = async (_retry: boolean): Promise<Response> => {
    const response = await fetch(`${getApiBase()}/chat/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session,
        message,
        messageId,
        ...(images && images.length > 0 ? { images } : {}),
        ...(contextDir !== undefined ? { contextDir } : {}),
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
