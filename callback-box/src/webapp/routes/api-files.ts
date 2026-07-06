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
import { createHash } from "node:crypto";
import { commitPaths, pathsHaveChanges, stageFiles } from "../../cli/lib/git.js";
import type { EventBus } from "../../core/event-bus.js";
import { fileEtag } from "../file-etag.js";
import { boxRelativePath } from "../../shared/box-path.js";

// Injected into frozen pages at serve time so a hot-linked image that fails
// (hot-link blockers, auth, dead origin) retries once through the box image
// proxy. Fixed text → fixed sha256, so the CSP below allows exactly this one
// script and nothing else (captured inline scripts/handlers stay blocked). It
// derives the box base from the frozen page's own URL (everything before
// /api/files/), so it works under any path prefix (prod slug, dev worktree).
const FROZEN_FALLBACK_SCRIPT =
  '(function(){var b=location.href.split("/api/files/")[0]+"/api/proxy-image?url=";' +
  'document.addEventListener("error",function(e){var i=e.target;' +
  'if(!i||i.tagName!=="IMG"||i.dataset.cbProxied)return;' +
  'i.dataset.cbProxied="1";i.src=b+encodeURIComponent(i.src);},true);})();';

const FROZEN_SCRIPT_HASH = `sha256-${createHash("sha256").update(FROZEN_FALLBACK_SCRIPT).digest("base64")}`;

// Frozen pages are untrusted captured HTML. `sandbox` keeps the opaque origin
// (no access to box cookies/APIs); `allow-scripts` + a hash-pinned `script-src`
// runs ONLY our fallback script — any captured <script> or inline handler is
// still refused. Styles/fonts/images stay unrestricted so the page renders and
// images hot-link.
const FROZEN_CSP = `sandbox allow-scripts; script-src '${FROZEN_SCRIPT_HASH}'`;

/** Insert the fallback script just before </body> (or append if absent). */
function injectFrozenFallback(html: string): string {
  const tag = `<script>${FROZEN_FALLBACK_SCRIPT}</script>`;
  const idx = html.lastIndexOf("</body>");
  return idx === -1 ? html + tag : html.slice(0, idx) + tag + html.slice(idx);
}

/**
 * Extensions whose MIME type makes a browser parse (and potentially execute)
 * the response as an active document rather than treating it as inert data,
 * when navigated to directly or embedded — the boundary this route must
 * defend, since it serves whatever raw files exist in the box regardless of
 * how they got there (hand-added, agent-written, or an attachment upload).
 * Rationale per entry:
 *   - `.html`/`.htm` — `text/html`: full script execution, DOM, same-origin
 *     fetch/cookie access.
 *   - `.xhtml`/`.xht`/`.shtml` — also rendered as HTML-family documents by
 *     browsers on direct navigation; same script surface as `.html` even
 *     though nothing in this codebase currently produces them.
 *   - `.svg` — `image/svg+xml`: an SVG document can embed `<script>` and
 *     inline event-handler attributes that execute once the browser parses
 *     it as a document (not merely rasterizes it), which happens on direct
 *     navigation or certain embeds.
 * Deliberately NOT included: `.pdf` (rendered by a sandboxed viewer, no
 * same-origin script access), raster/audio/video formats, `.md`/`.txt`/
 * `.csv`/`.json` (always parsed as inert text), Office formats (opened by a
 * separate application, not the browser's HTML/script engine). `.frozen` is
 * excluded from this set entirely — it's the one deliberate inline-preview
 * path, and it already carries its own sandboxed CSP (below) instead of the
 * attachment treatment.
 */
