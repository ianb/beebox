import { z } from "zod";
import * as fs from "node:fs";
import { router, publicProcedure } from "../trpc.js";
import { getLogPaginated, getCommitDiff } from "../../../cli/lib/git.js";
import { getSessionLogPath, parseSessionLog } from "../../../cli/lib/session.js";

export const historyRouter = router({
  list: publicProcedure
    .input(
      z.object({
        count: z.number().int().positive().default(50),
        cursor: z.number().int().nonnegative().default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      const commits = await getLogPaginated({
        boxRoot: ctx.boxRoot,
        count: input.count,
        offset: input.cursor,
      });
      const nextCursor =
        commits.length === input.count
          ? input.cursor + commits.length
          : undefined;
      return { commits, nextCursor };
    }),

  diff: publicProcedure
    .input(
      z.object({
        hash: z.string().regex(/^[\da-f]{6,40}$/i),
      })
    )
    .query(async ({ input, ctx }) => {
      const diff = await getCommitDiff(ctx.boxRoot, input.hash);
      return { hash: input.hash, diff };
    }),

  sessionLog: publicProcedure
    .input(
      z.object({
        sessionId: z.string().regex(/^[\da-f-]{36}$/i),
        cursor: z.number().int().nonnegative().default(0),
        limit: z.number().int().positive().default(100),
      })
    )
    .query(async ({ input, ctx }) => {
      const logPath = getSessionLogPath(ctx.boxRoot, input.sessionId);

      if (!fs.existsSync(logPath)) {
        return {
          sessionId: input.sessionId,
          found: false,
          entries: [] as never[],
          total: 0,
          hasMore: false,
          nextCursor: undefined as number | undefined,
        };
      }

      const result = await parseSessionLog({
        logPath,
        offset: input.cursor,
        limit: input.limit,
      });

      const nextCursor = result.hasMore
        ? input.cursor + result.entries.length
        : undefined;

      return {
        sessionId: input.sessionId,
        found: true,
        ...result,
        nextCursor,
      };
    }),
});
