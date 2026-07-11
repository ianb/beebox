/**
 * Leaf helpers and request-body types shared across the chat route modules.
 *
 * These are pure (or `boxRoot`-only) utilities split out of `chat.ts` so the
 * route-registration functions stay small. They have no dependency on the
 * Fastify server, the session registry, or the event bus.
 */

import * as fs from "node:fs/promises";
import { z } from "zod";
import type { SessionUser } from "../auth.js";
import { resolveSessionLogPath } from "../../core/chat/session/history.js";
import { isActivityKind, type ActivityKind, type CardStateDetails } from "../../core/chat/card-activity.js";

// Structural shape only (id/mimeType/dataBase64 present with the right
// primitive types) — the content-level checks (mime prefix, total byte cap)
// stay in `validateImages` below, since they're business rules rather than
// parse-boundary shape.
const chatImageSchema = z.object({
  id: z.number(),
  mimeType: z.string(),
  dataBase64: z.string(),
});

/**
 * Track D.7: lightweight zod schemas at the chat-send routes' parse
 * boundary, replacing hand `if (!message)`-style checks and TS-generic-only
 * body interfaces. Response codes/shapes for invalid input are unchanged
 * (still a 400 with an `error` string) — the frontend (`api-chat.ts`) only
 * ever reads `response.ok` and the generic `error` field, never a specific
 * message string, so wording is free to change.
 */
export const sendBodySchema = z.object({
  message: z.string({ error: "message is required" }).min(1, "message is required"),
  messageId: z.string().optional(),
  /** Session id to send into. Use "new" to start a fresh conversation. */
  session: z
    .string({ error: "session is required (id or 'new')" })
    .min(1, "session is required (id or 'new')"),
  /**
   * Optional image attachments referenced by `[imageN]` tokens in `message`.
   * Tokens are replaced with the image block in the content array sent to
   * Claude; unreferenced images are appended at the end.
   */
  images: z.array(chatImageSchema).optional(),
  /**
   * Box-relative directory to bind a "new" chat to (landmark association).
   * Ignored when `session` is anything other than `"new"` — resumed sessions
   * read the binding from `chat-session-history` instead.
   */
  contextDir: z.string().optional(),
  /**
   * Chat-feature seeds chosen before the session existed (e.g. turning on
   * narration in a brand-new chat). Honored only when `session === "new"`,
   * merged over any landmark defaults, so the choice applies to the very
   * first turn. Unknown features / invalid values are dropped server-side.
   */
  seedFeatures: z.record(z.string(), z.string()).optional(),
  /**
   * Box-relative path of the card open in the companion pane when this
   * message was sent, surfaced to the agent as the `open-card` snapshot
   * attribute. Omitted when no card is open.
   */
  openCard: z.string().optional(),
  /**
   * What the user did to the companion-pane card since the agent's last
   * reply (`scrolled`/`navigated`/`explored`/`modified`), surfaced as the
   * `card-activity` snapshot attribute. Unrecognized kinds are dropped at
   * serialization. Omitted when empty.
   */
  cardActivity: z.array(z.string()).optional(),
  /**
   * Per-kind free-text detail for the activity (e.g. the embedding query
   * typed), surfaced as `<card-activity>` snapshot child element text. Keys are
   * activity kinds; non-kind keys and non-string values are dropped.
   */
  cardState: z.record(z.string(), z.unknown()).optional(),
});

export type SendBody = z.infer<typeof sendBodySchema>;

export const selfNoteBodySchema = z.object({
  body: z.string({ error: "body is required" }).refine((v) => v.trim().length > 0, "body is required"),
  ref: z.string().optional(),
  commit: z.string().optional(),
  session: z.string().optional(),
});

export type SelfNoteBody = z.infer<typeof selfNoteBodySchema>;

export const whatsChangedBodySchema = z.object({
  /** Target session id; defaults to the most-active session server-side. */
  session: z.string().optional(),
  /** Box-relative card path to scope the report to (the open companion card). */
  card: z.string().optional(),
});

export type WhatsChangedBody = z.infer<typeof whatsChangedBodySchema>;

/** Soft cap on total base64 image payload per request (25 MB). */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/**
 * Classify a request's User-Agent into the snapshot's `channel` value so
 * the agent can shape output for the device (mobile screens don't render
 * wide tables or long structured output well). Coarse on purpose —
 * phone/tablet vs. everything else; undefined when there's no UA to read.
 */
export function classifyChannel(userAgent: string | undefined): string | undefined {
  if (!userAgent) return undefined;
  return /mobi|android|iphone|ipad/i.test(userAgent) ? "web-mobile" : "web-desktop";
}

/**
 * Normalize the companion-pane fields off a send body into the shape
 * `ChatSendInput` wants: `openCard` (non-empty path), `cardActivity` (valid
 * kinds only), `cardState` (per-kind detail strings). Everything is filtered
 * defensively at this parse boundary; absent/invalid fields are simply omitted.
 */
export function extractCardFields(
  body: Pick<SendBody, "openCard" | "cardActivity" | "cardState">,
): { openCard?: string; cardActivity?: ActivityKind[]; cardState?: CardStateDetails } {
  const out: { openCard?: string; cardActivity?: ActivityKind[]; cardState?: CardStateDetails } = {};
  if (typeof body.openCard === "string" && body.openCard !== "") out.openCard = body.openCard;
  const kinds = Array.isArray(body.cardActivity) ? body.cardActivity.filter(isActivityKind) : [];
  if (kinds.length > 0) out.cardActivity = kinds;
  const details: CardStateDetails = {};
  if (typeof body.cardState === "object") {
    for (const [kind, detail] of Object.entries(body.cardState)) {
      if (isActivityKind(kind) && typeof detail === "string" && detail !== "") details[kind] = detail;
    }
  }
  if (Object.keys(details).length > 0) out.cardState = details;
  return out;
}

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
 * Validate inbound image attachments' content-level rules (mime prefix,
 * total byte cap) — structural shape (id/mimeType/dataBase64 present with
 * the right primitive types) is already guaranteed by `sendBodySchema`
 * before this runs. Returns an error message string when a problem is
 * found (so the caller can map it to a status code), or `null` when the
 * attachments are acceptable.
 */
export function validateImages(
  images: NonNullable<SendBody["images"]>,
): { error: string; status: number } | null {
  let totalBytes = 0;
  for (const img of images) {
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
