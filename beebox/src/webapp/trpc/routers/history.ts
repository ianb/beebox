import { z } from "zod";
import { TRPCError } from "@trpc/server";
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
import { MAX_SESSION_ENTRIES, parseSessionLog } from "../../../cli/lib/session.js";
import { resolveSessionLogPath } from "../../../core/chat/session/history.js";
import { loadSessionHistory } from "../../../core/chat/session/load-history.js";
import { resolveChatEngine } from "../../../core/chat/session/engine.js";
import { codexSessionExists } from "../../../core/chat/session/codex-transcript.js";
import { boxRelativePath } from "../../../shared/box-path.js";
import * as path from "node:path";

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
  path: z.string().min(1).optional(),
});

type HistoryFilter = z.infer<typeof filterSchema>;

/**
 * Accept a path in either the box-relative form the app uses internally or the git-root-relative
 * form the history UI displays.
 *
 * Strips a leading segment equal to the box root's own directory name when doing so names a real
 * file and the original does not. The as-is form always wins when it exists, so a box that
 * genuinely contains a `content/` directory of its own is unaffected.
 */
export function normalizeHistoryPath(candidate: string, boxRoot: string): string {
  if (fs.existsSync(path.join(boxRoot, candidate))) return candidate;
  const prefix = `${path.basename(boxRoot)}/`;
  if (!candidate.startsWith(prefix)) return candidate;
  const stripped = candidate.slice(prefix.length);
  if (stripped !== "" && fs.existsSync(path.join(boxRoot, stripped))) return stripped;
  return candidate;
}

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
      let historyPath: string | undefined;
      if (input.filter?.path !== undefined) {
        // Tolerate the form the UI displays. A box's git root is the directory ABOVE its box root,
        // so `git log --name-status` reports `content/config/foo.json` while every internal path
        // boundary in the app uses the box-relative `config/foo.json`. Copying a path out of the
        // diff panel into this filter therefore returned an empty result that read as "this file
        // has no history". Accept either form here, per box-path.ts's consume-boundary rule.
        const candidate = normalizeHistoryPath(boxRelativePath(input.filter.path), ctx.boxRoot);
        const root = path.resolve(ctx.boxRoot);
        const resolved = path.resolve(root, candidate);
        if (candidate.startsWith(":") || (resolved !== root && !resolved.startsWith(root + path.sep))) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid history path" });
        }
        historyPath = path.relative(root, resolved).split(path.sep).join("/");
      }
      const commits = await getLogPaginated({
        boxRoot: ctx.boxRoot,
        count: input.count,
        offset: input.cursor,
        filter: greps.length > 0 || historyPath !== undefined
          ? { greps, ...(historyPath === undefined ? {} : { path: historyPath }) }
          : undefined,
      });
      const nextCursor =
        commits.length === input.count
          ? input.cursor + commits.length
          : undefined;
      return { commits, nextCursor };
    }),

  facets: publicProcedure.query(async ({ ctx }) => {
    return getTrailerFacets(ctx.boxRoot);
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
        limit: z.number().int().positive().max(MAX_SESSION_ENTRIES).default(100),
      })
    )
    .query(async ({ input, ctx }) => {
      if (await resolveChatEngine(ctx.boxRoot, { sessionId: input.sessionId }) === "codex") {
        const found = await codexSessionExists(ctx.boxRoot, input.sessionId);
        if (!found) {
          return {
            sessionId: input.sessionId,
            found: false,
            entries: [],
            total: 0,
            hasMore: false,
            nextCursor: undefined,
          };
        }
        const result = await loadSessionHistory(ctx.boxRoot, {
          sessionId: input.sessionId,
          slice: { mode: "page", offset: input.cursor, limit: input.limit },
        });
        const hasMore = input.cursor + result.entries.length < result.total;
        return {
          sessionId: input.sessionId,
          found: true,
          entries: result.entries,
          total: result.total,
          hasMore,
          nextCursor: hasMore ? input.cursor + result.entries.length : undefined,
        };
      }
      const logPath = await resolveSessionLogPath(ctx.boxRoot, input.sessionId);

      if (!fs.existsSync(logPath)) {
        return {
          sessionId: input.sessionId,
          found: false,
          entries: [],
          total: 0,
          hasMore: false,
          nextCursor: undefined,
        };
      }

      const result = await parseSessionLog({
        logPath,
        slice: { mode: "page", offset: input.cursor, limit: input.limit },
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
