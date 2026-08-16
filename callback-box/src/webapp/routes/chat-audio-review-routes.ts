/**
 * CLI report-back for the audio commands (retranscription-in-chat plan,
 * Track 2): `cb chat retranscribe` and `cb chat ask-about-audio` POST here
 * after a successful HQ pass / analysis so a connected chat tab can overlay
 * the result on the original message.
 *
 * POST /api/chat/audio-review — zod body discriminated on `kind`, emits the
 * matching transient bus event and replies `{ok:true}`. Mutates nothing else.
 *
 * Auth: same box-scope wall as the rest of `/api` (`server-box-scope.ts`),
 * which already recognizes the per-box agent bearer the CLI's
 * `loopbackHeaders()` sends (`verifyAgentBearer`, checked ahead of the
 * ordinary session check) — same posture as `chat-last-audio-routes.ts`, no
 * extra guard needed here.
 *
 * Delivery is best-effort: `emitTransient` notifies only currently-connected
 * subscribers, with no ack. A successful `{ok:true}` means the event was
 * emitted, not that any tab saw it — a tab that disconnected between
 * fulfilling the audio request and this report simply misses the indicator
 * (acceptable for a visual-only feature; see the plan's failure-modes table).
 */

import { z } from "zod";
import { assertNever } from "../../lib/invariant.js";
import type { ChatRoutesContext } from "./chat-context.js";

const retranscriptionBodySchema = z.object({
  kind: z.literal("retranscription"),
  sessionId: z.string().min(1),
  messageId: z.string().min(1),
  newText: z.string().min(1),
  service: z.string().optional(),
  diarized: z.boolean(),
  recordedAt: z.string().optional(),
});

const consultedBodySchema = z.object({
  kind: z.literal("consulted"),
  sessionId: z.string().min(1),
  messageId: z.string().min(1),
  command: z.literal("ask-about-audio"),
});

const audioReviewBodySchema = z.discriminatedUnion("kind", [
  retranscriptionBodySchema,
  consultedBodySchema,
]);

export function registerChatAudioReviewRoutes(ctx: ChatRoutesContext): void {
  const { server, eventBus } = ctx;

  server.post<{ Body: unknown }>("/api/chat/audio-review", (request, reply) => {
    const parsed = audioReviewBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: "bad-request",
        message: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
    }

    const body = parsed.data;
    switch (body.kind) {
      case "retranscription": {
        const { sessionId, messageId, newText, service, diarized, recordedAt } = body;
        eventBus.emitTransient("chat-retranscription", {
          sessionId,
          messageId,
          newText,
          service,
          diarized,
          recordedAt,
        });
        break;
      }
      case "consulted": {
        const { sessionId, messageId, command } = body;
        eventBus.emitTransient("chat-audio-consulted", { sessionId, messageId, command });
        break;
      }
      default:
        assertNever(body);
    }

    return reply.send({ ok: true });
  });
}
