/**
 * Root-level (non-box-scoped) routes and handlers for the web app server:
 * Chrome-extension CORS, /healthz, /api/build-info, /api/boxes, and the
 * SPA fallback / not-found handler. Split out of server.ts to keep that
 * file under its line budget.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { IncomingHttpHeaders } from "node:http";
import * as path from "node:path";
import * as fs from "node:fs";
import { isHubMode, resolveRequestIdentity, getOwnerEmail, verifyDiagBearerKey } from "./auth.js";
import { readVersionInfo } from "./trpc/routers/health.js";
import { transferEndpoint } from "../core/push-subscriptions.js";
import { z } from "zod";
import { listParkedTemplateUpdates } from "../core/install-template-file.js";
import { listSchemaLoadFailures } from "../schemas/schema-load-status.js";
import { loadBoxSchemas } from "../schemas/registry.js";
import { getEngineVersionReport } from "../core/engine-version.js";
import { filterAccessibleBoxes } from "./box-access.js";
import { readBoxIdentity } from "../core/landmark/box-identity.js";
import { stampBoxIdentity, documentBoxSlug } from "./index-html.js";
import { loginRedirect } from "./base-prefix.js";
import type { BoxSpec } from "./server-types.js";
import { buildCspPolicy, reportingEndpointsHeader, type CspMode } from "../lib/csp.js";
import { verifyMobileRequest } from "../core/mobile/request-auth.js";
import { verifyBrowseKey } from "../core/browse-key.js";

/** Body of `POST /api/push/resubscribe` — validated at the HTTP boundary. */
const resubscribeBodySchema = z.object({
  oldEndpoint: z.string().nullish(),
  subscription: z
    .object({
      endpoint: z.string().optional(),
      keys: z.object({ p256dh: z.string().optional(), auth: z.string().optional() }).optional(),
    })
    .optional(),
});

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

/**
 * One box as `/api/boxes` describes it: how to reach it, what to call it, and
 * the mark to show for it — all three from the box's own root landmark, so a
 * box looks like itself in the switcher and the selector, not just in its tab.
 */
export interface BoxListing {
  slug: string;
  name: string;
  /** Symbol text (emoji); empty when the box uses an image or has no mark. */
  symbol: string;
  /** Box-relative path to the symbol image, or null for a text symbol. */
  symbolSrc: string | null;
}

/**
 * Build the box list visible to the requesting user (auth-filtered) in the
 * `/api/boxes` response shape. Exported so the hub's own `/api/boxes`
 * (`src/hub/hub-server.ts`) returns the identical shape from the identical
 * filter, instead of a second copy that could drift.
 */
export async function listAccessibleBoxes(boxes: BoxSpec[], email: string): Promise<BoxListing[]> {
  const ownerEmail = getOwnerEmail();
  const accessible = await filterAccessibleBoxes({ boxes, email, ownerEmail });
  return describeBoxes(accessible);
}

/**
 * The `/api/boxes` shape for a set of boxes: each box's slug plus the display
 * name from its root landmark. Every listing goes through here so they can't
 * drift — this used to be five copies of `name: b.slug`, which is why the UI
 * showed a slug wherever a box was named.
 *
 * Names are read concurrently and each one degrades to the slug on its own,
 * so one unreadable box can't cost the others their names or fail the list.
 */
export async function describeBoxes(boxes: BoxSpec[]): Promise<BoxListing[]> {
  return Promise.all(
    boxes.map(async (b) => {
      const { name, symbol, symbolSrc } = await readBoxIdentity({ boxRoot: b.boxRoot, slug: b.slug });
      return { slug: b.slug, name, symbol, symbolSrc };
    }),
  );
}

/**
 * Register the root diagnostic/info endpoints: /healthz, /api/build-info,
 * and the auth-filtered /api/boxes listing.
 */
