/**
 * Shared plumbing for `cb chat`'s audio-fetching commands (`get-last-audio`,
 * `ask-about-audio`, `retranscribe`): the loopback long-poll to the connected
 * browser tab, and the `--message <id>` validation every fetch requires.
 *
 * Split out of chat-audio.ts (which holds the three Commander command
 * definitions) to keep that file under the line-count limit.
 */

import * as path from "node:path";
import { resolveAgentToken } from "../../core/agent/token.js";

/**
 * Request headers for loopback calls to the live server: JSON content type
 * plus the per-box agent bearer when available (required to pass the auth
 * wall in production; harmless when auth is disabled in dev).
 */
export function loopbackHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = resolveAgentToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

/** File extension for the audio Content-Type the browser sent. */
export function audioExtension(contentType: string): string {
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("webm")) return "webm";
  if (contentType.includes("ogg")) return "ogg";
  if (contentType.includes("mpeg")) return "mp3";
  if (contentType.includes("mp4")) return "m4a";
  return "bin";
}

/** Audio MIME type for a file path's extension, or null when unrecognized. */
export function audioMimeType(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    ".wav": "audio/wav",
    ".webm": "audio/webm",
    ".ogg": "audio/ogg",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".flac": "audio/flac",
    ".aac": "audio/aac",
  };
  return types[ext] ?? null;
}

export interface LastAudioFetch {
  audio: Buffer;
  contentType: string;
  recordedAt: string | null;
  /** Transcript snippet of the message the recording belongs to. */
  text: string | null;
  /**
   * The emission id the recording is retained under, or null when the
   * answering tab didn't send one (old tab, or no session context yet).
   * Not surfaced to stdout yet.
   */
  messageId: string | null;
  /** The answering tab's chat session id, or null under the same conditions. */
  sessionId: string | null;
}

/**
 * The error text for a missing `--message` when one is required — exported
 * so it stays unit-testable without invoking a Commander action (which would
 * `process.exit` the test process). Written for an agent reader: names the
 * flag, and where to find the id.
 */
export function missingMessageIdError(commandLabel: string): string {
  return `${commandLabel}: requires --message <id> — read message-id="…" off the <speech> wrapper of the message you mean`;
}

/**
 * Validate `--message` when it's required (fetching rather than `--file`),
 * printing {@link missingMessageIdError} and exiting the process when it's
 * missing/blank. Centralized so each command's action stays a single call
 * instead of repeating the same branch.
 */
export function requireMessageId(commandLabel: string, message: string | undefined): string {
  if (message === undefined || message.trim() === "") {
    console.error(missingMessageIdError(commandLabel));
    process.exit(1);
  }
  return message;
}

/**
 * Long-poll the server for a specific voice message's recording, keyed by
 * its emission id (retranscription-in-chat plan, Track 1b — every fetch is
 * targeted; there is no untargeted "latest" mode, since that's how an agent
 * could end up transcribing the wrong recording). Prints a user-facing error
 * and exits the process on any failure — callers only see the success path.
 */
export async function fetchLastAudio(opts: {
  commandLabel: string;
  timeoutSeconds: number;
  messageId: string;
}): Promise<LastAudioFetch> {
  const { commandLabel, timeoutSeconds, messageId } = opts;
  const serverUrl = process.env.CB_SERVER_URL;
  const boxName = process.env.CB_BOX_NAME;
  if (!serverUrl || !boxName) {
    console.error(`${commandLabel}: CB_SERVER_URL and CB_BOX_NAME must be set`);
    process.exit(1);
  }
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    console.error(`${commandLabel}: invalid --timeout ${timeoutSeconds}`);
    process.exit(1);
  }

  const url = `${serverUrl.replace(/\/+$/, "")}/${boxName}/api/chat/last-audio/request`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: loopbackHeaders(),
      body: JSON.stringify({ timeoutMs: Math.round(timeoutSeconds * 1000), messageId }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${commandLabel}: request failed: ${msg}`);
    process.exit(1);
  }

  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed !== null && typeof parsed === "object" && "message" in parsed && typeof parsed.message === "string") {
        message = parsed.message;
      }
    } catch (_e) {
      // Not JSON — report the raw body.
    }
    console.error(`${commandLabel}: ${message} (HTTP ${res.status})`);
    process.exit(1);
  }

  const encodedText = res.headers.get("x-message-text");
  const encodedMessageId = res.headers.get("x-message-id");
  const encodedSessionId = res.headers.get("x-session-id");
  return {
    audio: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") ?? "",
    recordedAt: res.headers.get("x-recorded-at"),
    text: encodedText !== null ? decodeURIComponent(encodedText) : null,
    messageId: encodedMessageId !== null ? decodeURIComponent(encodedMessageId) : null,
    sessionId: encodedSessionId !== null ? decodeURIComponent(encodedSessionId) : null,
  };
}
