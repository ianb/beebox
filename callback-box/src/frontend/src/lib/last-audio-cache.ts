/**
 * In-memory cache of the most recent voice message's original recording,
 * plus the answer path for agent-initiated `chat-last-audio-request` events
 * (the agent runs `cb chat get-last-audio`; the server relays the request
 * over the event bus; this tab uploads its cached blob in response).
 *
 * The blob lives only in this tab's memory: set when a voice message commits
 * (runKeywordSend's submit), cleared when any send moves "the last message"
 * past it, gone on reload. The server treats a "none" answer as tentative —
 * another tab may still hold the recording — so tabs always answer.
 */

import { getApiBase } from "../api-core";

interface CachedMessageAudio {
  blob: Blob;
  /** ISO timestamp of when the recording committed. */
  recordedAt: string;
  text: string;
}

/** Cap on the transcript snippet sent with the audio (it rides an HTTP header server-side). */
const MAX_TEXT_CHARS = 300;

let cached: CachedMessageAudio | null = null;

export function setLastMessageAudio(opts: { blob: Blob; text: string }): void {
  cached = { blob: opts.blob, recordedAt: new Date().toISOString(), text: opts.text };
}

export function clearLastMessageAudio(): void {
  cached = null;
}

/** Answer one agent request: upload the cached recording, or report none. */
export async function fulfillLastAudioRequest(requestId: string): Promise<void> {
  const url = `${getApiBase()}/chat/last-audio/${encodeURIComponent(requestId)}`;
  try {
    let res: Response;
    if (cached === null) {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ none: true }),
      });
    } else {
      const form = new FormData();
      form.append("recordedAt", cached.recordedAt);
      form.append("text", cached.text.slice(0, MAX_TEXT_CHARS));
      const ext = cached.blob.type.includes("wav") ? "wav" : "webm";
      form.append("file", cached.blob, `last-message.${ext}`);
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
