/**
 * Raw box file serving routes for the REST API.
 *
 * Split out of `api.ts`. Owns the `/api/files/*` family — reading and deleting
 * raw (non-card) box files — plus the conditional-GET / MIME-type machinery
 * that only these handlers need:
 *
 *   GET (and HEAD) /api/files/* — serve images, audio, etc. with weak ETags
 *   DELETE /api/files/*         — remove a raw file and commit the deletion
 */

import type { FastifyInstance } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { commitPaths, pathsHaveChanges, stageFiles } from "../../cli/lib/git.js";
import type { EventBus } from "../../core/event-bus.js";

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".webm": "audio/webm",
  ".mp4": "video/mp4",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".pdf": "application/pdf",
  ".json": "application/json",
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".html": "text/html",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip",
};

interface RegisterApiFilesRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
  eventBus: EventBus;
}

/**
 * Register the `/api/files/*` read + delete routes on the Fastify server.
 */
export function registerApiFilesRoutes(options: RegisterApiFilesRoutesOptions): void {
  const { server, boxRoot, eventBus } = options;

  // GET (and HEAD) /api/files/* - Serve raw box files (images, audio, etc.)
  server.get<{ Params: { "*": string } }>(
    "/api/files/*",
    { exposeHeadRoute: true },
    async (request, reply) => {
      const reqPath = request.params["*"] || "";

      // Security: resolve and ensure within boxRoot
      const resolved = path.resolve(path.join(boxRoot, reqPath));
      if (!resolved.startsWith(path.resolve(boxRoot))) {
        return reply.status(403).send({ error: "Access denied" });
      }

      // Don't serve .card files or dotfiles through this endpoint
      if (resolved.endsWith(".card") || path.basename(resolved).startsWith(".")) {
        return reply.status(403).send({ error: "Use card API for card files" });
      }

      try {
        const stat = await fs.stat(resolved);
        if (!stat.isFile()) {
          return reply.status(404).send({ error: "Not found" });
        }

        // Infer MIME type from extension
        const ext = path.extname(resolved).toLowerCase();
        const contentType = MIME_TYPES[ext] || "application/octet-stream";

        // Conditional GET: build weak ETag from mtime + size, serve 304 when
        // the client already has the current version. `no-cache` means the
        // browser keeps the body but must revalidate every time, so an agent
        // editing the file on disk becomes visible on the next reload.
        const lastModified = stat.mtime.toUTCString();
        const etag = `W/"${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}"`;
        const ifNoneMatch = request.headers["if-none-match"];
        const ifModifiedSince = request.headers["if-modified-since"];
        const etagMatches = ifNoneMatch === etag;
        const mtimeMatches =
          typeof ifModifiedSince === "string" &&
          Number.isFinite(Date.parse(ifModifiedSince)) &&
          Math.floor(Date.parse(ifModifiedSince) / 1000) >= Math.floor(stat.mtimeMs / 1000);
        if (etagMatches || mtimeMatches) {
          return reply
            .header("ETag", etag)
            .header("Last-Modified", lastModified)
            .header("Cache-Control", "no-cache")
            .status(304)
            .send();
        }

        // Range support: views and agents tail large attachments (e.g. a
        // sessions/history.jsonl) without pulling the whole file. Only the
        // requested slice is read from disk.
        const rangeHeader = request.headers["range"];
        if (typeof rangeHeader === "string" && request.method !== "HEAD") {
          const range = parseByteRange(rangeHeader, stat.size);
          if (range === "unsatisfiable") {
            return reply
              .header("Content-Range", `bytes */${String(stat.size)}`)
              .status(416)
              .send({ error: "Range not satisfiable" });
          }
          if (range !== null) {
            const slice = await readSlice(resolved, range);
            return reply
              .status(206)
              .header("Content-Type", contentType)
              .header("Cache-Control", "no-cache")
              .header("ETag", etag)
              .header("Last-Modified", lastModified)
              .header("Accept-Ranges", "bytes")
              .header("Content-Range", `bytes ${String(range.start)}-${String(range.end)}/${String(stat.size)}`)
              .send(slice);
          }
          // Malformed Range headers fall through to a normal 200 (per spec).
        }

        const content = await fs.readFile(resolved);
        return reply
          .header("Content-Type", contentType)
          .header("Cache-Control", "no-cache")
          .header("ETag", etag)
          .header("Last-Modified", lastModified)
          .header("Accept-Ranges", "bytes")
          .send(content);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          console.warn(`Could not stat/read file, returning 404: ${resolved}:`, e);
        }
        return reply.status(404).send({ error: "Not found" });
      }
    }
  );

  // DELETE /api/files/* - Remove a raw box file and commit the deletion
  server.delete<{ Params: { "*": string } }>(
    "/api/files/*",
    async (request, reply) => {
      const reqPath = request.params["*"] || "";
      const resolved = path.resolve(path.join(boxRoot, reqPath));

      if (!resolved.startsWith(path.resolve(boxRoot))) {
        return reply.status(403).send({ error: "Access denied" });
      }

      if (reqPath === "" || path.basename(resolved).startsWith(".")) {
        return reply.status(400).send({ error: "File path required" });
      }

      if (resolved.endsWith(".card")) {
        return reply.status(403).send({ error: "Card deletion is not supported through this endpoint" });
      }

      try {
        const stat = await fs.stat(resolved);
        if (!stat.isFile()) {
          return reply.status(404).send({ error: "Not found" });
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          console.warn(`Could not stat file for delete, returning 404: ${resolved}:`, e);
        }
        return reply.status(404).send({ error: "Not found" });
      }

      if (await pathsHaveChanges(boxRoot, [reqPath])) {
        await stageFiles(boxRoot, [reqPath]);
        await commitPaths(boxRoot, {
          paths: [reqPath],
          message: `Saved before user delete: ${reqPath}`,
        });
      }

      await fs.unlink(resolved);
      await stageFiles(boxRoot, [reqPath]);
      const commitHash = await commitPaths(boxRoot, {
        paths: [reqPath],
        message: `Deleted by user: ${reqPath}`,
      });

      eventBus.emitTransient("file-change", {
        event: "unlink",
        path: reqPath,
        timestamp: new Date().toISOString(),
      });

      return {
        ok: true,
        path: reqPath,
        commit: commitHash,
      };
    }
  );
}

/**
 * Parse a single-range `Range: bytes=...` header against a file size.
 * Returns the inclusive byte range, "unsatisfiable" (→ 416), or null for
 * forms we don't serve (multi-range, malformed) — those get the full file.
 */
function parseByteRange(
  header: string,
  size: number
): { start: number; end: number } | "unsatisfiable" | null {
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (match === null) return null;
  const [, startStr, endStr] = match;
  if (startStr === "" && endStr === "") return null;
  if (startStr === "") {
    // Suffix form: bytes=-N → the last N bytes.
    const suffix = Number(endStr);
    if (suffix === 0) return "unsatisfiable";
    const start = Math.max(0, size - suffix);
    return size === 0 ? "unsatisfiable" : { start, end: size - 1 };
  }
  const start = Number(startStr);
  if (start >= size) return "unsatisfiable";
  const end = endStr === "" ? size - 1 : Math.min(Number(endStr), size - 1);
  if (end < start) return null;
  return { start, end };
}

/** Read just [start, end] (inclusive) from a file. */
async function readSlice(
  absPath: string,
  { start, end }: { start: number; end: number }
): Promise<Buffer> {
  const length = end - start + 1;
  const handle = await fs.open(absPath, "r");
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    return buffer;
  } finally {
    await handle.close();
  }
}
