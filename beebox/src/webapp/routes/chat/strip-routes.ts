/**
 * POST /api/chat/strip — set or clear a conversation's strip
 * (`docs/plans/conversation-strip.md`), called by `bbx chat strip`.
 *
 * Body `{ session, card }`. `card: null` clears the strip. Otherwise the card
 * must resolve and be of a strip-capable type (`resolveStripCard`). The
 * session's feature change reaches the open page through `wireSession`, which
 * bridges `features-changed` onto the event bus.
 *
 * Auth is the agent loopback bearer, as for `/api/chat/ui/request`: the
 * command is agent-initiated, so a user session gets 403. The person closes the
 * strip through the ordinary `setFeature` control, not this route.
 */

import { z } from "zod";
import { verifyAgentBearer } from "../../../core/agent/token.js";
import { resolveStripCard, stripRefusalMessage } from "../../../core/chat/strip.js";
import { errorMessage } from "../../../shared/error-guards.js";
import { STRIP_NONE } from "../../../shared/strip-types.js";
import { listViews } from "../../views/compiler/compile.js";
import type { ChatRoutesContext } from "./context.js";

const bodySchema = z
  .object({
    session: z.string().min(1),
    card: z.string().min(1).nullable(),
  })
  .strict();

export function registerChatStripRoutes(ctx: ChatRoutesContext): void {
  const { server, boxRoot, registry, wireSession } = ctx;

  server.post<{ Body: unknown }>("/api/chat/strip", async (request, reply) => {
    if (!verifyAgentBearer(boxRoot, request.headers["authorization"])) {
      return reply.status(403).send({
        error: "forbidden",
        message: "Strip changes are agent-initiated (loopback bearer required)",
      });
    }
    const parsed = bodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: "bad-request",
        message: "Expected { session: string, card: string | null }",
      });
    }
    const { session, card } = parsed.data;

    const target = registry.get(session);
    if (target === null) {
      return reply.status(404).send({ error: "no-session", message: `session "${session}" is not live` });
    }

    let value = STRIP_NONE;
    if (card !== null) {
      const resolved = await resolveStripCard(boxRoot, { ref: card, metas: await listViews(boxRoot) });
      if (!resolved.ok) {
        return reply.status(422).send({
          error: resolved.error.refusal,
          message: stripRefusalMessage(card, resolved.error),
        });
      }
      value = resolved.value.path;
    }

    wireSession(target);
    try {
      await target.setFeature("strip", value);
    } catch (e) {
      return reply.status(400).send({ error: "bad-request", message: errorMessage(e) });
    }
    return reply.status(200).send({ strip: value });
  });
}
