import { z } from "zod";
import * as fs from "node:fs";
import { router, publicProcedure } from "../trpc.js";
import {
  CONNECTOR_TRAILER_KEYS,
  FEEDBACK_TRAILER_KEYS,
  TOUCHPOINT_TRAILER_KEYS,
  getCommitDiff,
  getLogPaginated,
  getTrailerFacets,
} from "../../../lib/git.js";
import { parseSessionLog } from "../../../cli/lib/session.js";
import { resolveSessionLogPath } from "../../../core/chat-session-history.js";

/** Escape values so they can be interpolated into a git --grep ERE pattern. */
function escapeRegex(value: string): string {
  return value.replaceAll(/[$()*+.?[\\\]^{|}]/g, "\\$&");
}

/**
 * Compose the list of `--grep` regexes that express the selected filter.
 * Each returned pattern is one axis; git's `--all-match` AND-joins them.
 * Within a single pattern, alternation (`|`) expresses OR for that axis.
 */
function buildGreps(filter: HistoryFilter): string[] {
  const greps: string[] = [];

  if (filter.connectors && filter.connectors.length > 0) {
    const keys = CONNECTOR_TRAILER_KEYS.join("|");
    const values = filter.connectors.map(escapeRegex).join("|");
    greps.push(`^(${keys}): (${values})$`);
  }

  if (filter.workflows && filter.workflows.length > 0) {
    const values = filter.workflows.map(escapeRegex).join("|");
    greps.push(`^Workflow: (${values})$`);
  }

  if (filter.touchpoint) {
    greps.push(`^(${TOUCHPOINT_TRAILER_KEYS.join("|")}): `);
  }

  if (filter.feedback) {
    greps.push(`^(${FEEDBACK_TRAILER_KEYS.join("|")}): `);
  }

  if (filter.session) {
    greps.push(`^Session: ${escapeRegex(filter.session)}$`);
  }

  return greps;
}

const filterSchema = z.object({
  connectors: z.array(z.string()).optional(),
  workflows: z.array(z.string()).optional(),
  touchpoint: z.boolean().optional(),
  feedback: z.boolean().optional(),
  session: z.string().optional(),
});

type HistoryFilter = z.infer<typeof filterSchema>;

export const historyRouter = router({
  list: publicProcedure
    .input(
      z.object({
        count: z.number().int().positive().default(50),
        cursor: z.number().int().nonnegative().default(0),
        filter: filterSchema.optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const greps = input.filter ? buildGreps(input.filter) : [];
      const commits = await getLogPaginated({
        boxRoot: ctx.boxRoot,
        count: input.count,
        offset: input.cursor,
        filter: greps.length > 0 ? { greps } : undefined,
      });
      const nextCursor =
        commits.length === input.count
          ? input.cursor + commits.length
          : undefined;
      return { commits, nextCursor };
    }),

  facets: publicProcedure.query(async ({ ctx }) => {
    return await getTrailerFacets(ctx.boxRoot);
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
      const logPath = await resolveSessionLogPath(ctx.boxRoot, input.sessionId);

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
