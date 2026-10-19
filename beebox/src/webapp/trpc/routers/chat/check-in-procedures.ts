/**
 * A chat's check-ins, set and cancelled by `bbx remind --here` from inside
 * that chat's turn. The timers live in this server process
 * (`ChatScheduleManager`), so the agent's shell reaches them here, and an
 * error comes back while the agent can still tell the user.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure } from "../../procedures.js";
import { getChatRuntime, type ChatRuntime } from "../../../chat-runtime.js";
import { resolveSessionAvailability } from "../../../../core/chat/session/availability.js";
import { parseDuration } from "../../../../scheduled-script-duration.js";
import { CheckInNotSavedError, CheckInTooLongError, ScheduleForDeletingSessionError } from "../../../../core/chat/schedules/core.js";
import { errorMessage } from "../../../../shared/error-guards.js";

function chatRuntime(boxRoot: string): ChatRuntime {
  const runtime = getChatRuntime(boxRoot);
  if (!runtime) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Chat runtime not initialized for this box" });
  return runtime;
}

function durationMs(text: string): number {
  try {
    return parseDuration(text);
  } catch (error) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `"${text}" is not a duration: ${errorMessage(error)}`, cause: error });
  }
}

export const chatCheckInProcedures = {
  addCheckIn: publicProcedure
    .input(z.object({
      sessionId: z.string().min(1),
      in: z.string().min(1),
      label: z.string().min(1),
      alarm: z.boolean(),
      announce: z.string().nullable(),
      content: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { scheduleManager: manager, registry } = chatRuntime(ctx.boxRoot);
      // A check-in for a chat that has ended would be dropped when it fires; say so now.
      const availability = await resolveSessionAvailability({ boxRoot: ctx.boxRoot, sessionId: input.sessionId, registry });
      if (availability.kind === "unavailable") {
        throw new TRPCError({ code: "NOT_FOUND", message: `Conversation ${input.sessionId} has ended or cannot be resumed (${availability.reason})` });
      }
      try {
        const schedule = manager.addSchedule({
          label: input.label, alarm: input.alarm, announce: input.announce, content: input.content,
          durationMs: durationMs(input.in), sessionId: input.sessionId,
        });
        return { id: schedule.id, label: schedule.label, firesAt: schedule.firesAt };
      } catch (error) {
        if (error instanceof CheckInTooLongError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
        if (error instanceof ScheduleForDeletingSessionError) throw new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
        if (error instanceof CheckInNotSavedError) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message, cause: error });
        throw error;
      }
    }),

  cancelCheckIn: publicProcedure
    .input(z.object({ sessionId: z.string().min(1), label: z.string().min(1) }))
    .mutation(({ input, ctx }) => ({ ok: chatRuntime(ctx.boxRoot).scheduleManager.cancelByLabel(input.label, { sessionId: input.sessionId }) })),
};
