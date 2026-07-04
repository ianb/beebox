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
import { listParkedTemplateUpdates } from "../core/install-template-file.js";
import { listSchemaLoadFailures } from "../schemas/schema-load-status.js";
import { loadBoxSchemas } from "../schemas/registry.js";
import { getEngineVersionReport } from "../core/engine-version.js";
import { loadBoxConfig } from "./box-config.js";
import type { BoxSpec } from "./server-types.js";
import { buildCspPolicy, reportingEndpointsHeader, type CspMode } from "../lib/csp.js";

const ASSET_EXTENSIONS = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map)$/i;

/**
 * Allow Chrome extension origins to make credentialed requests. Adds the
 * onSend CORS reflection hook and the preflight handler for /api/boxes.
 */
export function registerChromeExtensionCors(server: FastifyInstance): void {
  // Answer the browser's CORS preflight for extension-origin requests before
  // routing, so it short-circuits Fastify's auto-generated OPTIONS (which omits
  // the ACAO reflection). Needed for the extension's `application/json` POST to
  // the clerk tRPC procedures. Only fires for chrome-extension origins; every
  // other OPTIONS falls through to normal handling.
  server.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (request.method === "OPTIONS" && origin && origin.startsWith("chrome-extension://")) {
      return reply
        .header("Access-Control-Allow-Origin", origin)
        .header("Access-Control-Allow-Credentials", "true")
        .header("Vary", "Origin")
        .header("Access-Control-Allow-Headers", "Content-Type")
        .header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        .status(204)
        .send();
    }
  });

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

/**
 * Attach the Content-Security-Policy (Report-Only) and its companion
 * `Reporting-Endpoints` header to HTML document responses. Only documents carry
 * a CSP, so the hook keys on `text/html` and leaves API/asset/script responses
 * alone. It also yields to any route that already set a CSP — notably the frozen
 * captured-page route's strict `sandbox` policy — so that stays authoritative.
 *
 * `mode` selects the strict (prod) or relaxed (dev) script/style directives; in
 * practice prod is the only place Fastify serves HTML, but the param keeps the
 * choice explicit and testable. Report-Only never blocks a resource — promotion
 * to the enforcing header is a separate, gated step.
 */
export function registerCspReportingHeaders(
  server: FastifyInstance,
  { mode, reportPath }: { mode: CspMode; reportPath: string },
): void {
  const policy = buildCspPolicy({ mode, reportPath });
  const reportingEndpoints = reportingEndpointsHeader({ reportPath });
  // eslint-disable-next-line max-params -- Fastify onSend hook requires 4 params
  server.addHook("onSend", (_request, reply, payload, done) => {
    const contentType = String(reply.getHeader("content-type") ?? "");
    const alreadyHasCsp =
      reply.getHeader("content-security-policy") !== undefined ||
      reply.getHeader("content-security-policy-report-only") !== undefined;
    if (contentType.includes("text/html") && !alreadyHasCsp) {
      reply.header("Content-Security-Policy-Report-Only", policy);
      reply.header("Reporting-Endpoints", reportingEndpoints);
    }
    done(null, payload);
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
    // Template drift: stock templates whose upstream update is parked because
    // the box copy diverged. Surfaced here so an uptime monitor can alarm on
    // drift server-wide instead of it being found only by SSHing into a box.
    const byBox: Record<string, number> = {};
    let templateDriftTotal = 0;
    for (const box of boxes) {
      const parked = await listParkedTemplateUpdates(box.boxRoot);
      if (parked.length > 0) {
        byBox[box.slug] = parked.length;
        templateDriftTotal += parked.length;
      }
    }
    // Box-local schema load failures: keep-last-good means a broken save
    // doesn't blank the type, but the failure itself needs to be seen.
    // `loadBoxSchemas` populates the in-process failure map as a side effect
    // (same as `cb status`) — box registration itself never calls it (only
    // starts the schema *watcher*, which doesn't load), so without this a
    // fresh restart would report zero failures until unrelated card traffic
    // happened to trigger a load. Cheap after the first call: it's cached
    // per box and only re-scans a file whose content hash changed.
    const schemaFailuresByBox: Record<string, number> = {};
    let schemaFailureTotal = 0;
    for (const box of boxes) {
      await loadBoxSchemas(box.boxRoot);
      const failures = listSchemaLoadFailures(box.boxRoot);
      if (failures.length > 0) {
        schemaFailuresByBox[box.slug] = failures.length;
        schemaFailureTotal += failures.length;
      }
    }
    // Engine version per box: a v2 box pins its own callback-box dependency,
    // which can drift from the engine serving it (future-normal once the
    // hub serves per-box engines — Track D; for now just flagged, same
    // treatment as the drift signals above). Legacy boxes report nothing —
    // they have no separate installed engine.
    const engineMismatchByBox: Record<string, { serving: string | null; installed: string }> = {};
    for (const box of boxes) {
      const report = await getEngineVersionReport(box.boxRoot);
      if (report.mismatch && report.installed !== null) {
        engineMismatchByBox[box.slug] = { serving: report.serving, installed: report.installed };
      }
    }
    return {
      status: "ok",
      boxCount: boxes.length,
      version,
      templateDrift: { total: templateDriftTotal, byBox },
      schemaLoadFailures: { total: schemaFailureTotal, byBox: schemaFailuresByBox },
      engineVersionMismatch: { total: Object.keys(engineMismatchByBox).length, byBox: engineMismatchByBox },
    };
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
