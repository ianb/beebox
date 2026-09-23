/**
 * Web app server - combined frontend + runner
 *
 * Supports serving multiple boxes, each at its own URL prefix (slug).
 */

import Fastify, { type FastifyInstance, type FastifyError } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCookie from "@fastify/cookie";
import { registerBoxAdmission, boxRequestsAreIdle } from "./box-admission.js";
import * as path from "node:path";
import * as fs from "node:fs";
import { createEventBus } from "../core/event-bus.js";
import { registerAuthSurface } from "./routes/auth.js";
import { registerGoogleServicesCallback } from "./routes/admin.js";
import { isHubMode } from "./auth.js";
import { maybeArmFirstRunSetup } from "./setup-token.js";
import { registerBoxPublicUrl } from "../core/script-env.js";
import { removeServeEndpoint, writeServeEndpoint } from "../core/serve-endpoint.js";
import { getPublicUrl } from "../lib/public-url.js";
import { PACKAGE_ROOT } from "../lib/package-root.js";
import { sweepStaleIndexLock } from "../lib/git-stale-lock.js";
import { drainBoxGitLocks, GIT_DRAIN_MS } from "../lib/git-lock.js";
import type { InternalServerOptions } from "./server-types.js";
import { resolveBoxes, killPreviousServer } from "./server-lifecycle.js";
import { registerBox } from "./server-box-scope.js";
import {
  registerChromeExtensionCors,
  registerCspReportingHeaders,
  registerRootInfoRoutes,
  registerSpaFallback,
  registerUnbuiltFrontendRoot,
} from "./server-root.js";
import { registerCspReportRoute } from "./routes/api-csp-report.js";
import { HASHED_ASSET_CACHE_OPTIONS } from "./static-cache.js";
import { invariant } from "../lib/invariant.js";
import { PROD_CSP_REPORT_PATH } from "../lib/csp.js";
import {
  DEV_BUNDLE_RELOAD_EXIT_CODE,
  abandonDevBundleDrain,
  devBundleWasReplaced,
  DEV_BUNDLE_RELOAD_REQUEST,
  DEV_BUNDLE_RELOAD_NOW,
  DEV_BUNDLE_RELOAD_ABORTED,
} from "../lib/dev-bundle-reload.js";
import { pauseBoxChatSchedules, resumeBoxChatSchedules, boxChatScheduleDeliveriesAreIdle } from "../core/chat/schedules.js";
import { quiesceChatThreads, chatThreadsAreIdle } from "../core/chat/session/thread.js";
import { getChatRuntime } from "./chat-runtime.js";
import { acquireBoxStartup, boxMaintenanceStatus, withoutBoxWork, type BoxWork } from "../lib/box-maintenance.js";


export type { BoxSpec, ServerOptions, ServerContext } from "./server-types.js";

export const DEFAULT_PORT = 3210;

/**
 * Thrown when something tries to make an `openAccess` (auth-bypassing) server
 * bind a listening socket. Open access is a test-only construction mode
 * (`.inject()`-based tests) and must never be reachable over the network.
 */
export class OpenAccessListenError extends Error {
  constructor() {
    super(
      "open access is a test-only construction mode and must never listen; " +
        "if you meant to run a server, remove openAccess (auth is always on)",
    );
    this.name = "OpenAccessListenError";
  }
}

/**
 * Guard the one code path that binds a listening socket. `startServer` calls
 * this before doing any work: an `openAccess` server bypasses the auth wall and
 * exists only as a `createServer`/test-helper construction seam, so it must
 * never listen. `openAccess` is absent from the public `ServerOptions` type,
 * but a runtime (untyped) caller could still smuggle it in — hence the check.
 * `.inject()` doesn't go through here, so injected open-access tests are
 * unaffected.
 */
export function assertOpenAccessNotListening(options: InternalServerOptions): void {
  if (options.openAccess === true) {
    throw new OpenAccessListenError();
  }
}

/**
 * Create and configure the Fastify server.
 */
