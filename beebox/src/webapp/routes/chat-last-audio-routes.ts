/**
 * Last-audio loopback: lets a box agent fetch the original recording of a
 * SPECIFIC voice message (by emission id) from a connected chat browser tab.
 *
 * POST /api/chat/last-audio/request    — long-poll from `bbx chat get-last-audio`
 * POST /api/chat/last-audio/:requestId — a browser tab's answer: multipart
 *                                        audio upload, or JSON `{none:true}`
 *
 * Flow: the request route parks the CLI call in {@link createLastAudioPending}
 * with the requested `messageId` and broadcasts a transient
 * `chat-last-audio-request` bus event carrying it; every connected chat tab
 * answers (its recording retained under that exact emission id, or "none");
 * a matching audio answer streams back as the long-poll's response body, with
 * the recording's metadata in `X-Recorded-At` / `X-Message-Text` /
 * `X-Message-Id` / `X-Session-Id` headers.
 *
 * **Echo-and-verify** (retranscription-in-chat plan, Track 1b — load-bearing):
 * a fulfillment must echo the requested `messageId` back as a multipart
 * field. An answer whose echoed id is absent or doesn't match is IGNORED —
 * it neither wins nor errors the request, which keeps waiting for a correct
 * answer or times out to "not available". This is the only thing standing
 * between a targeted request and a stale pre-1b tab handing back whatever it
 * last retained with no identity attached — the untargeted-latest-wins
 * defect this track exists to close (see the plan for the cross-user-leak
 * detail).
 */

import { z } from "zod";
import {
  createLastAudioPending,
  type LastAudioFulfillment,
} from "../../core/last-audio-pending.js";
import { assertNever } from "../../lib/invariant.js";
import type { ChatRoutesContext } from "./chat-context.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 30_000;
/**
 * Cap on the transcript header (pre-encoding). Generous because
 * `ask-about-audio` feeds it to the audio model for flaw-detection on long
 * dictations; even fully percent-encoded it stays well under Node's 16KB
 * total-header limit.
 */
const MAX_TEXT_HEADER_CHARS = 1500;

/**
 * `messageId` is required — every request targets an exact emission id
 * (Track 1b removed the untargeted "latest" mode entirely).
 */
const lastAudioRequestBodySchema = z.object({
  /** How long to wait for a browser answer. Clamped to [100, 30000]. */
  timeoutMs: z.number().optional(),
  messageId: z.string().min(1),
});

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

  server.post<{ Body: unknown }>(
    "/api/chat/last-audio/request",
    async (request, reply) => {
      const parsed = lastAudioRequestBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: "bad-request",
          message: `messageId is required — ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        });
      }
      const { messageId, timeoutMs: requestedTimeout } = parsed.data;
      const timeoutMs = Math.min(Math.max(requestedTimeout ?? DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
      const { requestId, outcome } = pendingRequests.create({ timeoutMs, messageId });
      eventBus.emitTransient("chat-last-audio-request", { requestId, messageId });

      const result = await outcome;
      if (result.status === "timeout") {
        return reply.status(504).send({
          error: "no-client",
          message:
            "No chat tab answered — the chat may not be open in a browser right now. This is a transient condition, not a missing capability: the same request can succeed later once a tab is connected.",
        });
      }
      if (result.status === "none") {
        // Phrased per-MESSAGE, and explicitly forward-looking. An agent that
        // reads a bare "no recording" as "audio retranscription doesn't work
        // here" stops trying for the rest of the conversation — and the most
        // likely message to fail is the FIRST one, so one early miss would
        // teach it to give up on every later message that would have worked.
        return reply.status(404).send({
          error: "no-audio",
          message:
            "No recording is cached for this message — it was typed, or its audio predates the chat tab's current load. This is about this one message, not the box: other messages in this conversation may still have audio, so try again on a later one rather than giving up.",
        });
      }
      const { audio, contentType, recordedAt, text, messageId: answeredMessageId, sessionId } = result.fulfillment;
      reply.header("Content-Type", contentType);
      if (recordedAt !== null) reply.header("X-Recorded-At", recordedAt);
      if (text !== null) {
        reply.header("X-Message-Text", encodeURIComponent(text.slice(0, MAX_TEXT_HEADER_CHARS)));
      }
      // A delivered fulfillment's messageId always matches the request's
      // target (echo-and-verify) — non-null by construction, but the field
      // is still nullable on the shared type, so guard rather than assert.
      if (answeredMessageId !== null) reply.header("X-Message-Id", encodeURIComponent(answeredMessageId));
      if (sessionId !== null) reply.header("X-Session-Id", encodeURIComponent(sessionId));
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
          messageId: multipartField(data.fields, "messageId"),
          sessionId: multipartField(data.fields, "sessionId"),
        };
        const outcome = pendingRequests.fulfill(requestId, fulfillment);
        switch (outcome) {
          case "delivered":
            return { ok: true };
          case "ignored":
            // Echo-and-verify: the echoed messageId was absent or didn't
            // match the request's target. Not an error for the answering
            // tab — it just isn't the tab that holds the requested
            // recording — and the pending request is untouched, still
            // waiting for a correct answer or a timeout.
            return reply.status(200).send({
              ok: false,
              ignored: true,
              message: "messageId did not match the pending request's target",
            });
          case "unknown":
            // Expected in multi-tab use: another tab's audio already won,
            // or the request id is unrecognized.
            return reply.status(404).send({ error: "unknown-request" });
          default:
            return assertNever(outcome);
        }
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
