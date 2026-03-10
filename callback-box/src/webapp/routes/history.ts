/**
 * History routes - Git commit timeline and session log viewer.
 */

import type { FastifyInstance } from "fastify";
import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import { simpleGit } from "simple-git";
import { getLogPaginated, getCommitDiff } from "../../cli/lib/git.js";
import {
  getSessionLogPath,
  parseSessionLog,
} from "../../cli/lib/session.js";

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".webm": "audio/webm",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
};

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

  /**
   * GET /api/history/blob/:hash/* - Serve a file from a specific commit.
   */
  server.get<{
    Params: { hash: string; "*": string };
  }>("/api/history/blob/:hash/*", async (request, reply) => {
    const { hash } = request.params;
    const filePath = request.params["*"];

    if (!/^[\da-f]{6,40}$/i.test(hash) || !filePath) {
      return reply.status(400).send({ error: "Invalid hash or path" });
    }

    try {
      const git = simpleGit(boxRoot);
      // binaryCatFile returns a Buffer
      let buffer = await git.binaryCatFile(["blob", `${hash}:${filePath}`]) as Buffer;

      // If this is a Git LFS pointer, resolve through smudge filter
      const LFS_PREFIX = "version https://git-lfs.github.com/spec/v1\n";
      if (buffer.length < 200 && buffer.toString("utf-8").startsWith(LFS_PREFIX)) {
        buffer = execFileSync(
          "git", ["lfs", "smudge"],
          { cwd: boxRoot, input: buffer, maxBuffer: 50 * 1024 * 1024 }
        );
      }

      const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";

      return reply
        .header("Content-Type", contentType)
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .send(buffer);
    } catch (_e) {
      return reply.status(404).send({ error: "File not found in commit" });
    }
  });
}
