/**
 * Last-audio loopback: lets a box agent fetch the original recording of the
 * user's most recent voice message from a connected chat browser tab.
 *
 * POST /api/chat/last-audio/request    — long-poll from `cb chat get-last-audio`
 * POST /api/chat/last-audio/:requestId — a browser tab's answer: multipart
 *                                        audio upload, or JSON `{none:true}`
 *
 * Flow: the request route parks the CLI call in {@link createLastAudioPending}
 * and broadcasts a transient `chat-last-audio-request` bus event; every
 * connected chat tab answers (its cached recording, or "none"); the first
 * audio answer streams back as the long-poll's response body, with the
 * recording's metadata in `X-Recorded-At` / `X-Message-Text` headers.
 */

import {
  createLastAudioPending,
  type LastAudioFulfillment,
} from "../../core/last-audio-pending.js";
import type { ChatRoutesContext } from "./chat-context.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 30_000;
/** Cap on the text snippet header (pre-encoding) — headers must stay small. */
const MAX_TEXT_HEADER_CHARS = 300;

interface LastAudioRequestBody {
  /** How long to wait for a browser answer. Clamped to [100, 30000]. */
  timeoutMs?: number;
  /** Caller-chosen request id — for tests and debugging correlation. */
  requestId?: string;
}

interface LastAudioAnswerBody {
  none?: boolean;
}

function multipartField(
  fields: Record<string, unknown>,
  name: string
): string | null {
  const field = fields[name];
  if (field !== null && typeof field === "object" && "value" in field && typeof field.value === "string") {
    return field.value;
  }
  return null;
}

export function registerChatLastAudioRoutes(ctx: ChatRoutesContext): void {
  const { server, eventBus } = ctx;
  const pendingRequests = createLastAudioPending();

  server.post<{ Body: LastAudioRequestBody | null }>(
    "/api/chat/last-audio/request",
    async (request, reply) => {
      const body = request.body ?? {};
      const requestedTimeout = typeof body.timeoutMs === "number" ? body.timeoutMs : DEFAULT_TIMEOUT_MS;
      const timeoutMs = Math.min(Math.max(requestedTimeout, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
      const requestIdOverride = typeof body.requestId === "string" && body.requestId.length > 0 && body.requestId.length <= 80
        ? body.requestId
        : undefined;
      const { requestId, outcome } = pendingRequests.create({ timeoutMs, requestId: requestIdOverride });
      eventBus.emitTransient("chat-last-audio-request", { requestId });

      const result = await outcome;
      if (result.status === "timeout") {
        return reply.status(504).send({
          error: "no-client",
          message: "No chat tab answered — the chat may not be open in a browser right now.",
        });
      }
      if (result.status === "none") {
        return reply.status(404).send({
          error: "no-audio",
          message: "No recording is cached for the last message — it was typed, or recorded before the chat tab was last loaded.",
        });
      }
      const { audio, contentType, recordedAt, text } = result.fulfillment;
      reply.header("Content-Type", contentType);
      if (recordedAt !== null) reply.header("X-Recorded-At", recordedAt);
      if (text !== null) {
        reply.header("X-Message-Text", encodeURIComponent(text.slice(0, MAX_TEXT_HEADER_CHARS)));
      }
      return reply.send(audio);
    }
  );

  server.post<{ Params: { requestId: string }; Body: LastAudioAnswerBody | null }>(
    "/api/chat/last-audio/:requestId",
    async (request, reply) => {
      const { requestId } = request.params;

      if (request.isMultipart()) {
        const data = await request.file();
        if (!data) return reply.status(400).send({ error: "No audio uploaded" });
        const audio = await data.toBuffer();
        const fulfillment: LastAudioFulfillment = {
          audio,
          contentType: data.mimetype || "application/octet-stream",
          recordedAt: multipartField(data.fields, "recordedAt"),
          text: multipartField(data.fields, "text"),
        };
        if (!pendingRequests.fulfill(requestId, fulfillment)) {
          // Expected in multi-tab use: another tab's audio already won.
          return reply.status(404).send({ error: "unknown-request" });
        }
        return { ok: true };
      }

      const body = request.body ?? {};
      if (body.none !== true) {
        return reply.status(400).send({ error: "bad-answer", message: "Expected multipart audio or {\"none\": true}" });
      }
      if (!pendingRequests.reportNone(requestId)) {
        return reply.status(404).send({ error: "unknown-request" });
      }
      return { ok: true };
    }
  );
}
