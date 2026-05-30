/**
 * Leaf helpers and request-body types shared across the chat route modules.
 *
 * These are pure (or `boxRoot`-only) utilities split out of `chat.ts` so the
 * route-registration functions stay small. They have no dependency on the
 * Fastify server, the session registry, or the event bus.
 */

import * as fs from "node:fs/promises";
import type { ChatImage } from "../../core/chat-session.js";
import type { SessionUser } from "../auth.js";
import { resolveSessionLogPath } from "../../core/chat-session-history.js";

export interface SendBody {
  message: string;
  messageId?: string;
  /** Session id to send into. Use "new" to start a fresh conversation. */
  session: string;
  /**
   * Optional image attachments referenced by `[imageN]` tokens in `message`.
   * Tokens are replaced with the image block in the content array sent to
   * Claude; unreferenced images are appended at the end.
   */
  images?: ChatImage[];
  /**
   * Box-relative directory to bind a "new" chat to (landmark association).
   * Ignored when `session` is anything other than `"new"` — resumed sessions
   * read the binding from `chat-session-history` instead.
   */
  contextDir?: string;
}

export interface SelfNoteBody {
  body: string;
  ref?: string;
  commit?: string;
  session?: string;
}

/** Soft cap on total base64 image payload per request (25 MB). */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export function escapeXmlAttr(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Inject user="Name" into the opening <typed> or <speech> tag of a message.
 */
export function injectUserAttr(message: string, user: SessionUser): string {
  return message.replace(
    /^(<(?:typed|speech)\b)([^>]*>)/,
    `$1 user="${user.name.replace(/"/g, "&quot;")}" user-email="${user.email.replace(/"/g, "&quot;")}"$2`
  );
}

/**
 * Validate inbound image attachments. Returns an error message string when a
 * problem is found (so the caller can map it to a status code), or `null` when
 * the attachments are acceptable.
 */
export function validateImages(
  images: ChatImage[],
): { error: string; status: number } | null {
  let totalBytes = 0;
  for (const img of images) {
    if (typeof img.id !== "number" || !img.mimeType || !img.dataBase64) {
      return {
        error: "invalid image attachment (id, mimeType, dataBase64 required)",
        status: 400,
      };
    }
    if (!img.mimeType.startsWith("image/")) {
      return { error: `unsupported mime type: ${img.mimeType}`, status: 400 };
    }
    totalBytes += img.dataBase64.length;
    if (totalBytes > MAX_IMAGE_BYTES) {
      return { error: "image attachments exceed 25 MB total", status: 413 };
    }
  }
  return null;
}

/**
 * Read the tail of a session's JSONL log as raw text. Used to scan for
 * the most recent speaker-letter tag in a diarized transcription
 * relabel. Cap at 128KB — `Speaker N<L>` patterns are dense in any
 * recent diarized message, so we don't need full history. Returns ""
 * when the log doesn't exist yet or any read step fails.
 */
const LOG_TAIL_BYTES = 128 * 1024;
export async function readSessionLogTail(
  boxRoot: string,
  sessionId: string,
): Promise<string> {
  try {
    const logPath = await resolveSessionLogPath(boxRoot, sessionId);
    const handle = await fs.open(logPath, "r");
    try {
      const stat = await handle.stat();
      const start = Math.max(0, stat.size - LOG_TAIL_BYTES);
      const length = stat.size - start;
      const buf = Buffer.alloc(length);
      await handle.read(buf, 0, length, start);
      return buf.toString("utf8");
    } finally {
      await handle.close();
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[chat] failed to read session log tail, starting speaker letters at A:", e);
    }
    return "";
  }
}
