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

import type { FastifyInstance, FastifyReply } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { commitPaths, pathsHaveChanges, stageFiles } from "../../lib/git.js";
import type { EventBus } from "../../core/event-bus.js";
import { fileEtag } from "../file-etag.js";
import { boxRelativePath } from "../../shared/box-path.js";
import { extensionToMimetype } from "../../lib/mimetype.js";
import { dangerousRenderableDisposition } from "../serving-security.js";

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

/**
 * Apply the serving-hardening headers (nosniff always; the frozen sandbox
 * CSP or the dangerous-renderable attachment disposition when applicable)
 * to a reply. Shared by every bodied response below — including the 304
 * branch, which must repeat these on revalidation or a client that cached
 * the file before this hardening (or before an inline-preview exception
 * changed) would keep reusing the old, unhardened cached response forever.
 */
function applyServingSecurityHeaders(
  reply: FastifyReply,
  { isFrozen, contentDisposition }: { isFrozen: boolean; contentDisposition: string | null }
): FastifyReply {
  reply.header("X-Content-Type-Options", "nosniff");
  if (isFrozen) reply.header("Content-Security-Policy", FROZEN_CSP);
  if (contentDisposition) reply.header("Content-Disposition", contentDisposition);
  return reply;
}

/** Insert the fallback script just before </body> (or append if absent). */
function injectFrozenFallback(html: string): string {
  const tag = `<script>${FROZEN_FALLBACK_SCRIPT}</script>`;
  const idx = html.lastIndexOf("</body>");
  return idx === -1 ? html + tag : html.slice(0, idx) + tag + html.slice(idx);
}

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

        // Infer MIME type from extension. `.frozen` is served as HTML for the
        // sandboxed preview below; it's deliberately absent from the shared
        // mimetype table (so no other route serves it inline), so map it here.
        const ext = path.extname(resolved).toLowerCase();
        const contentType =
          ext === ".frozen" ? "text/html" : extensionToMimetype(ext, { fallback: "application/octet-stream" });

        // Frozen page captures are untrusted, user-saved HTML. We serve them as
        // HTML so "open snapshot" renders, but isolate them: `sandbox` (no
        // tokens) disables scripts and gives the page a null origin, so it
        // can't reach the box's cookies or APIs; nosniff blocks content-type
        // games. Applied on every bodied response below.
        const isFrozen = ext === ".frozen";

        // Dangerous renderable types default to attachment + nosniff (see the
        // set's doc comment above); the frozen preview path is the only
        // sanctioned exception, and it sets its own headers below.
        const contentDisposition = isFrozen
          ? null
          : dangerousRenderableDisposition(ext, path.basename(resolved));

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
          const notModifiedReply = applyServingSecurityHeaders(
            reply.header("ETag", etag).header("Last-Modified", lastModified).header("Cache-Control", "no-cache"),
            { isFrozen, contentDisposition }
          );
          return notModifiedReply.status(304).send();
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
            const rangeReply = applyServingSecurityHeaders(
              reply
                .status(206)
                .header("Content-Type", contentType)
                .header("Cache-Control", "no-cache")
                .header("ETag", etag)
                .header("Last-Modified", lastModified)
                .header("Accept-Ranges", "bytes")
                .header("Content-Range", `bytes ${String(range.start)}-${String(range.end)}/${String(stat.size)}`),
              { isFrozen, contentDisposition }
            );
            return rangeReply.send(slice);
          }
          // Malformed Range headers fall through to a normal 200 (per spec).
        }

        if (isFrozen) {
          const html = injectFrozenFallback((await fs.readFile(resolved)).toString("utf8"));
          const frozenReply = applyServingSecurityHeaders(
            reply
              .header("Content-Type", contentType)
              .header("Cache-Control", "no-cache")
              .header("ETag", etag)
              .header("Last-Modified", lastModified),
            { isFrozen, contentDisposition }
          );
          return frozenReply.send(html);
        }

        const content = await fs.readFile(resolved);
        const plainReply = applyServingSecurityHeaders(
          reply
            .header("Content-Type", contentType)
            .header("Cache-Control", "no-cache")
            .header("ETag", etag)
            .header("Last-Modified", lastModified)
            .header("Accept-Ranges", "bytes"),
          { isFrozen, contentDisposition }
        );
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
    async (request, reply) => deleteBoxFile({ request, reply, boxRoot, eventBus })
  );
}

/** Handler body for `DELETE /api/files/*`, split out to keep the registration function under the line cap. */
async function deleteBoxFile({
  request,
  reply,
  boxRoot,
  eventBus,
}: {
  request: { params: { "*": string } };
  reply: FastifyReply;
  boxRoot: string;
  eventBus: EventBus;
}): Promise<unknown> {
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
