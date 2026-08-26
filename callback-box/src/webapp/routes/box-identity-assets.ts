/**
 * A box's own icon and web-app manifest, served under its `/<slug>` prefix.
 *
 * The built frontend ships one icon set and one manifest at the ROOT, shared by
 * every box on the server (`hub-server.ts` mounts them once for the fleet). So
 * an installed app, a notification, and any OS surface that draws this app all
 * showed the same generic mark and the name "Callback Box", whichever box you
 * were actually looking at. These routes are the per-box answer, rendered on
 * demand from the box's root landmark card — no stored asset, no build step.
 *
 * **Both routes sit inside the box's auth scope**, like everything else under
 * `/<slug>`. A manifest is fetched WITHOUT credentials by default, which would
 * make an authenticated one 401 — so the document's manifest link carries
 * `crossorigin="use-credentials"` (see `index-html.ts`). The alternative,
 * serving a box's name and mark to anyone who guesses a slug, is a disclosure
 * this doesn't need to make.
 *
 * A box with no renderable mark falls through to the shared icon rather than
 * 404ing: the point is that a box always has SOME identity, and the generic
 * one is the honest answer when it hasn't chosen a mark.
 */

import type { FastifyInstance } from "fastify";
import { renderBoxIcon } from "../../core/box/box-icon.js";
import { readBoxIdentity } from "../../core/landmark/box-identity.js";

/**
 * The sizes a surface can ask for. An allowlist rather than an open integer:
 * the renders are cached per size, so an open parameter is an unbounded cache
 * keyed by whatever a caller types.
 *
 * 180 is Apple's touch-icon size, 192 and 512 are what a web-app manifest
 * wants, and 192 doubles as the notification icon.
 */
const SIZES = new Set([180, 192, 512]);

export function registerBoxIdentityAssetRoutes(
  server: FastifyInstance,
  { boxRoot, boxSlug }: { boxRoot: string; boxSlug: string },
): void {
  server.get<{ Params: { size: string } }>("/icon-:size.png", async (request, reply) => {
    const size = Number(request.params.size);
    if (!SIZES.has(size)) {
      return reply.status(404).send({ error: "No icon at that size" });
    }

    const icon = await renderBoxIcon({ boxRoot, slug: boxSlug, size });
    if (icon === null) {
      // No mark of its own — let the shared icon answer. A redirect rather
      // than a copy so the fleet icon stays one cacheable file.
      return reply.redirect(`/icons/icon-${size === 180 ? "192" : String(size)}.png`, 302);
    }

    if (request.headers["if-none-match"] === icon.etag) {
      return reply.status(304).send();
    }
    return reply
      .header("ETag", icon.etag)
      // Revalidate every time: the mark changes when the boxholder edits a
      // card, and a stale week-old icon on a home screen is not recoverable
      // from the box's side. The ETag makes the common case a 304.
      .header("Cache-Control", "no-cache")
      .type("image/png")
      .send(icon.png);
  });

  server.get("/manifest.webmanifest", async (_request, reply) => {
    const identity = await readBoxIdentity({ boxRoot, slug: boxSlug });
    const base = `/${boxSlug}`;

    // `start_url` is the box's own root, so an installed app opens into the
    // box it was installed from rather than the fleet's box picker — the whole
    // reason a per-box manifest is worth serving.
    const manifest = {
      name: identity.name,
      short_name: identity.name,
      start_url: `${base}/`,
      scope: `${base}/`,
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#9B6BA6",
      icons: [192, 512].map((size) => ({
        src: `${base}/icon-${String(size)}.png`,
        sizes: `${String(size)}x${String(size)}`,
        type: "image/png",
        purpose: "any",
      })),
    };

    return reply
      .header("Cache-Control", "no-cache")
      .type("application/manifest+json")
      .send(manifest);
  });
}
