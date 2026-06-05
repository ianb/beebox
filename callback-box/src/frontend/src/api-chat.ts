/**
 * Chat API surface: SSE streaming send, session/status/history queries, model
 * and feature toggles, and HQ audio transcription. Split out of api.ts to keep
 * that file under the line limit; api.ts re-exports everything here so callers
 * keep importing from "./api" unchanged.
 */

import { RequestError } from "./lib/errors";
import { fetchJson, getApiBase, NoResponseBodyError } from "./api-core";

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
export interface HqTranscriptionResult {
  text: string;
  /** True when the recording was diarized and speaker labels were applied. */
  diarized: boolean;
}

export async function postAudioForHqTranscription(blob: Blob, params: { sessionId: string | null }): Promise<HqTranscriptionResult | null> {
  const form = new FormData();
  const ext = blob.type.includes("wav") ? "wav" : "webm";
  form.append("file", blob, `segment.${ext}`);
  if (params.sessionId !== null) form.append("session", params.sessionId);
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
    const diarized = "diarized" in body && body.diarized === true;
    return { text: body.text, diarized };
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
  /**
   * Chat-feature seeds chosen before the session existed (e.g. narration
   * toggled on in a brand-new chat). Only honored when `session === "new"`;
   * the backend merges them over landmark defaults so the choice applies to
   * the first turn.
   */
  seedFeatures?: Record<string, string>;
  onMessage: (msg: Record<string, unknown>) => void;
}): Promise<void> {
  const { session, message, images, contextDir, seedFeatures, onMessage } = params;
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
        ...(seedFeatures !== undefined ? { seedFeatures } : {}),
      }),
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: response.statusText }));
      throw new RequestError(error.error || "Chat send failed");
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
      throw err instanceof Error ? err : new RequestError(String(err));
    }
  }

  const reader = response.body?.getReader();
  if (!reader) throw new NoResponseBodyError();

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
        } catch (e) {
          // Malformed SSE data line — partial frames can occur mid-stream, so
          // log at debug rather than spamming warn.
          console.debug("Skipping unparseable SSE data line:", e);
        }
      }
    }
  }

  // Process remaining buffer
  if (buffer.startsWith("data: ")) {
    try {
      const data = JSON.parse(buffer.slice(6));
      onMessage(data);
    } catch (e) {
      console.debug("Skipping unparseable trailing SSE buffer:", e);
    }
  }
}
