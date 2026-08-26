/**
 * Chat session **control** procedures — the ones that need the live per-box
 * `ChatSessionRegistry` / `ChatScheduleManager`, reached via the boxRoot-keyed
 * `getChatRuntime` accessor (see webapp/chat-runtime.ts). Spread into the chat
 * router so paths stay `trpc.chat.status` etc. Mirrors the former raw handlers
 * (previously `routes/chat-session-routes.ts`, now removed).
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { ownerProcedure, publicProcedure } from "../trpc.js";
import { getChatRuntime, type ChatRuntime } from "../../chat-runtime.js";
import { chatModelFileForSession, loadCurrentModelForEngine } from "../../../core/chat/session/state.js";
import { resolveChatEngine } from "../../../core/chat/session/engine.js";
import type { AgentEngine } from "../../../core/box/config.js";
import { chatModelForEngine, isChatModelAllowed } from "../../../shared/chat-models.js";
import { deleteChatSession, ChatSessionNotFoundError, SessionStorageContextMismatchError } from "../../../core/chat/session/delete.js";
import { sdkSessionIdSchema } from "../../../core/chat/session/session-id.js";
import { archiveChatSession } from "../../../core/chat/session/archive.js";
import { SessionDeletingError } from "../../../core/chat/session/registry.js";
import { LockHeldError } from "../../../core/chat/review/lock.js";
import { resolveSessionAvailability } from "../../../core/chat/session/availability.js";
import type { ReserveResult } from "../../../core/chat/session/reserve.js";
import { readLandmarkFeaturesForDir } from "../../../core/landmark/features.js";
import { mergeSeedFeatures } from "../../../core/chat/features.js";

function requireRuntime(boxRoot: string): ChatRuntime {
  const runtime = getChatRuntime(boxRoot);
  if (!runtime) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Chat runtime not initialized for this box",
    });
  }
  return runtime;
}

export interface ChatSessionStatus {
  sessionId: string | null;
  running: boolean;
  busy: boolean;
  model: string | null;
  engine: AgentEngine;
}

/**
 * A session's live status (running/busy/model), or the idle shape when there
 * is no session id or the id isn't live. Model comes from the persisted file
 * so an idle-evicted session still reports its pinned model. Shared by
 * `chat.status` and `chat.bootstrap`.
 */
export async function readSessionStatus(boxRoot: string, sessionId: string | null): Promise<ChatSessionStatus> {
  const { registry } = requireRuntime(boxRoot);
  const engine = await resolveChatEngine(boxRoot, sessionId);
  if (!sessionId) {
    return {
      sessionId: null,
      running: false,
      busy: false,
      model: null,
      engine,
    };
  }
  const target = registry.get(sessionId);
  if (!target) {
    return {
      sessionId,
      running: false,
      busy: false,
      model: loadCurrentModelForEngine(boxRoot, { modelFile: chatModelFileForSession(sessionId), engine }),
      engine,
    };
  }
  return {
    sessionId: target.getSessionId(),
    running: target.isRunning(),
    busy: target.isBusy(),
    model: chatModelForEngine(engine, target.getCurrentModel()),
    engine,
  };
}

