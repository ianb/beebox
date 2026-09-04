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
import { probePointer } from "../../lib/asset-content.js";
import { isRecord } from "../../lib/is-record.js";
import { parse as parseYaml } from "yaml";
import { extensionToMimetype } from "../../lib/mimetype.js";
import { applyRawFileServingHeaders } from "../serving-security.js";
import { errnoCode } from "../../lib/error-guards.js";
import { containWithinBox } from "../../lib/box-containment.js";
import { resolveBoxNamespacePath } from "../../lib/box-namespace-resolve.js";

// `.avif` is here because the document extractor writes page and figure
// renders as AVIF (`src/core/commands/document-extract.ts`); without it every
// page render in an extracted document served a 400 "Not an image path".
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".bmp", ".svg"]);

/**
 * Resolve an `.image.card`'s attached image to an absolute filesystem path.
 * Returns null if the card can't be read or has no `filename.ref`.
 */
async function resolveImageCard(cardAbs: string): Promise<string | null> {
  let text: string;
  try {
    text = await fs.readFile(cardAbs, "utf-8");
  } catch (_e) {
    return null;
  }

  let ref: string | null = null;

  if (text.startsWith("---")) {
    // YAML frontmatter format (Phase 2)
    const match = /^---\r?\n([\S\s]*?)\r?\n---/.exec(text);
    if (match) {
      let fields: unknown;
      try {
        fields = parseYaml(match[1] ?? "");
      } catch (_e) {
        fields = null;
      }
      if (isRecord(fields) && isRecord(fields["filename"])) {
        const r = fields["filename"]["ref"];
        if (typeof r === "string" && r.startsWith("attach/")) ref = r;
      }
    }
  } else {
    // XML format (legacy) — grab ref="attach/..." from <filename> element
    const match = /<filename\b[^>]*\bref="(attach\/[^"]+)"/.exec(text);
    if (match?.[1]) ref = match[1];
  }

  if (!ref) return null;

  // `attach/<file>` is a virtual prefix scoped to `<cardStem>.attach/`.
  const cardBaseName = path.basename(cardAbs);
  const cardDir = path.dirname(cardAbs);
  const stem = cardBaseName.replace(/(\.[^.]+)*\.card$/, "");
  const attachDir = path.join(cardDir, `${stem}.attach`);
  const filePart = ref.slice("attach/".length);

  return path.join(attachDir, filePart);
}

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
      const reqPath = request.params["*"] ?? "";
      if (!reqPath) return reply.status(400).send({ error: "Path required" });

      // Box containment + namespace fence, checked on the RESOLVED path
      // (`docs/plans/one-root-box-layout.md` Track B).
      const ns = resolveBoxNamespacePath(boxRoot, reqPath);
      if (ns === null) {
        return reply.status(403).send({ error: "Access denied" });
      }
      const { resolved } = ns;
      if (path.basename(resolved).startsWith(".")) {
        return reply.status(403).send({ error: "Access denied" });
      }

      let imageAbs: string;

      if (resolved.endsWith(".image.card")) {
        const img = await resolveImageCard(resolved);
        if (!img) return reply.status(404).send({ error: "Image not found in card" });
        imageAbs = img;
      } else {
        const ext = path.extname(resolved).toLowerCase();
        if (!IMAGE_EXTS.has(ext)) {
          return reply.status(400).send({ error: "Not an image path" });
        }
        imageAbs = resolved;
      }

      if (containWithinBox(boxRoot, imageAbs) === null) {
        return reply.status(403).send({ error: "Access denied" });
      }

      try {
        const stat = await fs.stat(imageAbs);

        // Absent annexed content: bail before any header or body work, so the
        // pointer is never served as an image. See lib/asset-content.ts.
        const pointer = await probePointer(imageAbs, { knownSize: stat.size });
        if (pointer !== null) {
          return reply.status(409).send({
            error: "Content not present locally",
            key: pointer.key,
            size: pointer.size,
            sha256: pointer.sha256,
          });
        }
        if (!stat.isFile()) return reply.status(404).send({ error: "Not found" });

        const ext = path.extname(imageAbs).toLowerCase();
        const contentType = extensionToMimetype(ext, { fallback: "application/octet-stream" });
        const filename = path.basename(imageAbs);
        const etag = `W/"${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}"`;
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
        if (errnoCode(e) !== "ENOENT") {
          console.warn(`[api-image] could not serve ${imageAbs}:`, e);
        }
        return reply.status(404).send({ error: "Not found" });
      }
    },
  );
}
