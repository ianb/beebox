/**
 * Chat API surface: SSE streaming send, session/status/history queries, model
 * and feature toggles, and HQ audio transcription. Split out of api.ts to keep
 * that file under the line limit; api.ts re-exports everything here so callers
 * keep importing from "./api" unchanged.
 */

import { RequestError } from "./lib/errors";
import { fetchJson, getApiBase } from "./api-core";
import type { ActivityKind } from "../../core/chat-card-activity";

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

/** Outcome of starting a chat turn — see {@link startChatTurn}. */
export interface ChatTurnStart {
  /** Server-minted id to subscribe to (events.turnStream) for the output.
   *  Absent when the send was queued or deduplicated (no new stream). */
  turnId?: string;
  /** The agent was busy; the message was queued and will surface via refresh. */
  queued?: boolean;
  /** This messageId was already processed; the turn is already done. */
  deduplicated?: boolean;
}

/**
 * Start a chat turn. POSTs the message and returns immediately with a `turnId`
 * (or `queued`/`deduplicated`). The turn's output is delivered separately over
 * the `events.turnStream` subscription, keyed by that turnId — so a dropped
 * connection resumes the stream instead of losing it.
 *
 * Retries once on network failure with a stable messageId to prevent dup turns.
 */
export async function startChatTurn(params: {
  /** Session to send into. Pass `"new"` to start a fresh conversation. */
  session: string;
  message: string;
  /** Stable id used by the backend to dedupe retries. If omitted, one is
   *  generated per call — pass an explicit id to dedupe across separate
   *  callers (e.g. an actor body that runs twice under StrictMode). */
  messageId?: string;
  images?: ChatImageAttachment[];
  /** Box-relative landmark directory to bind a fresh chat to (session "new"). */
  contextDir?: string;
  /** Pre-session chat-feature seeds (session "new"). */
  seedFeatures?: Record<string, string>;
  /** Box-relative path of the card open in the companion pane at send time. */
  openCard?: string;
  /** What the user did to the companion-pane card since the last reply. */
  cardActivity?: ActivityKind[];
}): Promise<ChatTurnStart> {
  const { session, message, images, contextDir, seedFeatures, openCard, cardActivity } = params;
  const messageId = params.messageId ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const attempt = async (): Promise<Response> => {
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
        ...(openCard !== undefined ? { openCard } : {}),
        ...(cardActivity && cardActivity.length > 0 ? { cardActivity } : {}),
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
    response = await attempt();
  } catch (err) {
    // Retry once on network errors (not HTTP errors — those already threw above).
    // fetch() throws TypeError on network failure.
    if (err instanceof TypeError) {
      console.warn("[chat] Send failed with network error, retrying...", err.message);
      await new Promise((r) => setTimeout(r, 2000));
      response = await attempt();
    } else {
      throw err instanceof Error ? err : new RequestError(String(err));
    }
  }

  return (await response.json()) as ChatTurnStart;
}
