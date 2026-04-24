/**
 * tRPC router for activities — list types, list instances, create instances.
 *
 * Thin wrapper over the registry + Activity base class methods. Shares
 * the same core logic as the `cb activity` CLI.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc.js";
import {
  ActivityInstanceExistsError,
  UnknownActivityTypeError,
  UnknownModeError,
  getAvailableModes,
  pickDefaultMode,
  type AvailableMode,
} from "../../../activities/index.js";
import type { InstanceSummary } from "../../../activities/index.js";
import { listActivityTypes, type ActivityTypeInfo } from "../../../cli/commands/activity.js";

export const activitiesRouter = router({
  listTypes: publicProcedure.query(({ ctx }): ActivityTypeInfo[] => {
    return listActivityTypes(ctx.activityRegistry);
  }),

  listInstances: publicProcedure
    .input(z.object({ type: z.string() }))
    .query(async ({ ctx, input }): Promise<InstanceSummary[]> => {
      const activity = ctx.activityRegistry.get(input.type);
      if (activity === undefined) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Unknown activity type: ${input.type}` });
      }
      return activity.listInstances({ boxRoot: ctx.boxRoot });
    }),

  create: publicProcedure
    .input(
      z.object({
        type: z.string(),
        name: z
          .string()
          .min(1)
          .regex(/^[\da-z][\w-]*$/i, "name must be alphanumeric with -/_"),
        displayName: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<InstanceSummary> => {
      const activity = ctx.activityRegistry.get(input.type);
      if (activity === undefined) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Unknown activity type: ${input.type}` });
      }
      try {
        await activity.createInstance({
          boxRoot: ctx.boxRoot,
          name: input.name,
          displayName: input.displayName,
        });
      } catch (e) {
        if (e instanceof ActivityInstanceExistsError) {
          throw new TRPCError({ code: "CONFLICT", message: e.message });
        }
        if (e instanceof UnknownActivityTypeError) {
          throw new TRPCError({ code: "NOT_FOUND", message: e.message });
        }
        throw e;
      }
      // Read back the summary the same way listInstances would
      const summaries = await activity.listInstances({ boxRoot: ctx.boxRoot });
      const found = summaries.find((s) => s.name === input.name);
      if (found === undefined) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Instance ${input.type}/${input.name} missing after create`,
        });
      }
      return found;
    }),

  /**
   * Resolve the list of available modes for an instance plus the default
   * mode the UI should enter. Returns NOT_FOUND if the activity type or
   * instance doesn't exist.
   */
  getModes: publicProcedure
    .input(z.object({ type: z.string(), instance: z.string() }))
    .query(
      async ({ ctx, input }): Promise<{ modes: AvailableMode[]; defaultMode: string | null }> => {
        const activity = ctx.activityRegistry.get(input.type);
        if (activity === undefined) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Unknown activity type: ${input.type}`,
          });
        }
        const inst = activity.getInstance(activity.instanceRoot(ctx.boxRoot, input.instance));
        const [modes, defaultMode] = await Promise.all([
          getAvailableModes(activity, inst),
          pickDefaultMode(activity, inst),
        ]);
        return { modes, defaultMode };
      },
    ),

  /**
   * Fetch the chat transcript for `(type, instance, mode)`. Returns an
   * empty history if the session has never produced a session id yet.
   */
  getHistory: publicProcedure
    .input(z.object({ type: z.string(), instance: z.string(), mode: z.string() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.activityChatPool
        .getOrCreate({
          boxRoot: ctx.boxRoot,
          activityType: input.type,
          instanceName: input.instance,
          modeName: input.mode,
        })
        .catch((e: unknown) => {
          if (e instanceof UnknownActivityTypeError) {
            throw new TRPCError({ code: "NOT_FOUND", message: e.message });
          }
          if (e instanceof UnknownModeError) {
            throw new TRPCError({ code: "NOT_FOUND", message: e.message });
          }
          throw e;
        });
      return session.getHistory();
    }),

  /**
   * Status of the subprocess/session for `(type, instance, mode)`.
   */
  getStatus: publicProcedure
    .input(z.object({ type: z.string(), instance: z.string(), mode: z.string() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.activityChatPool
        .getOrCreate({
          boxRoot: ctx.boxRoot,
          activityType: input.type,
          instanceName: input.instance,
          modeName: input.mode,
        })
        .catch((e: unknown) => {
          if (e instanceof UnknownActivityTypeError) {
            throw new TRPCError({ code: "NOT_FOUND", message: e.message });
          }
          if (e instanceof UnknownModeError) {
            throw new TRPCError({ code: "NOT_FOUND", message: e.message });
          }
          throw e;
        });
      return {
        sessionId: session.getSessionId(),
        running: session.isRunning(),
        busy: session.isBusy(),
      };
    }),

  /**
   * Send a user message into the activity chat session for
   * `(type, instance, mode)`. Accepts immediately and returns the
   * session id (if one has been assigned); assistant output streams
   * via the event bus / SSE endpoint.
   */
  send: publicProcedure
    .input(
      z.object({
        type: z.string(),
        instance: z.string(),
        mode: z.string(),
        text: z.string().min(1),
      }),
    )
    .mutation(
      async ({ ctx, input }): Promise<{ accepted: boolean; sessionId: string | null }> => {
        const session = await ctx.activityChatPool
          .getOrCreate({
            boxRoot: ctx.boxRoot,
            activityType: input.type,
            instanceName: input.instance,
            modeName: input.mode,
          })
          .catch((e: unknown) => {
            if (e instanceof UnknownActivityTypeError) {
              throw new TRPCError({ code: "NOT_FOUND", message: e.message });
            }
            if (e instanceof UnknownModeError) {
              throw new TRPCError({ code: "NOT_FOUND", message: e.message });
            }
            throw e;
          });
        const accepted = await session.send(input.text);
        return { accepted, sessionId: session.getSessionId() };
      },
    ),

  /**
   * Reset the chat session for `(type, instance, mode)` — stops the
   * subprocess, clears the saved session id, removes the pool entry.
   * The next `send` starts a fresh conversation.
   */
  resetSession: publicProcedure
    .input(z.object({ type: z.string(), instance: z.string(), mode: z.string() }))
    .mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
      const key = {
        boxRoot: ctx.boxRoot,
        activityType: input.type,
        instanceName: input.instance,
        modeName: input.mode,
      };
      const session = ctx.activityChatPool.get(key);
      if (session !== null) session.resetSession();
      ctx.activityChatPool.close(key);
      return { ok: true };
    }),
});
