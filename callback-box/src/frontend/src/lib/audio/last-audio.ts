/**
 * The voice-audio retention singleton, plus the answer path for
 * agent-initiated `chat-last-audio-request` events (the agent runs
 * `cb chat get-last-audio`; the server relays the request over the event
 * bus; this tab uploads a cached recording in response).
 *
 * Replaces the old single-slot cache (docs/implemented-plans/input-extraction.md,
 * chunk 5): recordings are now retained per emission id in a
 * `RetentionStore` (`input/retention.ts`), so a send never has to clear
 * anything — `latest()` is well-defined by construction. Recordings live
 * only in this tab's memory (gone on reload); the server treats a "none"
 * answer as tentative, since another tab may still hold one.
 */

import { getApiBase } from "../../api-core";
import { createRetentionStore } from "../../input/retention";

export interface VoiceAudioPayload {
  blob: Blob;
  /** ISO timestamp of when the recording committed. */
  recordedAt: string;
  text: string;
}

/**
 * Cap on the transcript sent with the audio. It rides an HTTP header
 * server-side, so it can't be unbounded — but long dictations are exactly
 * where transcript-vs-audio comparison matters, so the cap is generous.
 */
const MAX_TEXT_CHARS = 1500;

/** v1 policy (docs/implemented-plans/input-extraction.md, chunk 5): memory-only, 5 most recent. */
const RETENTION_CAPACITY = 5;

// `null` is a tombstone: a voice send that had NO recording (stop-and-send,
// recovered dictation, keyword send with capture off/failed). It must occupy
// the "latest" slot so `get-last-audio` answers none — serving an OLDER
// message's recording as if it were the latest would mislead the agent
// (codex chunk-5 finding; matches the old single-slot cache's clear-on-
// voice-send behavior). Typed sends still never touch retention.
const retention = createRetentionStore<VoiceAudioPayload | null>({ capacity: RETENTION_CAPACITY });

/** Retain a committed voice segment's recording, keyed by its emission id. */
export function retainVoiceAudio(emissionId: string, opts: { blob: Blob; text: string }): void {
  retention.retain(emissionId, { blob: opts.blob, text: opts.text, recordedAt: new Date().toISOString() });
}

/** Mark a voice emission that has no recording (see the tombstone note above). */
export function markVoiceAudioAbsent(emissionId: string): void {
  retention.retain(emissionId, null);
}

/**
 * Answer one agent request: upload the most recently retained recording, or
 * report none. `sessionId` is this tab's own chat session id (the same value
 * `InteractiveChat-ws.ts` scopes broadcast events by) — `null` when the tab
 * has no assigned session yet; sent alongside the recording's identity so
 * the request's answerer is addressable (retranscription-in-chat plan,
 * Track 1).
 */
export async function fulfillLastAudioRequest(requestId: string, sessionId: string | null): Promise<void> {
  const url = `${getApiBase()}/chat/last-audio/${encodeURIComponent(requestId)}`;
  const entry = retention.latest();
  try {
    let res: Response;
    if (entry === undefined || entry.audio === null) {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ none: true }),
      });
    } else {
      const { audio } = entry;
      const form = new FormData();
      form.append("recordedAt", audio.recordedAt);
      form.append("text", audio.text.slice(0, MAX_TEXT_CHARS));
      form.append("messageId", entry.emissionId);
      if (sessionId !== null) form.append("sessionId", sessionId);
      const ext = audio.blob.type.includes("wav") ? "wav" : "webm";
      form.append("file", audio.blob, `last-message.${ext}`);
      res = await fetch(url, { method: "POST", body: form });
    }
    // 404 is the normal multi-tab outcome: another tab's answer already won.
    if (!res.ok && res.status !== 404) {
      console.warn(`[last-audio] answer rejected: HTTP ${res.status}`);
    }
  } catch (e) {
    console.warn(`[last-audio] answer failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
