/**
 * `cb hub`'s box picker (Track D, chunk D3 in
 * `docs/plans/boxes-as-packages-v2.md`): a minimal, dependency-free
 * server-rendered HTML page at `/` listing the boxes the authenticated
 * user can access. Auth-gated exactly like any HTML navigation through the
 * hub (`src/hub/hub-server.ts`'s proxy path) — but this route lives on the
 * hub's own Fastify instance, so it authenticates directly against the
 * session cookie (the hub is the one process that legitimately holds it),
 * not via the hub-injected headers a box would use.
 */

import type { FastifyInstance } from "fastify";
import { isAuthEnabled, getSessionUser, getOwnerEmail } from "../webapp/auth.js";
import { canAccessBox } from "../webapp/box-access.js";
import type { BoxSpec } from "../webapp/server-types.js";

function escapeHtml(value: string): string {
  const escapes: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/["&'<>]/g, (c) => escapes[c]!);
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
 * picker. Unauthenticated -> redirect to `/auth/login` (unless the hub has
 * no `GOOGLE_OAUTH_CLIENT_ID`, i.e. hub-wide auth is off, in which case
 * every configured box is listed — same "open" semantics the fleet's boxes
 * get via `x-cb-hub-auth: off`).
 */
export function registerBoxPicker(server: FastifyInstance, { boxes }: { boxes: BoxSpec[] }): void {
  server.get("/", async (request, reply) => {
    if (!isAuthEnabled()) {
      return reply.type("text/html").send(renderPage(boxes));
    }
    const user = getSessionUser(request);
    if (!user) {
      return reply.redirect(`/auth/login?returnTo=${encodeURIComponent(request.url)}`);
    }
    const ownerEmail = getOwnerEmail();
    const accessible: BoxSpec[] = [];
    for (const box of boxes) {
      if (await canAccessBox({ boxRoot: box.boxRoot, email: user.email, ownerEmail })) {
        accessible.push(box);
      }
    }
    return reply.type("text/html").send(renderPage(accessible));
  });
}
