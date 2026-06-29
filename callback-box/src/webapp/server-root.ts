/**
 * Root-level (non-box-scoped) routes and handlers for the web app server:
 * Chrome-extension CORS, /healthz, /api/build-info, /api/boxes, and the
 * SPA fallback / not-found handler. Split out of server.ts to keep that
 * file under its line budget.
 */

import type { FastifyInstance } from "fastify";
import * as path from "node:path";
import * as fs from "node:fs";
import { PACKAGE_ROOT } from "../lib/package-root.js";
import { isAuthEnabled, getSessionEmail, getOwnerEmail, verifyDiagBearerKey } from "./auth.js";
import { readVersionInfo } from "./trpc/routers/health.js";
import { loadBoxConfig } from "./box-config.js";
import { transferEndpoint } from "../core/push-subscriptions.js";
import type { BoxSpec } from "./server-types.js";

const ASSET_EXTENSIONS = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map)$/i;

/**
 * Allow Chrome extension origins to make credentialed requests. Adds the
 * onSend CORS reflection hook and the preflight handler for /api/boxes.
 */
export function registerChromeExtensionCors(server: FastifyInstance): void {
  // eslint-disable-next-line max-params -- Fastify onSend hook requires 4 params
  server.addHook("onSend", (request, reply, payload, done) => {
    const origin = request.headers.origin;
    if (origin && origin.startsWith("chrome-extension://")) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Access-Control-Allow-Credentials", "true");
      reply.header("Vary", "Origin");
    }
    done(null, payload);
  });

  server.options("/api/boxes", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && origin.startsWith("chrome-extension://")) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Access-Control-Allow-Credentials", "true");
      reply.header("Access-Control-Allow-Headers", "Content-Type");
    }
    return reply
      .header("Access-Control-Allow-Methods", "GET,OPTIONS")
      .send();
  });
}

/** Build the box list visible to the requesting user (auth-filtered). */
async function listAccessibleBoxes(boxes: BoxSpec[], email: string): Promise<Array<{ slug: string; name: string }>> {
  const ownerEmail = getOwnerEmail();
  const accessible: Array<{ slug: string; name: string }> = [];
  for (const b of boxes) {
    if (email === ownerEmail) {
      accessible.push({ slug: b.slug, name: b.slug });
      continue;
    }
    const config = await loadBoxConfig(b.boxRoot);
    // Only show boxes where user is explicitly allowed
    if (config.allowedEmails?.length && config.allowedEmails.includes(email)) {
      accessible.push({ slug: b.slug, name: b.slug });
    }
  }
  return accessible;
}

/**
 * Register the root diagnostic/info endpoints: /healthz, /api/build-info,
 * and the auth-filtered /api/boxes listing.
 */