const DANGEROUS_RENDERABLE_EXTENSIONS = new Set([".html", ".htm", ".xhtml", ".xht", ".shtml", ".svg"]);

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
  ".card": "text/markdown",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".html": "text/html",
  // Frozen page captures (SingleFile output, scripts stripped) — serve as HTML
  // so "open snapshot" renders the page instead of downloading it.
  ".frozen": "text/html",
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
      const reqPath = boxRelativePath(request.params["*"] || "");

      // Security: resolve and ensure within boxRoot. Compare against `root +
      // sep` (not a bare prefix) so a sibling dir like `<box>-secrets` can't
      // satisfy the check.
      const resolved = path.resolve(path.join(boxRoot, reqPath));
      const root = path.resolve(boxRoot);
      if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        return reply.status(403).send({ error: "Access denied" });
      }

      // Don't serve dotfiles through this endpoint. Cards (.card) are plain
      // text and served like any other file — the Source view fetches them
      // here; card.get is for the parsed/validated form.
      if (path.basename(resolved).startsWith(".")) {
        return reply.status(403).send({ error: "Access denied" });
      }

      try {
        const stat = await fs.stat(resolved);
        if (!stat.isFile()) {
          return reply.status(404).send({ error: "Not found" });
        }

        // Infer MIME type from extension
        const ext = path.extname(resolved).toLowerCase();
        const contentType = MIME_TYPES[ext] || "application/octet-stream";

        // Frozen page captures are untrusted, user-saved HTML. We serve them as
        // HTML so "open snapshot" renders, but isolate them: `sandbox` (no
        // tokens) disables scripts and gives the page a null origin, so it
        // can't reach the box's cookies or APIs; nosniff blocks content-type
        // games. Applied on every bodied response below.
        const isFrozen = ext === ".frozen";

        // Dangerous renderable types default to attachment + nosniff (see the
        // set's doc comment above); the frozen preview path is the only
        // sanctioned exception, and it sets its own headers below.
        const isDangerousRenderable = !isFrozen && DANGEROUS_RENDERABLE_EXTENSIONS.has(ext);
        const contentDisposition = isDangerousRenderable
          ? `attachment; filename="${path.basename(resolved).replace(/"/g, "")}"`
          : null;

        // Conditional GET: build weak ETag from mtime + size, serve 304 when
        // the client already has the current version. `no-cache` means the
        // browser keeps the body but must revalidate every time, so an agent
        // editing the file on disk becomes visible on the next reload.
        const lastModified = stat.mtime.toUTCString();
        const etag = fileEtag(stat);
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
        // Frozen pages are never range-served: we inject a fallback script into
        // the full document, so partial responses would corrupt it (and they're
        // small now that images hot-link). Range requests fall through to 200.
        const rangeHeader = request.headers["range"];
        if (!isFrozen && typeof rangeHeader === "string" && request.method !== "HEAD") {
          const range = parseByteRange(rangeHeader, stat.size);
          if (range === "unsatisfiable") {
            return reply
              .header("Content-Range", `bytes */${String(stat.size)}`)
              .status(416)
              .send({ error: "Range not satisfiable" });
          }
          if (range !== null) {
            const slice = await readSlice(resolved, range);
            const rangeReply = reply
              .status(206)
              .header("Content-Type", contentType)
              .header("X-Content-Type-Options", "nosniff")
              .header("Cache-Control", "no-cache")
              .header("ETag", etag)
              .header("Last-Modified", lastModified)
              .header("Accept-Ranges", "bytes")
              .header("Content-Range", `bytes ${String(range.start)}-${String(range.end)}/${String(stat.size)}`);
            if (contentDisposition) rangeReply.header("Content-Disposition", contentDisposition);
            return rangeReply.send(slice);
          }
          // Malformed Range headers fall through to a normal 200 (per spec).
        }

        if (isFrozen) {
          const html = injectFrozenFallback((await fs.readFile(resolved)).toString("utf8"));
          return reply
            .header("Content-Security-Policy", FROZEN_CSP)
            .header("X-Content-Type-Options", "nosniff")
            .header("Content-Type", contentType)
            .header("Cache-Control", "no-cache")
            .header("ETag", etag)
            .header("Last-Modified", lastModified)
            .send(html);
        }

        const content = await fs.readFile(resolved);
        const plainReply = reply
          .header("Content-Type", contentType)
          .header("X-Content-Type-Options", "nosniff")
          .header("Cache-Control", "no-cache")
          .header("ETag", etag)
          .header("Last-Modified", lastModified)
          .header("Accept-Ranges", "bytes");
        if (contentDisposition) plainReply.header("Content-Disposition", contentDisposition);
        return plainReply.send(content);
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
      const reqPath = boxRelativePath(request.params["*"] || "");
      const resolved = path.resolve(path.join(boxRoot, reqPath));
      const root = path.resolve(boxRoot);

      if (resolved !== root && !resolved.startsWith(root + path.sep)) {
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