export function registerRootInfoRoutes(server: FastifyInstance, boxes: BoxSpec[]): void {
  // Server-wide healthz — for uptime monitors, deploy verification, etc.
  // Requires `Authorization: Bearer $BBX_DIAG_API_KEY` (same key used for
  // /api/debug-log and /api/trpc/health.check bypass). Returns minimal
  // server-level state — boxes have their own richer health endpoint at
  // /<box>/api/trpc/health.check that this does NOT roll up.
  server.get("/healthz", async (request, reply) => {
    if (!process.env.BBX_DIAG_API_KEY) {
      return reply.status(503).send({ status: "unconfigured", error: "BBX_DIAG_API_KEY not set" });
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
    // (same as `bbx status`) — box registration itself never calls it (only
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
    // Engine version per box: a v2 box pins its own beebox dependency,
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
      // Machine-visible open-access signal, alongside the UI banner — an
      // operator scraping /healthz can alarm on an accidentally open box.
      open: request.server.openAccess,
      boxCount: boxes.length,
      version,
      templateDrift: { total: templateDriftTotal, byBox },
      schemaLoadFailures: { total: schemaFailureTotal, byBox: schemaFailuresByBox },
      engineVersionMismatch: { total: Object.keys(engineMismatchByBox).length, byBox: engineMismatchByBox },
    };
  });

  // Build info — public but minimal: the deployed build hash + the open-mode
  // flag, nothing box- or runtime-detailed. This is an UNAUTHENTICATED endpoint
  // (a pre-auth "what's running here" probe), so it deliberately does not expose
  // the full deploy record or deploy history the way it once did; the rich
  // version detail lives behind auth in the `health.check` tRPC procedure.
  server.get("/api/build-info", async (request) => {
    const version = await readVersionInfo();
    const buildHash = version.commits["beebox"]?.hash ?? null;
    return { buildHash, open: request.server.openAccess };
  });

  // Web Push key rotation (pushsubscriptionchange). Root-level and box-agnostic:
  // the service worker controls the whole origin, and a subscription's endpoint
  // is server-wide, so we just transfer the old endpoint's box opt-ins to the
  // rotated one. Best-effort — the next page visit re-subscribes regardless.
  //
  // State-changing, so it sits BEHIND the auth wall: an unauthenticated caller
  // (no identity, and not open mode) gets 401. A logged-in service worker's
  // fetch rides the session cookie, so a real resubscribe still authenticates.
  server.post("/api/push/resubscribe", async (request, reply) => {
    const identity = resolveRequestIdentity(request, { openAccess: request.server.openAccess });
    if (identity.source === "unavailable") {
      return reply.status(503).send({ error: "Authentication temporarily unavailable" });
    }
    if (identity.source !== "open" && !identity.email) {
      return reply.status(401).send({ error: "Not authenticated" });
    }
    const parsedBody = resubscribeBodySchema.safeParse(request.body);
    const body = parsedBody.success ? parsedBody.data : undefined;
    const sub = body?.subscription;
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys.auth) {
      return reply.status(400).send({ error: "missing subscription" });
    }
    await transferEndpoint({
      oldEndpoint: body?.oldEndpoint ?? null,
      subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
      now: new Date(),
    });
    return { ok: true };
  });

  // Root-level box list endpoint (filtered by user access when auth required)
  server.get("/api/boxes", async (request, reply) => {
    if (!request.server.openAccess) {
      // The browse key already passes the box-scoped auth gate for every box
      // on this server (server-box-scope.ts), so listing them here grants
      // nothing new — without this branch the SPA's box resolution sees an
      // empty list and renders "Box not found" for a browse-key session.
      if (verifyBrowseKey(request.headers)) {
        return { boxes: await describeBoxes(boxes) };
      }
      const mobileBoxes = await listMobileAuthorizedBoxes({ boxes, headers: request.headers });
      if (mobileBoxes.length > 0) return { boxes: mobileBoxes };
      // Through the shared resolver (FIX 1): a corrupt store answers 503, and a
      // stale-`gen`/removed-user cookie resolves to no email → auth required.
      const identity = resolveRequestIdentity(request, { openAccess: request.server.openAccess });
      if (identity.source === "unavailable") {
        return reply.status(503).send({ error: "Authentication temporarily unavailable" });
      }
      // Fleet-wide open mode reaching a hub child (hub constructed with
      // openAccess, so it injects `x-bbx-hub-auth: off` → `source: "open"`): no
      // identity, but the whole fleet is open, so list every box rather than an
      // empty auth-required list. In standalone this branch is unreachable (the
      // outer `!request.server.openAccess` already handled open access).
      if (identity.source === "open") {
        return { boxes: await describeBoxes(boxes) };
      }
      if (!identity.email) {
        return { boxes: [], authRequired: true };
      }
      return { boxes: await listAccessibleBoxes(boxes, identity.email) };
    }
    return { boxes: await describeBoxes(boxes) };
  });
}

