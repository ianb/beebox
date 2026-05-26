import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc.js";
import { runCommand, type CommandContext } from "../../../core/commands/index.js";

export const actionsRouter = router({
  wakeup: publicProcedure
    .input(z.object({ dryRun: z.boolean().default(false) }))
    .mutation(async ({ input, ctx }) => {
      ctx.eventBus.emit("wakeup-start", {
        timestamp: new Date().toISOString(),
        dryRun: input.dryRun,
      });

      const logs: string[] = [];
      const cmdCtx: CommandContext = {
        boxRoot: ctx.boxRoot,
        write: (msg: string) => { logs.push(msg); console.log(msg); },
        writeLine: (msg: string) => { logs.push(msg); console.log(msg); },
      };

      try {
        const result = await runCommand({ name: "connector-sync", args: { dryRun: input.dryRun }, ctx: cmdCtx });

        ctx.eventBus.emit("wakeup-complete", {
          timestamp: new Date().toISOString(),
          success: result.success,
          phases: (result.data as { phases?: unknown })?.phases,
        });

        if (!result.success) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: result.error ?? "Wakeup failed",
          });
        }

        return {
          success: true,
          message: input.dryRun ? "Wakeup completed (dry run)" : "Wakeup completed",
          phases: (result.data as { phases?: unknown })?.phases,
          logs,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        ctx.eventBus.emit("wakeup-error", {
          timestamp: new Date().toISOString(),
          error: (error as Error).message,
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: (error as Error).message,
        });
      }
    }),

  answer: publicProcedure
    .input(
      z.object({
        questionPath: z.string().min(1),
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