export async function createServer(options?: InternalServerOptions, startup?: ReadonlyMap<string, BoxWork>): Promise<FastifyInstance> {
  options = options ?? {};
  const boxes = await resolveBoxes(options);

  const server = Fastify({
    logger: {
      level: "warn",
    },
    trustProxy: true,
    // tRPC batch requests encode multiple procedure names in the URL path,
    // which can exceed Fastify's default 100-char param length limit.
    routerOptions: { maxParamLength: 500 },
    // Raise the JSON body limit well above Fastify's 1 MB default: the clerk
    // extension POSTs frozen web-page snapshots (single-file HTML with inlined
    // CSS/images) that routinely exceed 1 MB. At the default, those 413'd and
    // the capture silently saved nothing. Matches the 50 MB multipart cap.
    bodyLimit: 50 * 1024 * 1024,
  });

  // Whether this box serves without an authentication wall. Decorated onto the
  // instance (inherited by every encapsulated box scope) so the auth resolver
  // and route gates consult a per-instance flag instead of the environment. No
  // CLI path sets it — only test-constructed servers (`openAccess: true`).
  server.decorate("openAccess", options.openAccess ?? false);

  // Error boundary for raw (non-tRPC) routes. Without this, an uncaught
  // error in a route handler leaves no server-side trace at all — the raw
  // routes have no protocol-level hook the way tRPC's `onError` does (see
  // server-box-scope.ts, whose comment documents a "Duplicate id N" bug
  // that hid for days for exactly this reason). Always log with enough
  // context to find the request; only echo the error message back to the
  // client for expected (4xx) failures — a 5xx body stays generic so an
  // unexpected internal error doesn't leak implementation detail.
  // eslint-disable-next-line max-params -- Fastify's setErrorHandler callback signature is (error, request, reply)
  server.setErrorHandler<FastifyError>((error, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    // A fetch that never got a response says only "fetch failed"; the reason
    // (ENOTFOUND, ECONNRESET, a certificate) rides in `cause`, and a log line
    // without it cannot be acted on (a TTS 500 on 2026-09-08 read that way).
    const cause = error.cause instanceof Error ? ` — cause: ${error.cause.message}` : "";
    console.error(`[http] ${request.method} ${request.url} failed (${statusCode}): ${error.message}${cause}`);
    reply.status(statusCode).send({
      error: statusCode < 500 ? error.message : "Internal server error",
    });
  });

  registerChromeExtensionCors(server);

  registerBoxAdmission(server, boxes);

  // Attach the Content-Security-Policy (Report-Only) + Reporting-Endpoints
  // headers to HTML document responses. Registered early so its onSend runs on
  // every response; it yields to routes that set their own CSP (frozen pages).
  // Fastify serves the built frontend, so it always uses the production
  // policy. Vite owns the relaxed development policy for its HMR HTML. The
  // report route is root-level (PROD_CSP_REPORT_PATH).
  registerCspReportingHeaders(server, {
    mode: "prod",
    reportPath: PROD_CSP_REPORT_PATH,
  });

  // Register cookie support (used for auth sessions)
  await server.register(fastifyCookie);

  // Register multipart for file uploads
  await server.register(fastifyMultipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB max for audio files
    },
  });

  // Register WebSocket support (used by realtime transcription proxy)
  await server.register(fastifyWebsocket);

  // Register the login surface (login, callback, logout, me) — UNLESS this
  // box is running behind a hub, in which case the hub owns login (Track D,
  // chunk D2) and the box's own /auth/* is dead surface: 404, not a stub,
  // since a child never redirects to its own /auth/login in hub mode (see
  // server-box-scope.ts's addBoxAuthHook). This wildcard is registered
  // BEFORE the Google-services callback below on purpose to document intent
  // (login is dead here), but it doesn't actually shadow that static route —
  // Fastify's router (find-my-way) always prefers a static route over a
  // wildcard regardless of registration order, so `/auth/google-services
  // /callback` still reaches its handler even in hub mode: the hub proxies
  // that one path straight through to this box (see `src/hub/hub-server.ts`)
  // because it's the box's own connector setup, not login.
  if (isHubMode()) {
    server.all("/auth/*", async (_request, reply) => {
      return reply.status(404).send({
        error: "not_found",
        message: "This box is served behind a hub; login lives at the hub, not this box.",
      });
    });
  } else {
    await registerAuthSurface(server, { boxes });
  }
  // Root-level Google Services OAuth callback (single redirect URI for all boxes)
  await server.register(async (instance) => {
    await registerGoogleServicesCallback(instance, { boxes });
  });

  registerRootInfoRoutes(server, boxes);

  // CSP violation report sink. The report-uri/report-to directives point here.
  // Root-level (a report has no box context); stored under the primary box for
  // lack of a server-level state dir. No-op if no boxes are mounted.
  if (boxes.length > 0) {
    const firstBox = boxes[0];
    invariant(firstBox !== undefined, "boxes.length > 0 was just checked");
    registerCspReportRoute({ server, logDir: firstBox.boxRoot });
  }

  // Resolve from the package root (bundle-safe) rather than a fixed depth off
  // import.meta.dirname: the prod bundle lives at dist/cli.mjs (one level down)
  // while tsx runs this from src/webapp/ (two levels), so a hardcoded `../..`
  // overshoots under the bundle and the frontend silently never loads.
  // (A test overrides this with `frontendPath` so it doesn't depend on whether
  // the checkout has run a frontend build — see server-types.ts.)
  const frontendPath = options.frontendPath ?? path.join(PACKAGE_ROOT, "src/frontend/dist");
  const frontendExists = fs.existsSync(path.join(frontendPath, "index.html"));

  // Serve static frontend assets at root level (for the box selector page at /)
  if (frontendExists) {
    await server.register(fastifyStatic, {
      root: frontendPath,
      prefix: "/",
      wildcard: true,
    });
    // `/assets/*` gets its own registration so the content-hashed bundles can
    // carry the year-long immutable policy while index.html / sw.js / icons /
    // manifest keep revalidating (static-cache.ts). find-my-way matches the
    // more specific `/assets/*` over the catch-all `/*` above regardless of
    // registration order. It must come SECOND: @fastify/static's
    // `reply.sendFile` decorator is installed by the FIRST registration and
    // carries that registration's cache options, so an immutable mount landing
    // first would silently make every later `sendFile` immutable too.
    const assetsRoot = path.join(frontendPath, "assets");
    if (fs.existsSync(assetsRoot)) {
      await server.register(fastifyStatic, {
        root: assetsRoot,
        prefix: "/assets/",
        decorateReply: false,
        ...HASHED_ASSET_CACHE_OPTIONS,
      });
    }
  }

  // Register each box under its slug prefix
  for (const box of boxes) {
    // One EventBus per box — shared by main routes and webhook routes. A test
    // may inject its own instance (so it can subscribe to the same in-memory
    // bus the routes emit on); production always mints one here.
    const eventBus = box.eventBus ?? createEventBus(box.boxRoot, { pollInterval: 1000 });
    eventBus.prune(new Date(Date.now() - 24 * 60 * 60 * 1000));

    const register = () => registerBox(server, { box, eventBus, options, frontendPath, frontendExists });
    const lease = startup?.get(box.boxRoot);
    if (lease) await lease.run(register); else await register();
  }

  if (frontendExists) {
    // SPA fallback — serve index.html for non-API, non-asset routes
    registerSpaFallback(server, { frontendPath, boxes });
  } else {
    // Root redirect when frontend not built
    registerUnbuiltFrontendRoot(server, boxes);
  }

  return server;
}

