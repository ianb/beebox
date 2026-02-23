/**
 * History routes - Git commit timeline and session log viewer.
 */

import type { FastifyInstance } from "fastify";
import * as fs from "node:fs";
import { getLogPaginated, getCommitDiff } from "../../cli/lib/git.js";
import {
  getSessionLogPath,
  parseSessionLog,
} from "../../cli/lib/session.js";

/**
 * Register history API routes.
 */
export async function registerHistoryRoutes(
  server: FastifyInstance,
  boxRoot: string
): Promise<void> {
  /**
   * GET /api/history - Paginated commit log with trailers.
   */
  server.get<{
    Querystring: { count?: string; offset?: string };
  }>("/api/history", async (request) => {
    const count = parseInt(request.query.count || "50", 10);
    const offset = parseInt(request.query.offset || "0", 10);

    const commits = await getLogPaginated({ boxRoot, count, offset });

    return { commits };
  });

  /**
   * GET /api/history/diff/:hash - Diff for a specific commit.
   */
  server.get<{
    Params: { hash: string };
  }>("/api/history/diff/:hash", async (request) => {
    const { hash } = request.params;

    // Validate hash looks like a git hash
    if (!/^[\da-f]{6,40}$/i.test(hash)) {
      return { hash, diff: "" };
    }

    const diff = await getCommitDiff(boxRoot, hash);
    return { hash, diff };
  });

  /**
   * GET /api/history/session/:sessionId - Parsed session log.
   */
  server.get<{
    Params: { sessionId: string };
    Querystring: { offset?: string; limit?: string };
  }>("/api/history/session/:sessionId", async (request) => {
    const { sessionId } = request.params;
    const offset = parseInt(request.query.offset || "0", 10);
    const limit = parseInt(request.query.limit || "100", 10);

    // Validate sessionId looks like a UUID
    if (!/^[\da-f-]{36}$/i.test(sessionId)) {
      return { sessionId, found: false, entries: [], total: 0, hasMore: false };
    }

    const logPath = getSessionLogPath(boxRoot, sessionId);

    // Check if file exists
    if (!fs.existsSync(logPath)) {
      return { sessionId, found: false, entries: [], total: 0, hasMore: false };
    }

    const result = await parseSessionLog({ logPath, offset, limit });

    return {
      sessionId,
      found: true,
      ...result,
    };
  });
}
