/**
 * History routes — serves a raw file blob from a specific commit (binary
 * download, so it stays a raw route). The JSON history endpoints (commit log,
 * diff, session log) live in the `history` tRPC router.
 */

import type { FastifyInstance } from "fastify";
import { execFileSync } from "node:child_process";
import { simpleGit } from "simple-git";

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
