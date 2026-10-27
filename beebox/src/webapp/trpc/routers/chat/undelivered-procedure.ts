/**
 * `chat.discardUndelivered` — the person removes a message the box accepted
 * and then dropped before the agent received it (`docs/plans/chat-not-delivered.md`).
 *
 * Records a discard marker; the accepted row stays on the bus. Refused with
 * NOT_FOUND unless an undelivered marker exists for the message, so a discard
 * cannot hide a message the agent did receive (`core/chat/session/undelivered.ts`).
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure } from "../../procedures.js";
import { discardUndelivered } from "../../../../core/chat/session/undelivered.js";

export const chatUndeliveredProcedures = {
  discardUndelivered: publicProcedure
    .input(z.object({ sessionId: z.string().min(1).nullable(), messageId: z.string().min(1) }))
    .mutation(({ input, ctx }): { ok: true } => {
      const outcome = discardUndelivered(ctx.eventBus, { ...input, now: new Date() });
      if (outcome === "not-found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "This message is not marked as undelivered" });
      }
      return { ok: true };
    }),
};
