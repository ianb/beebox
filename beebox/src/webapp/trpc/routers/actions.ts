import { BoxMaintenanceError } from "../../../lib/box-maintenance-error.js";
import { answerWithAdmission } from "../../../core/commands/answer.js";
import * as path from "node:path";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../procedures.js";
import { runCommand, type CommandContext } from "../../../core/command-runner.js";
import { deliverUserMessage } from "../../../core/chat/session/deliver-user-message.js";
import { errorMessage } from "../../../shared/error-guards.js";
import { getChatRuntime } from "../../chat-runtime.js";
import type { TrpcContext } from "../context.js";

// The web boundary is box-relative only: an absolute path from an untrusted
// client would (if it resolved inside the box) reach an arbitrary card, and
// containment is easiest to reason about when the boundary never accepts one.
// The CLI still accepts absolute paths that resolve inside the box.
const boxRelativeQuestionPath = z
  .string()
  .min(1)
  .refine((p) => !path.isAbsolute(p), { message: "questionPath must be box-relative, not absolute" });

/** Run the dismiss transition and emit `question-dismissed`; a refusal is a `BAD_REQUEST`. */
async function dismissQuestion(ctx: TrpcContext, questionPath: string): Promise<void> {
  const cmdCtx: CommandContext = {
    boxRoot: ctx.boxRoot,
    write: () => {},
    writeLine: () => {},
  };
  const result = await runCommand({ name: "dismiss", args: { question: questionPath }, ctx: cmdCtx });
  if (!result.success) {
    throw new TRPCError({ code: "BAD_REQUEST", message: result.error ?? "Failed to dismiss" });
  }
  ctx.eventBus.emit("question-dismissed", { path: questionPath, timestamp: new Date().toISOString() });
}

// Note: a `wakeup`/connector-sync trigger procedure was removed — the box agent
// runs the wakeup cycle (via the scheduler / `bbx wakeup`); the web UI no longer
// exposes a bare command trigger.
export const actionsRouter = router({
  answer: publicProcedure
    .input(
      z.object({
        questionPath: boxRelativeQuestionPath,
        answer: z.string().optional(),
        selectedId: z.string().optional(),
      }).refine((d) => d.answer || d.selectedId, {
        message: "answer or selectedId is required",
      })
    )
    .mutation(async ({ input, ctx }) => {
      const cmdCtx: CommandContext = {
        boxRoot: ctx.boxRoot,
        write: () => {},
        writeLine: () => {},
      };

      const result = await answerWithAdmission({ ctx: cmdCtx, args: {
        question: input.questionPath, answer: input.answer, selectedId: input.selectedId, via: "web",
      }, onAnswered: () => { ctx.eventBus.emit("question-answered", {
        path: input.questionPath, answer: input.answer, selectedId: input.selectedId, timestamp: new Date().toISOString(),
      }); } }).catch((error: unknown) => {
        if (error instanceof BoxMaintenanceError) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: error.message });
        throw error;
      });
      if (!result.success) {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.error ?? "Failed to answer" });
      }

      return { success: true, message: "Question answered", path: input.questionPath };
    }),

  dismiss: publicProcedure
    .input(z.object({ questionPath: boxRelativeQuestionPath }))
    .mutation(async ({ input, ctx }) => {
      await dismissQuestion(ctx, input.questionPath);
      return { success: true, message: "Question dismissed", path: input.questionPath };
    }),

  /**
   * "Figure it out": put the question away (the dismiss transition), then start
   * a background chat that runs the figure-it-out skill on it. A delivery
   * failure after the dismiss leaves the card dismissed (the daily question
   * review picks it up) and returns an error; a non-pending card is refused by
   * the dismiss itself.
   */
  figureOut: publicProcedure
    .input(z.object({ questionPath: boxRelativeQuestionPath }))
    .mutation(async ({ input, ctx }) => {
      const runtime = getChatRuntime(ctx.boxRoot);
      if (runtime === undefined) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Chat runtime not initialized for this box" });
      }
      await dismissQuestion(ctx, input.questionPath);
      try {
        const delivered = await deliverUserMessage({
          boxRoot: ctx.boxRoot,
          registry: runtime.registry,
          eventBus: ctx.eventBus,
          wireSession: runtime.wireSession,
          target: { sessionId: null, contextDir: "" },
          message: `Figure out the question at ${input.questionPath}, which the person handed to you from the question card. Use the figure-it-out skill.`,
          logPrefix: "figure-it-out",
        });
        return { sessionId: delivered.sessionId };
      } catch (error) {
        console.error(`[figure-it-out] Delivery failed for ${input.questionPath}:`, error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `The question is put away, but the background chat did not start: ${errorMessage(error)}`,
          cause: error,
        });
      }
    }),

  create: publicProcedure
    .input(
      z.object({
        path: z.string().min(1),
        template: z.string().min(1),
        args: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const cmdCtx: CommandContext = {
        boxRoot: ctx.boxRoot,
        write: () => {},
        writeLine: () => {},
      };

      const result = await runCommand({
        name: "create",
        args: {
          path: input.path,
          template: input.template,
          args: input.args,
          commit: true,
        },
        ctx: cmdCtx,
      });

      if (!result.success) {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.error ?? "Failed to create card" });
      }

      ctx.eventBus.emit("card-created", {
        path: input.path,
        template: input.template,
        timestamp: new Date().toISOString(),
      });

      return { success: true, path: input.path };
    }),
});
