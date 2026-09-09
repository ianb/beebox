/**
 * Unified image resolver route.
 *
 *   GET /api/image/* — resolve and serve an image by box-relative path
 *
 * Accepts two forms:
 *  - Plain image file (`.jpg`, `.png`, etc.) — served directly.
 *  - `.image.card` file — reads `filename.ref` from the frontmatter,
 *    resolves the `attach/` virtual prefix to `<stem>.attach/<file>`,
 *    and serves the attached image.
 *
 * Intended as the canonical URL for referencing an image regardless of
 * whether it's stored as a raw file or wrapped in a card. Thumbnails and
 * resize params can be layered here in the future.
 */

import type { FastifyInstance } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { extensionToMimetype } from "../../lib/mimetype.js";
import { applyRawFileServingHeaders } from "../serving-security.js";
import { BoxImageError, resolveBoxImage } from "../box-image.js";
import { fileEtag } from "../file-etag.js";

export function registerApiImageRoutes({
  server,
  boxRoot,
}: {
  server: FastifyInstance;
  boxRoot: string;
}): void {
  server.get<{ Params: { "*": string | undefined } }>(
    "/api/image/*",
    { exposeHeadRoute: true },
    async (request, reply) => {
      try {
        const { absolutePath: imageAbs, stat } = await resolveBoxImage(boxRoot, request.params["*"] ?? "");

        const ext = path.extname(imageAbs).toLowerCase();
        const contentType = extensionToMimetype(ext, { fallback: "application/octet-stream" });
        const filename = path.basename(imageAbs);
        const etag = fileEtag(stat);
        const lastModified = stat.mtime.toUTCString();

        const ifNoneMatch = request.headers["if-none-match"];
        const ifModifiedSince = request.headers["if-modified-since"];
        const etagMatches = ifNoneMatch === etag;
        const mtimeMatches =
          typeof ifModifiedSince === "string" &&
          Number.isFinite(Date.parse(ifModifiedSince)) &&
          Math.floor(Date.parse(ifModifiedSince) / 1000) >= Math.floor(stat.mtimeMs / 1000);

        if (etagMatches || mtimeMatches) {
          return applyRawFileServingHeaders(
            reply.header("ETag", etag).header("Last-Modified", lastModified).header("Cache-Control", "no-cache"),
            { ext, filename }
          )
            .status(304)
            .send();
        }

        const content = await fs.readFile(imageAbs);
        return applyRawFileServingHeaders(
          reply
            .header("Content-Type", contentType)
            .header("Cache-Control", "no-cache")
            .header("ETag", etag)
            .header("Last-Modified", lastModified),
          { ext, filename }
        ).send(content);
      } catch (e) {
        if (e instanceof BoxImageError) return reply.status(e.statusCode).send(e.body);
        console.warn(`[api-image] could not serve ${request.params["*"] ?? ""}:`, e);
        return reply.status(404).send({ error: "Not found" });
      }
    },
  );
}
