/**
 * Report-back for `cb chat retranscribe` / `cb chat ask-about-audio`
 * (retranscription-in-chat plan, Track 2): after a successful HQ pass or
 * analysis, POST a small payload to `POST /api/chat/audio-review` so a
 * connected chat tab can overlay the result on the original message.
 *
 * Split into a pure build step (this module's `buildRetranscriptionReport`/
 * `buildConsultedReport`, unit-testable without a network) and a best-effort
 * POST (`postAudioReviewReport`) — both `--file` runs and old tabs that never
 * echoed an id skip silently by construction (the build functions return
 * `null`); a failed/unreachable POST warns once but never fails the command.
 */

import { loopbackHeaders } from "./chat-audio-fetch.js";

export interface RetranscriptionReport {
  kind: "retranscription";
  sessionId: string;
  messageId: string;
  newText: string;
  service?: string;
  diarized: boolean;
  recordedAt?: string;
}

export interface ConsultedReport {
  kind: "consulted";
  sessionId: string;
  messageId: string;
  command: "ask-about-audio";
  /** The question asked about the recording — surfaces in the badge popover. */
  question: string;
}

export type AudioReviewReport = RetranscriptionReport | ConsultedReport;

/**
 * Build the `chat-retranscription` report body, or `null` when it can't be
 * addressed — `sessionId`/`messageId` are null for a `--file` run or an old
 * browser tab that answered without echoing them (fail-open to today's
 * behavior: no report, not a broken command).
 */
export function buildRetranscriptionReport(opts: {
  sessionId: string | null;
  messageId: string | null;
  newText: string;
  service: string | undefined;
  diarized: boolean;
  recordedAt: string | null;
}): RetranscriptionReport | null {
  const { sessionId, messageId, newText, service, diarized, recordedAt } = opts;
  if (sessionId === null || messageId === null) return null;
  return {
    kind: "retranscription",
    sessionId,
    messageId,
    newText,
    diarized,
    ...(service !== undefined ? { service } : {}),
    ...(recordedAt !== null ? { recordedAt } : {}),
  };
}

/** Build the `chat-audio-consulted` report body, or `null` for the same reasons as {@link buildRetranscriptionReport}. */
export function buildConsultedReport(opts: {
  sessionId: string | null;
  messageId: string | null;
  question: string;
}): ConsultedReport | null {
  const { sessionId, messageId, question } = opts;
  if (sessionId === null || messageId === null) return null;
  return { kind: "consulted", sessionId, messageId, command: "ask-about-audio", question };
}

/**
 * POST a report to `/api/chat/audio-review`, best-effort. Never throws —
 * an unreachable server or a rejected body logs one `console.warn` line and
 * returns; the caller's own stdout/exit code stay unaffected (principle #4:
 * the agent's own reading of the result is primary and must not break with
 * the UI).
 */
export async function postAudioReviewReport(report: AudioReviewReport): Promise<void> {
  const serverUrl = process.env.CB_SERVER_URL;
  const boxName = process.env.CB_BOX_NAME;
  if (!serverUrl || !boxName) {
    console.warn("cb chat audio-review report skipped: CB_SERVER_URL/CB_BOX_NAME not set");
    return;
  }
  const url = `${serverUrl.replace(/\/+$/, "")}/${boxName}/api/chat/audio-review`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: loopbackHeaders(),
      body: JSON.stringify(report),
    });
    if (!res.ok) {
      console.warn(`cb chat audio-review report failed: HTTP ${res.status}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`cb chat audio-review report failed: ${msg}`);
  }
}
