/**
 * Last-audio request relay (web → native).
 *
 * A box agent running `bbx chat retranscribe --message <id>` long-polls the
 * server, which broadcasts `chat-last-audio-request` to every connected chat
 * tab. Web tabs answer from their own in-memory retention store
 * (`lib/audio/last-audio.ts`). A tab running inside a native shell ALSO hands
 * the request to the shell, because a message dictated in the native composer
 * was recorded natively — the web layer never held those bytes and can only
 * ever answer "none" for them.
 *
 * The shell answers the server DIRECTLY over HTTP (`ChatAPI.answerLastAudio` →
 * `POST /api/chat/last-audio/:requestId`); nothing comes back across this
 * channel. That keeps the audio out of the webview entirely rather than
 * base64-ing megabytes of WAV through a script message.
 *
 * `sessionId` is the relaying tab's own chat session id. The shell echoes it
 * back only as a fallback: it stores the session each recording was dictated
 * into and prefers that, since the echoed session is what addresses the
 * retranscription report and the phone may have navigated to another
 * conversation since. Null before this tab has been assigned one.
 *
 * Contract: docs/mobile-contract.md §4.8. Fixture family: `last-audio-request`.
 */

import { postNativeMessage, type NativeShellWindow } from "./native-post";

export interface NativeLastAudioRequest {
  version: 1;
  /** The pending server-side request this answers; the answer's URL segment. */
  requestId: string;
  /** The emission id whose recording is wanted; echoed back on the answer. */
  messageId: string;
  /** The relaying tab's chat session id, or null before assignment. */
  sessionId: string | null;
}

export function createNativeLastAudioRequest(opts: {
  requestId: string;
  messageId: string;
  sessionId: string | null;
}): NativeLastAudioRequest {
  return {
    version: 1,
    requestId: opts.requestId,
    messageId: opts.messageId,
    sessionId: opts.sessionId,
  };
}

/**
 * Strict parse of an inbound relay payload. Both ids are required and
 * non-blank: a request missing either cannot be answered (no URL to POST to,
 * or no id to echo for the server's echo-and-verify check), so it is rejected
 * here rather than sent onward to fail silently.
 */
export function nativeLastAudioRequestFromDetail(detail: unknown): NativeLastAudioRequest | null {
  if (
    typeof detail !== "object"
    || detail === null
    || Array.isArray(detail)
    || !("version" in detail)
    || detail.version !== 1
    || !("requestId" in detail)
    || typeof detail.requestId !== "string"
    || detail.requestId.trim() === ""
    || !("messageId" in detail)
    || typeof detail.messageId !== "string"
    || detail.messageId.trim() === ""
    || !("sessionId" in detail)
    || (detail.sessionId !== null && typeof detail.sessionId !== "string")
  ) {
    return null;
  }
  return createNativeLastAudioRequest({
    requestId: detail.requestId,
    messageId: detail.messageId,
    sessionId: detail.sessionId,
  });
}

export function postNativeLastAudioRequest(
  shell: NativeShellWindow,
  request: NativeLastAudioRequest,
): void {
  postNativeMessage(shell, { channel: "beeboxLastAudioRequest", payload: request });
}
