/**
 * Serving-security hardening shared by the raw-byte file routes
 * (`/api/files/*`, `/api/image/*`, `/api/history/blob/*`). Each serves whatever
 * bytes exist in the box (or a git blob) with an extension-inferred MIME type,
 * so each independently faced the same stored-XSS shape: an `.html`/`.svg`
 * document served inline runs its embedded scripts in the box's origin. This
 * module holds the one dangerous-extension set + header logic all three call,
 * instead of each route re-deciding trust.
 */

import type { FastifyReply } from "fastify";

/**
 * Extensions whose MIME type makes a browser parse (and potentially execute)
 * the response as an active document rather than treating it as inert data,
 * when navigated to directly or embedded.
 *   - `.html`/`.htm` — `text/html`: full script execution, DOM, same-origin
 *     fetch/cookie access.
 *   - `.xhtml`/`.xht`/`.shtml` — also rendered as HTML-family documents by
 *     browsers on direct navigation; same script surface as `.html`.
 *   - `.svg` — `image/svg+xml`: an SVG document can embed `<script>` and inline
 *     event-handler attributes that execute once the browser parses it as a
 *     document (not merely rasterizes it), which happens on direct navigation
 *     or certain embeds.
 * Deliberately NOT included: `.pdf` (sandboxed viewer, no same-origin script),
 * raster/audio/video, `.md`/`.txt`/`.csv`/`.json` (inert text), Office formats
 * (separate application). `.frozen` is excluded here too — it's api-files.ts's
 * one deliberate inline-preview path, which carries its own sandboxed CSP.
 */
const DANGEROUS_RENDERABLE_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".xhtml",
  ".xht",
  ".shtml",
  ".svg",
]);

/**
 * The `Content-Disposition` value for a dangerous-renderable extension (forces
 * download instead of inline render), or `null` for inert types that can serve
 * inline. `filename` has embedded quotes stripped so it can't break out of the
 * header.
 */
export function dangerousRenderableDisposition(ext: string, filename: string): string | null {
  if (!DANGEROUS_RENDERABLE_EXTENSIONS.has(ext)) return null;
  return `attachment; filename="${filename.replace(/"/g, "")}"`;
}

/**
 * Apply raw-file serving hardening to a reply: `X-Content-Type-Options: nosniff`
 * always, plus a download disposition for dangerous-renderable extensions. For
 * the routes that serve raw box/git-blob bytes and have no frozen-preview
 * exception (api-image, history). api-files.ts layers its frozen-sandbox CSP on
 * top of the same set and disposition helper.
 */
export function applyRawFileServingHeaders(
  reply: FastifyReply,
  { ext, filename }: { ext: string; filename: string }
): FastifyReply {
  reply.header("X-Content-Type-Options", "nosniff");
  const disposition = dangerousRenderableDisposition(ext, filename);
  if (disposition) reply.header("Content-Disposition", disposition);
  return reply;
}
