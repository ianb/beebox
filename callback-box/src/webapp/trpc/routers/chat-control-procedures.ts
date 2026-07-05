/**
 * Chat session **control** procedures — the ones that need the live per-box
 * `ChatSessionRegistry` / `ChatScheduleManager`, reached via the boxRoot-keyed
 * `getChatRuntime` accessor (see webapp/chat-runtime.ts). Spread into the chat
 * router so paths stay `trpc.chat.status` etc. Mirrors the former raw handlers
 * (previously `routes/chat-session-routes.ts`, now removed).
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure } from "../trpc.js";
import { getChatRuntime, type ChatRuntime } from "../../chat-runtime.js";
import { loadPersistedChatModel } from "../../../core/chat-session-state.js";

function requireRuntime(boxRoot: string): ChatRuntime {
  const runtime = getChatRuntime(boxRoot);
  if (!runtime) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Chat runtime not initialized for this box" });
  }
  return runtime;
}

export const chatControlProcedures = {
  // Session status (running/busy/model). Model comes from the persisted file so
  // an idle-evicted session still reports its pinned model.
  status: publicProcedure.input(z.object({ session: z.string().optional() })).query(({ input, ctx }) => {
    const { registry } = requireRuntime(ctx.boxRoot);
    const persistedModel = loadPersistedChatModel(ctx.boxRoot);
    const sessionId = input.session;
    if (!sessionId) {
      return { sessionId: null as string | null, running: false, busy: false, model: persistedModel };
    }
    const target = registry.get(sessionId);
    if (!target) {
      return { sessionId: sessionId as string | null, running: false, busy: false, model: persistedModel };
    }
    return {
      sessionId: target.getSessionId() as string | null,
      running: target.isRunning(),
      busy: target.isBusy(),
      model: target.getCurrentModel(),
    };
  }),

  // Change a session's active model. getOrCreate re-registers an evicted session
  // rather than 404'ing; the live subprocess is restarted so the next turn picks
  // up the new model (a live `set_model` control request isn't honored).
  setModel: publicProcedure
    .input(z.object({ session: z.string().min(1), model: z.string().nullable() }))
    .mutation(({ input, ctx }) => {
      const { registry, wireSession } = requireRuntime(ctx.boxRoot);
      const target = registry.getOrCreate(input.session);
      wireSession(target);
      target.setModel(input.model);
      let restarted = false;
      if (target.isRunning()) {
        if (target.isBusy()) {
          // Mid-turn — defer restart to the turn's end so the response isn't lost.
          target.once("done", () => {
            if (target.isRunning()) target.restart();
          });
        } else {
          target.restart();
          restarted = true;
        }
      }
      return { ok: true, model: target.getCurrentModel(), restarted };
    }),

  // Read a session's feature map (validated + resolved) and change a flag.
  setFeature: publicProcedure
    .input(z.object({ session: z.string().min(1), feature: z.string().min(1), value: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { registry, wireSession } = requireRuntime(ctx.boxRoot);
      const target = registry.getOrCreate(input.session);
      wireSession(target);
      try {
        await target.setFeature(input.feature, input.value);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : String(e) });
      }
      // wireSession bridges the session's features-changed event onto the bus,
      // so the broadcast already fired; no restart needed (per-turn snapshot).
      return { ok: true, features: target.getFeatures() };
    }),

  // Interrupt the in-flight turn for a live session.
  interrupt: publicProcedure.input(z.object({ session: z.string().min(1) })).mutation(({ input, ctx }) => {
    const { registry } = requireRuntime(ctx.boxRoot);
    const target = registry.get(input.session);
    if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "session not live" });
    target.interrupt();
    return { ok: true };
  }),

  // Kill the subprocess (preserving session id + queue).
  restart: publicProcedure.input(z.object({ session: z.string().min(1) })).mutation(({ input, ctx }) => {
    const { registry } = requireRuntime(ctx.boxRoot);
    const target = registry.get(input.session);
    if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "session not live" });
    target.restart();
    return { ok: true };
  }),

  // List active schedules (single per-box manager).
  schedules: publicProcedure.query(({ ctx }) => {
    const { scheduleManager } = requireRuntime(ctx.boxRoot);
    return { schedules: scheduleManager.getActive() };
  }),

  // Cancel a schedule by label.
  cancelSchedule: publicProcedure.input(z.object({ label: z.string() })).mutation(({ input, ctx }) => {
    const { scheduleManager } = requireRuntime(ctx.boxRoot);
    return { ok: scheduleManager.cancelByLabel(input.label) };
  }),
};
