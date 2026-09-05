import * as path from "node:path";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc.js";
import { runCommand, type CommandContext } from "../../../core/commands/index.js";

// The web boundary is box-relative only: an absolute path from an untrusted
// client would (if it resolved inside the box) reach an arbitrary card, and
// containment is easiest to reason about when the boundary never accepts one.
// The CLI still accepts absolute paths that resolve inside the box.
const boxRelativeQuestionPath = z
  .string()
  .min(1)
  .refine((p) => !path.isAbsolute(p), { message: "questionPath must be box-relative, not absolute" });

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

      const result = await runCommand({
        name: "answer",
        args: {
          question: input.questionPath,
          answer: input.answer,
          selectedId: input.selectedId,
          via: "web",
        },
        ctx: cmdCtx,
      });

      if (!result.success) {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.error ?? "Failed to answer" });
      }

      ctx.eventBus.emit("question-answered", {
        path: input.questionPath,
        answer: input.answer,
        selectedId: input.selectedId,
        timestamp: new Date().toISOString(),
      });

      return { success: true, message: "Question answered", path: input.questionPath };
    }),

  dismiss: publicProcedure
    .input(z.object({ questionPath: boxRelativeQuestionPath }))
    .mutation(async ({ input, ctx }) => {
      const cmdCtx: CommandContext = {
        boxRoot: ctx.boxRoot,
        write: () => {},
        writeLine: () => {},
      };

      const result = await runCommand({
        name: "dismiss",
        args: { question: input.questionPath },
        ctx: cmdCtx,
      });

      if (!result.success) {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.error ?? "Failed to dismiss" });
      }

      ctx.eventBus.emit("question-dismissed", {
        path: input.questionPath,
        timestamp: new Date().toISOString(),
      });

      return { success: true, message: "Question dismissed", path: input.questionPath };
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