/**
 * Install the SPA fallback not-found handler: serves index.html for page
 * navigations, 404s for unmatched API/asset routes, and redirects to login
 * when auth is enabled and the user isn't signed in.
 */
export function registerSpaFallback(
  server: FastifyInstance,
  opts: { frontendPath: string; boxes: BoxSpec[] },
): void {
  /**
   * The document, with the box's own name and mark stamped in so a tab is
   * identifiable before React boots (`index-html.ts`). The box is the URL's
   * first segment; a URL that names no box (the root listing, `/auth/*`) is
   * served the built document unchanged, since there is no box to name.
   */
  const spaDocument = async (url: string): Promise<string> => {
    const html = fs.readFileSync(path.join(opts.frontendPath, "index.html"), "utf-8");
    const slug = documentBoxSlug(url, opts.boxes.map((b) => b.slug));
    const box = slug === null ? undefined : opts.boxes.find((b) => b.slug === slug);
    if (box === undefined) return html;
    return stampBoxIdentity(html, await readBoxIdentity({ boxRoot: box.boxRoot, slug: box.slug }));
  };

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

    // Auth wall: if auth is required (or this box is behind a hub) and the
    // user isn't identified, gate the navigation (except for root "/" which
    // shows its own login UI, and /auth/* routes). No `/share` carve-out —
    // there is no share feature in the tree, and an unused hole in the wall is
    // exactly the exception that outlives its rationale (always-on-auth plan).
    if ((!request.server.openAccess || isHubMode()) && url !== "/" && !url.startsWith("/auth/")) {
      // Browse-key sessions pass the box-scoped auth gate; a page navigation
      // that falls through to here must not bounce them to login.
      if (verifyBrowseKey(request.headers)) {
        return reply.type("text/html").send(await spaDocument(url));
      }
      const identity = resolveRequestIdentity(request, { openAccess: request.server.openAccess });
      if (identity.source === "unavailable") {
        // Credential store corrupt/unreadable: fail closed and distinctly (503),
        // never a login redirect that reads as "just sign in" (Track D).
        return reply.status(503).send({ error: "Authentication temporarily unavailable" });
      } else if (identity.source === "open") {
        // Hub-wide auth is off — fall through to the SPA below.
      } else if (!identity.email && !(await isMobileSpaRequest(request, opts.boxes))) {
        if (isHubMode()) {
          // See addBoxAuthHook's doc comment: a child never redirects to its
          // own /auth/login in hub mode — the hub gates navigation before
          // proxying, so reaching here unauthenticated means the request
          // bypassed the hub (spoof or misconfiguration).
          return reply.status(401).send({ error: "Not authenticated (hub mode)" });
        }
        return loginRedirect(request, reply);
      }
    }

    // SPA fallback: serve index.html
    return reply.type("text/html").send(await spaDocument(url));
  });
}

async function listMobileAuthorizedBoxes(opts: {
  boxes: BoxSpec[];
  headers: IncomingHttpHeaders;
}): Promise<BoxListing[]> {
  const checked = await Promise.all(
    opts.boxes.map(async (box) => ({ box, ok: await verifyMobileRequest(box.boxRoot, opts.headers) })),
  );
  return describeBoxes(checked.filter((c) => c.ok).map(({ box }) => box));
}

async function isMobileSpaRequest(request: FastifyRequest, boxes: BoxSpec[]): Promise<boolean> {
  const box = boxForUrl(request.url, boxes);
  if (!box) return false;
  return verifyMobileRequest(box.boxRoot, request.headers);
}

function boxForUrl(url: string, boxes: BoxSpec[]): BoxSpec | undefined {
  const pathname = url.split("?")[0] ?? "/";
  const slug = pathname.split("/")[1];
  return slug ? boxes.find((box) => box.slug === slug) : undefined;
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
  <title>Bee Box</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
    h1 { color: #333; }
    code { background: #f4f4f4; padding: 0.2rem 0.4rem; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>Bee Box</h1>
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
