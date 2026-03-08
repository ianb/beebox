import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc.js";
import {
  runCommand,
  listCommands,
  getCommand,
  type CommandContext,
} from "../../../core/commands/index.js";

export const commandsRouter = router({
  list: publicProcedure.query(async () => {
    const commands = listCommands();
    return {
      commands: commands.map((cmd) => ({
        name: cmd.name,
        description: cmd.description,
        args: cmd.args,
      })),
    };
  }),

  get: publicProcedure
    .input(z.object({ name: z.string().min(1) }))
    .query(async ({ input }) => {
      const cmd = getCommand(input.name);
      if (!cmd) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Command not found" });
      }
      return { name: cmd.name, description: cmd.description, args: cmd.args };
    }),

  executeSync: publicProcedure
    .input(
      z.object({
        command: z.string().min(1),
        args: z.record(z.unknown()).default({}),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const cmd = getCommand(input.command);
      if (!cmd) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Unknown command: ${input.command}` });
      }

      const outputLines: string[] = [];
      const cmdCtx: CommandContext = {
        boxRoot: ctx.boxRoot,
        write: (text: string) => outputLines.push(text),
        writeLine: (text: string) => outputLines.push(text),
      };

      const result = await runCommand({ name: input.command, args: input.args, ctx: cmdCtx });

      ctx.eventBus.emit("command-complete", {
        command: input.command,
        success: result.success,
        timestamp: new Date().toISOString(),
      });

      if (!result.success) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error ?? "Command failed",
        });
      }

      return { success: true, data: result.data, output: outputLines };
    }),
});