export function registerRootInfoRoutes(server: FastifyInstance, boxes: BoxSpec[]): void {
  // Server-wide healthz — for uptime monitors, deploy verification, etc.
  // Requires `Authorization: Bearer $CB_DIAG_API_KEY` (same key used for
  // /api/debug-log and /api/trpc/health.check bypass). Returns minimal
  // server-level state — boxes have their own richer health endpoint at
  // /<box>/api/trpc/health.check that this does NOT roll up.
  server.get("/healthz", async (request, reply) => {
    if (!process.env.CB_DIAG_API_KEY) {
      return reply.status(503).send({ status: "unconfigured", error: "CB_DIAG_API_KEY not set" });
    }
    if (!verifyDiagBearerKey(request)) {
      return reply.status(401).send({ status: "unauthorized" });
    }
    const version = await readVersionInfo();
    return { status: "ok", boxCount: boxes.length, version };
  });

  // Build info — written by deploy.sh, shows what's deployed
  const deployInfoDir = PACKAGE_ROOT;
  server.get("/api/build-info", async () => {
    try {
      const raw = fs.readFileSync(path.join(deployInfoDir, "deploy-info.json"), "utf-8");
      const current = JSON.parse(raw);
      let history: unknown[] = [];
      try {
        history = JSON.parse(fs.readFileSync(path.join(deployInfoDir, "deploy-history.json"), "utf-8"));
      } catch (_e) { /* no history yet */ }
      return { current, history };
    } catch (_e) {
      return { error: "No deploy info available" };
    }
  });

  // Web Push key rotation (pushsubscriptionchange). Root-level and box-agnostic:
  // the service worker controls the whole origin, and a subscription's endpoint
  // is server-wide, so we just transfer the old endpoint's box opt-ins to the
  // rotated one. Best-effort — the next page visit re-subscribes regardless.
  server.post("/api/push/resubscribe", async (request, reply) => {
    const body = request.body as {
      oldEndpoint?: string | null;
      subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    } | undefined;
    const sub = body?.subscription;
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      return reply.status(400).send({ error: "missing subscription" });
    }
    await transferEndpoint({
      oldEndpoint: body?.oldEndpoint ?? null,
      subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
      now: new Date(),
    });
    return { ok: true };
  });

  // Root-level box list endpoint (filtered by user access when auth enabled)
  server.get("/api/boxes", async (request) => {
    if (isAuthEnabled()) {
      const email = getSessionEmail(request);
      if (!email) {
        return { boxes: [], authRequired: true };
      }
      return { boxes: await listAccessibleBoxes(boxes, email) };
    }
    return { boxes: boxes.map((b) => ({ slug: b.slug, name: b.slug })) };
  });
}

/**
 * Install the SPA fallback not-found handler: serves index.html for page
 * navigations, 404s for unmatched API/asset routes, and redirects to login
 * when auth is enabled and the user isn't signed in.
 */
export function registerSpaFallback(server: FastifyInstance, frontendPath: string): void {
  server.setNotFoundHandler(async (request, reply) => {
    const url = request.url;

    // Don't serve index.html for root-level API
    if (url === "/api/boxes") {
      return reply.status(404).send({ error: "Not found" });
    }

    // Check if this looks like a static asset request
    if (ASSET_EXTENSIONS.test(url)) {
      return reply.status(404).send({ error: "Not found" });
    }

    // For API routes under box slugs that weren't matched
    if (/^\/[^/]+\/api\//.test(url)) {
      return reply.status(404).send({ error: "Not found" });
    }

    // Auth wall: if auth is enabled and user isn't logged in, redirect to login
    // (except for root "/" which shows its own login UI, and /auth/* routes)
    if (isAuthEnabled() && url !== "/" && !url.startsWith("/auth/") && !url.startsWith("/share")) {
      const email = getSessionEmail(request);
      if (!email) {
        return reply.redirect(`/auth/login?returnTo=${encodeURIComponent(url)}`);
      }
    }

    // SPA fallback: serve index.html
    return reply.type("text/html").send(
      fs.readFileSync(path.join(frontendPath, "index.html"), "utf-8")
    );
  });
}

/**
 * Install the root landing page shown when the frontend bundle isn't built —
 * a minimal HTML listing of the served boxes.
 */
export function registerUnbuiltFrontendRoot(server: FastifyInstance, boxes: BoxSpec[]): void {
  server.get("/", async (_request, reply) => {
    return reply.type("text/html").send(`
<!DOCTYPE html>
<html>
<head>
  <title>Callback Box</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
    h1 { color: #333; }
    code { background: #f4f4f4; padding: 0.2rem 0.4rem; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>Callback Box</h1>
  <p>The frontend is not built yet. Run <code>pnpm build:frontend</code> to build it.</p>
  <h2>Boxes</h2>
  <ul>
    ${boxes.map((b) => `<li><a href="/${b.slug}/">${b.slug}</a> — ${b.boxRoot}</li>`).join("\n    ")}
  </ul>
</body>
</html>
      `);
  });
}