export const chatControlProcedures = {
  deleteSession: ownerProcedure.input(z.object({ sessionId: sdkSessionIdSchema })).mutation(async ({ input, ctx }) => {
    const runtime = requireRuntime(ctx.boxRoot);
    try {
      return await deleteChatSession({
        boxRoot: ctx.boxRoot,
        sessionId: input.sessionId,
        runtime,
      });
    } catch (error) {
      if (error instanceof ChatSessionNotFoundError) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }
      if (error instanceof SessionStorageContextMismatchError) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "The chat card and local transcript index disagree. No files were deleted.",
        });
      }
      if (error instanceof SessionDeletingError || error instanceof LockHeldError) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Conversation cleanup is already in progress",
        });
      }
      console.error("chat-delete: mutation failed", {
        sessionId: input.sessionId,
        error,
      });
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Could not delete the conversation",
      });
    }
  }),

  /**
   * File a dead chat's card away under `store/chat/archive/`.
   *
   * Beside `deleteSession` because it is the same decision made differently:
   * one removes the conversation, the other only stops listing it. Nothing is
   * deleted here, so a failure is reported as an error rather than as a
   * cleanup-required state — there is no half-done to recover from.
   */
  archive: ownerProcedure.input(z.object({ sessionId: sdkSessionIdSchema })).mutation(async ({ input, ctx }) => {
    try {
      return await archiveChatSession({ boxRoot: ctx.boxRoot, sessionId: input.sessionId });
    } catch (error) {
      if (error instanceof LockHeldError) {
        throw new TRPCError({ code: "CONFLICT", message: "Chat review is running; try again in a moment" });
      }
      console.error("chat-archive: mutation failed", { sessionId: input.sessionId, error });
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not archive the conversation" });
    }
  }),

  sessionAvailability: publicProcedure.input(z.object({ sessionId: z.string().min(1) })).query(async ({ input, ctx }) => {
    const { registry } = requireRuntime(ctx.boxRoot);
    return resolveSessionAvailability({
      boxRoot: ctx.boxRoot,
      sessionId: input.sessionId,
      registry,
    });
  }),
  // Session status (running/busy/model).
  status: publicProcedure.input(z.object({ session: z.string().optional() })).query(({ input, ctx }) => readSessionStatus(ctx.boxRoot, input.session ?? null)),

  /**
   * Every live session's running/busy state at once — the box-wide idle signal
   * `status` cannot give (it reports on one id, and reports *idle* for an id it
   * has never heard of, so an outside process cannot tell "quiet" from
   * "unknown"). The field-test harness polls this for its quiescence gate
   * (`docs/plans/agent-field-tests.md`, Track 2) with the diagnostic key, which
   * is why it is on the diag whitelist in `webapp/auth.ts`.
   *
   * A box whose chat runtime was never initialized reports `initialized: false`
   * and no sessions rather than throwing: "there is no chat here" is a
   * legitimate idle answer to the only question this query is asked.
   */
  statusAll: publicProcedure.query(({ ctx }) => {
    const runtime = getChatRuntime(ctx.boxRoot);
    if (!runtime) return { initialized: false, busy: false, sessions: [] };
    const sessions = runtime.registry.snapshotAll();
    return { initialized: true, busy: sessions.some((s) => s.busy), sessions };
  }),

  // Change a session's active model. getOrCreate re-registers an evicted session
  // rather than 404'ing; the live subprocess is restarted so the next turn picks
  // up the new model (a live `set_model` control request isn't honored).
  setModel: publicProcedure.input(z.object({ session: z.string().min(1), model: z.string().nullable() })).mutation(async ({ input, ctx }) => {
    const engine = await resolveChatEngine(ctx.boxRoot, input.session);
    if (!isChatModelAllowed(engine, input.model)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Model ${input.model ?? "default"} is unavailable for ${engine} chats`,
      });
    }
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
    .input(
      z.object({
        session: z.string().min(1),
        feature: z.string().min(1),
        value: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { registry, wireSession } = requireRuntime(ctx.boxRoot);
      const target = registry.getOrCreate(input.session);
      wireSession(target);
      try {
        await target.setFeature(input.feature, input.value);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : String(e),
        });
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
  /**
   * Accept a client-coined chat id, so a brand-new chat is addressable before
   * its first message — capture, bulk upload, and a second quick send all name
   * the same chat instead of racing to create one
   * (`core/chat/session/reserve.ts`).
   *
   * A mutation, not part of `bootstrap`: `bootstrap` does not even run for a
   * new chat (the client skips it for `?session=new`), so there is no round
   * trip to fold this into, and a query with a side effect would be the worse
   * shape. Idempotent by id, so a retry or a StrictMode double-invoke reserves
   * the same chat.
   */
  reserveSession: publicProcedure
    .input(z.object({ sessionId: sdkSessionIdSchema, contextDir: z.string().optional() }))
    .mutation(async ({ input, ctx }): Promise<ReserveResult> => {
      const { registry } = requireRuntime(ctx.boxRoot);
      // `""` is kept, not collapsed to null: it is the box-root landmark, a
      // real binding that `chat.directoryFor` reports so the bar can name the
      // place. Only an absent param means "opened from nowhere".
      const contextDir = input.contextDir ?? null;
      // Landmark feature defaults are captured now because nothing else will:
      // they only ever ride a `"new"` send, and a coined chat never sends one.
      const landmark = contextDir !== null ? await readLandmarkFeaturesForDir(ctx.boxRoot, contextDir) : null;
      return registry.reserve({
        sessionId: input.sessionId,
        contextDir,
        seedFeatures: mergeSeedFeatures({ landmark, request: undefined }),
      });
    }),

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
