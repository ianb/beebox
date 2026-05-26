import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";

const clientLogs: Array<{ ts: string; level: string; message: string }> = [];
const MAX_CLIENT_LOGS = 200;

export const debugLogRouter = router({
  get: publicProcedure.query(async () => {
    return { entries: clientLogs };
  }),

  submit: publicProcedure
    .input(
      z.object({
        entries: z.array(
          z.object({
            level: z.string(),
            message: z.string(),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      for (const entry of input.entries) {
        clientLogs.push({
          ts: new Date().toISOString(),
          level: entry.level,
          message: entry.message,
        });
      }
      while (clientLogs.length > MAX_CLIENT_LOGS) clientLogs.shift();
      return { ok: true };
    }),

  clear: publicProcedure.mutation(async () => {
    clientLogs.length = 0;
    return { ok: true };
  }),
});
