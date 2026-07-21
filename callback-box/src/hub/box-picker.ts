/**
 * `cb hub`'s box picker at `/`. Serves the SPA so the styled box-selection page
 * (`BoxRedirect` → `BoxSelectionTiles`, the SPA's `/` route) renders — matching
 * the dev router's worktree root (`/<worktree>/`). The SPA fetches the
 * accessible-box list from the hub's `/api/boxes` and loads its assets via the
 * hub's root static routes (`hub-server.ts`). When the frontend bundle isn't
 * built it falls back to a minimal, dependency-free server-rendered list (the
 * original Track D / boxes-as-packages-v2 behavior, kept for the no-frontend
 * case). Auth-gated exactly like any HTML navigation through the hub — but this
 * route lives on the hub's own Fastify instance, so it authenticates directly
 * against the session cookie (the hub is the one process that legitimately holds
 * it), not via the hub-injected headers a box would use.
 */

import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { resolveRequestIdentity, getOwnerEmail } from "../webapp/auth.js";
import { filterAccessibleBoxes } from "../webapp/box-access.js";
import { loginRedirect, stripBasePrefixHeader } from "../webapp/base-prefix.js";
import type { BoxSpec } from "../webapp/server-types.js";
import { invariant } from "../lib/invariant.js";

function escapeHtml(value: string): string {
  const escapes: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/["&'<>]/g, (c) => {
    const escaped = escapes[c];
    invariant(escaped !== undefined, `escapeHtml: no mapping for matched character "${c}"`);
    return escaped;
  });
}

function renderPage(boxes: BoxSpec[]): string {
  const items = boxes
    .map((box) => `    <li><a href="/${escapeHtml(box.slug)}/">${escapeHtml(box.slug)}</a></li>`)
    .join("\n");
  return `<!DOCTYPE html>
<html>
<head>
  <title>Callback Box Hub</title>
  <meta charset="utf-8">
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; }
    h1 { color: #333; }
    ul { padding-left: 1.25rem; }
    li { margin: 0.25rem 0; }
  </style>
</head>
<body>
  <h1>Boxes</h1>
  <ul>
${items || "    <li>No boxes available.</li>"}
  </ul>
</body>
</html>
`;
}

/**
 * Register `GET /` on the hub's Fastify instance: the fleet-wide box
 * picker. Unauthenticated -> redirect to `/auth/login` (unless the hub was
 * constructed with `openAccess: true`, i.e. hub-wide auth is off, in which case
 * every configured box is listed — same "open" semantics the fleet's boxes get
 * via `x-cb-hub-auth: off`).
 */
export function registerBoxPicker(
  server: FastifyInstance,
  { boxes, frontendDist }: { boxes: BoxSpec[]; frontendDist: string },
): void {
  server.get("/", async (request, reply) => {
    // Route through the SAME identity resolver the boxes use (FIX 1) so a
    // stale-`gen` cookie doesn't authenticate and a corrupt store answers 503
    // rather than a bogus login redirect. The hub process is not in hub mode, so
    // the resolver takes its cookie path.
    let email: string | null = null;
    if (!request.server.openAccess) {
      const identity = resolveRequestIdentity(request, { openAccess: request.server.openAccess });
      if (identity.source === "unavailable") {
        return reply.status(503).send({ error: "Authentication temporarily unavailable" });
      }
      if (!identity.email) {
        // Hub route: a client must never supply the base prefix, so strip any
        // copy before redirecting. The hub serves login at its own root and
        // never strips the slug, so `request.url` already carries it — the
        // resulting redirect is bare `/auth/login?returnTo=<url>`, unchanged.
        stripBasePrefixHeader(request.raw.headers);
        return loginRedirect(request, reply);
      }
      email = identity.email;
    }
    // Serve the SPA (its `/` route renders the styled box-selection tiles and
    // fetches the accessible-box list from /api/boxes). Fall back to the minimal
    // server-rendered list only when the frontend bundle isn't built.
    const indexHtml = path.join(frontendDist, "index.html");
    if (fs.existsSync(indexHtml)) {
      return reply.type("text/html").send(fs.readFileSync(indexHtml, "utf-8"));
    }
    const accessible = email
      ? await filterAccessibleBoxes({ boxes, email, ownerEmail: getOwnerEmail() })
      : boxes;
    return reply.type("text/html").send(renderPage(accessible));
  });
}
