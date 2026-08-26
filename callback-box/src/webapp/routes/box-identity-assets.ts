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
 * **The two routes are not equally protected, and the icon route is written
 * for that.** Both are registered inside the box's scope, but that scope's
 * auth hook waves through any non-API URL ending in an asset extension
 * (`server-box-scope.ts`), so `/…/icon-192.png` is reachable unauthenticated
 * on a standalone server while `/…/manifest.webmanifest` is not. (Behind the
 * hub, its own gate has no such bypass and both are authenticated.) So the
 * icon route serves ONLY bundled third-party glyph art, never box bytes. What
 * a public icon can disclose is therefore which emoji a box chose, for a slug
 * the caller already knew.
 *
 * A box whose mark is an IMAGE gets the app's own icon here, and its real mark
 * only where the client can fetch it authenticated (the tab, the pill). An OS
 * surface showing the generic icon for such a box is the same thing it showed
 * before any of this existed; handing the file to an unauthenticated caller to
 * improve on that is not a trade worth making.
 *
 * The manifest, which does carry the box's name, stays authenticated. A
 * manifest is fetched WITHOUT credentials by default, so the document's link
 * carries `crossorigin="use-credentials"` (see `index-html.ts`).
 *
 * A box with no renderable mark falls through to the shared icon rather than
 * 404ing: the point is that a box always has SOME identity, and the generic
 * one is the honest answer when it hasn't chosen a mark.
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { renderBoxIcon } from "../../core/box/box-icon.js";
import { readBoxIdentity, type BoxIdentity } from "../../core/landmark/box-identity.js";

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
  { boxRoot, boxSlug, frontendPath }: { boxRoot: string; boxSlug: string; frontendPath: string },
): void {
  server.get<{ Params: { size: string } }>("/icon-:size.png", async (request, reply) => {
    const size = Number(request.params.size);
    if (!SIZES.has(size)) {
      return reply.status(404).send({ error: "No icon at that size" });
    }

    const icon = await renderBoxIcon({ boxRoot, slug: boxSlug, size });
    if (icon === null) {
      // Nothing to draw for this box — answer with the app's own icon, in
      // bytes rather than a redirect. A redirect would have to name an
      // absolute path, and this route cannot: the prefix a fronting proxy
      // stripped (`/` in production, `/<worktree>` behind the dev router)
      // never reaches here, and Fastify normalizes a relative Location
      // against the URL it sees, which is the one missing that prefix.
      return sendSharedIcon(reply, { frontendPath, size });
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
    return reply
      .header("Cache-Control", "no-cache")
      .type("application/manifest+json")
      .send(boxManifest(identity));
  });
}

/**
 * The web-app manifest for one box.
 *
 * `start_url` and `scope` are the box's own root, so an installed app opens
 * into the box it was installed from rather than the fleet's box picker —
 * which is most of why a per-box manifest is worth serving at all. The name is
 * the box's, so an installed app is called `Kitchen` rather than the fourth
 * copy of `Callback Box` on someone's home screen.
 *
 * Icons are PNG rather than the SVG a Chromium browser would accept: these are
 * the sizes an OS draws for an installed app, and an install captures them
 * once, so the format with no support question attached is the right one here.
 */
export function boxManifest(identity: BoxIdentity): Record<string, unknown> {
  const base = `/${identity.slug}`;
  return {
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
}

/**
 * The app's own icon, for a box with nothing of its own to show.
 *
 * Bytes rather than a redirect — see the call site for why this route cannot
 * name an absolute path. 180 has no shared variant, so it borrows 192, which
 * an OS scales.
 */
async function sendSharedIcon(
  reply: FastifyReply,
  { frontendPath, size }: { frontendPath: string; size: number },
): Promise<unknown> {
  const name = `icon-${size === 180 ? "192" : String(size)}.png`;
  try {
    const bytes = await readFile(path.join(frontendPath, "icons", name));
    return reply.header("Cache-Control", "no-cache").type("image/png").send(bytes);
  } catch (e) {
    // Only reachable with no built frontend, where nothing else works either.
    console.warn(`box icon: no shared ${name} to fall back to:`, e);
    return reply.status(404).send({ error: "No icon" });
  }
}