/**
 * Start the server.
 */
export async function startServer(options?: InternalServerOptions): Promise<void> {
  options = options ?? {};
  // Fail closed before any side effects: an open-access server is non-listenable
  // (auth is bypassed only for `.inject()` tests). Guarded here rather than at
  // the socket bind so a smuggled `openAccess: true` never kills the previous
  // server or writes a pid file.
  assertOpenAccessNotListening(options);
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? "localhost";

  // First-run setup: with auth required and zero local users, arm a one-time
  // setup token and print its claim link. No-op once a user exists. Auth is
  // always on here (open access can't reach this path — guarded above), so
  // `openAccess: false`. (At listen time — never at createServer, so injected
  // test servers stay quiet.)
  maybeArmFirstRunSetup({ publicUrl: getPublicUrl(`http://${host}:${port}`), openAccess: false });

  const boxes = await resolveBoxes(options);

  const startup = new Map<string, BoxWork>();
  try {
    for (const box of boxes) startup.set(box.boxRoot, await acquireBoxStartup(box.boxRoot));
  } catch (error) {
    for (const lease of startup.values()) await lease.release();
    throw error;
  }

  // Kill previous server for each box
  for (const box of boxes) {
    const pidFile = path.join(box.boxRoot, ".bbx-serve.pid");
    await killPreviousServer(pidFile);
  }

  // Reclaim an abandoned `.git/index.lock` before serving. A box whose git
  // was SIGKILLed mid-write cannot commit anything at all, and startup is the
  // one moment we know no write of ours is in flight — the same habit the dev
  // router has of reclaiming orphaned state on start. Best-effort and never
  // fatal: a box that cannot commit should still serve reads.
  for (const box of boxes) {
    await sweepStaleIndexLock(box.boxRoot);
  }

  let server: FastifyInstance;
  try {
    server = await createServer({ ...options, boxes }, startup);
    await server.ready();
    for (const box of boxes) await getChatRuntime(box.boxRoot)?.maintenance;
  } catch (error) {
    for (const lease of startup.values()) await lease.release();
    throw error;
  }

  // Write PID file to each box
  const pidFiles: string[] = [];
  for (const box of boxes) {
    const pidFile = path.join(box.boxRoot, ".bbx-serve.pid");
    await fs.promises.writeFile(pidFile, String(process.pid));
    pidFiles.push(pidFile);
  }

  let maintenanceCheck: ReturnType<typeof setInterval> | undefined;

  // Shutdown handler — force-close all connections immediately so
  // --watch restarts don't hang on open WebSocket sockets.
  const shutdown = async (signal: string, exitCode?: number) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    clearInterval(maintenanceCheck);
    for (const pf of pidFiles) {
      await fs.promises.unlink(pf).catch(() => {});
    }
    for (const box of boxes) await removeServeEndpoint(box.boxRoot);
    server.server.closeAllConnections();
    await server.close();
    // Let any git write we started finish before we go. Exiting on top of one
    // orphans it into whatever SIGKILL follows (the hub's escalation, or
    // systemd's cgroup teardown), and a git killed mid-index-write leaves a
    // `.git/index.lock` that blocks every writer in the box until a human
    // removes it. Bounded — a stuck span must not hold the process open.
    if (!(await drainBoxGitLocks(GIT_DRAIN_MS))) {
      console.warn("Git writes were still in flight at shutdown; exiting anyway.");
    }
    console.log("Server closed.");
    process.exit(exitCode ?? 0);
  };

  // Fire-and-forget shutdown: signal handlers and the orphan-detection timer
  // are sync callbacks and can't await it. A failure here means the process
  // is already exiting one way or another, but log it and force-exit rather
  // than let it become a silent unhandled rejection. Idempotent: a second
  // signal while the first shutdown is in flight (e.g. SIGTERM then SIGHUP,
  // or a repeated Ctrl-C) must not start an overlapping shutdown whose
  // double server.close() would reject and turn a graceful exit into
  // exit(1).
  let shuttingDown = false;
  const fireShutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    void shutdown(signal).catch((err: unknown) => {
      console.error(`Shutdown (${signal}) failed:`, err);
      process.exit(1);
    });
  };

  // Handle termination signals
  process.on("SIGINT", () => fireShutdown("SIGINT"));
  process.on("SIGTERM", () => fireShutdown("SIGTERM"));
  process.on("SIGHUP", () => fireShutdown("SIGHUP"));

  try {
    // Publish HTTP readiness only after startup has relinquished its work.
    for (const lease of startup.values()) await lease.release();
    await withoutBoxWork(() => server.listen({ port, host }));
    // Register live public URLs for each served box so subprocess spawns
    // pick up BBX_BOX_NAME / BBX_SERVER_URL via buildScriptEnv without
    // requiring publicUrl to be set in _config/box.json.
    for (const box of boxes) {
      const publicUrl = `http://${host}:${port}/${box.slug}`;
      await writeServeEndpoint(box.boxRoot, { pid: process.pid, publicUrl });
      registerBoxPublicUrl(box.boxRoot, publicUrl);
    }
    console.log(`Server running at http://${host}:${port}`);
    for (const box of boxes) {
      console.log(`  ${box.slug}: http://${host}:${port}/${box.slug}/`);
    }

    // The same poll quiesces chat for CLI maintenance and supervised reload.
    // The supervisor owns reload admission across both child generations.
    const paused = new Set<string>();
    let checking = false;
    let reloadRequested = false;
    let warned = false;
    process.on("message", (message: unknown) => {
      if (typeof message !== "object" || message === null || !("type" in message)) return;
      if (message.type === DEV_BUNDLE_RELOAD_NOW && reloadRequested && !shuttingDown) {
        shuttingDown = true;
        void shutdown("development bundle reload", DEV_BUNDLE_RELOAD_EXIT_CODE).catch((error: unknown) => {
          console.error("Development bundle reload shutdown failed:", error);
          process.exit(1);
        });
      } else if (message.type === DEV_BUNDLE_RELOAD_ABORTED) {
        void abandonDevBundleDrain().then(() => { reloadRequested = false; });
      }
    });
    maintenanceCheck = setInterval(() => {
      if (checking || shuttingDown) return;
      checking = true;
      void withoutBoxWork(async () => {
        for (const box of boxes) {
          const runtime = getChatRuntime(box.boxRoot);
          if (!runtime) continue;
          // Only a live owner pauses chat; a record without one is unfinished maintenance, not closure.
          if ((await boxMaintenanceStatus(box.boxRoot))?.owner) {
            pauseBoxChatSchedules(box.boxRoot);
            paused.add(box.boxRoot);
            if (boxRequestsAreIdle(box.boxRoot) && !runtime.registry.snapshotAll().some((session) => session.busy) && chatThreadsAreIdle(box.boxRoot) && boxChatScheduleDeliveriesAreIdle(box.boxRoot)) {
              runtime.registry.quiesceForMaintenance();
              quiesceChatThreads(box.boxRoot);
            }
          } else if (paused.delete(box.boxRoot)) {
            runtime.registry.resumeAfterMaintenance();
            resumeBoxChatSchedules(box.boxRoot);
          }
        }
        if (reloadRequested || warned || !(await devBundleWasReplaced())) return;
        if (isHubMode() && process.send) {
          reloadRequested = true;
          process.send({ type: DEV_BUNDLE_RELOAD_REQUEST });
        } else {
          warned = true;
          console.warn("Development bundle changed. Restart this standalone `bbx serve` process to load it safely.");
        }
      }).catch((error: unknown) => console.error("Box maintenance check failed:", error)).finally(() => { checking = false; });
    }, 1000);
    maintenanceCheck.unref();

  } catch (err) {
    for (const lease of startup.values()) await lease.release();
    for (const pf of pidFiles) {
      await fs.promises.unlink(pf).catch(() => {});
    }
    server.log.error(err);
    process.exit(1);
  }

  // Orphan detection: if our parent process dies (ppid becomes 1),
  // shut down gracefully instead of becoming a zombie.
  const initialPpid = process.ppid;
  if (initialPpid !== 1) {
    const orphanCheck = setInterval(() => {
      if (process.ppid !== initialPpid) {
        console.log(`Parent process died (was ${initialPpid}, now ${process.ppid}), shutting down.`);
        clearInterval(orphanCheck);
        fireShutdown("orphan-detection");
      }
    }, 2000);
    orphanCheck.unref();
  }
}
