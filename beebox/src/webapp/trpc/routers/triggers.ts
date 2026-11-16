/**
 * tRPC router for activity triggers: `list` is what the chat column's status
 * line shows ("Watching: Water check"), one session's activations with
 * expiry applied at read. Refetched on `trigger-changed`.
 */

import { z } from "zod";
import { listActivations } from "../../../core/triggers/activation.js";
import { SESSION_ID_RE } from "../chat-room.js";
import { authedProcedure, router } from "../procedures.js";

export interface TriggerStatus {
  id: string;
  label: string;
  state: "armed" | "failed" | "done" | "expired" | "disarmed" | "delivery-failed";
  error: string | null;
  tick: number | null;
  lastEvalAt: string | null;
}

export const triggersRouter = router({
  list: authedProcedure
    .input(z.object({ session: z.string().regex(SESSION_ID_RE) }))
    .query(async ({ input, ctx }): Promise<TriggerStatus[]> => {
      const activations = await listActivations({ boxRoot: ctx.boxRoot, sessionId: input.session });
      return activations.map((a) => ({ id: a.id, label: a.label, state: a.state, error: a.error ?? null, tick: a.tick ?? null, lastEvalAt: a.lastEvalAt ?? null }));
    }),
});
