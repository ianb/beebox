// The router's per-request dispatch, downstream of the single auth gate: the
// `/__router/*` control routes, the router-owned root surfaces (the worktree
// index, the workstreams app, the favicon), and everything under a worktree
// prefix (its /dev/ space, its /site/ build, and the proxied worktree itself).
//
// Split out of router.ts, which now owns the server, the gate wiring, and the
// boot sequence. Nothing here authenticates — a denied request never reaches
// this module.

import type http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import type { RouterAuthDecision } from "./router-auth.js";
import { mobileBootstrapTarget } from "./router-mobile-bootstrap.js";
import { serveDev } from "./router-docs.js";
import { serveSite } from "./router-site.js";
import type { WorkstreamsAppSupervisor } from "./workstreams-app-supervisor.js";
import { readyLifecycle, failedLifecycle, type WorktreeHandle } from "./router-lifecycle.js";
import type { RouterCore } from "./router-core.js";
import { errMessage, httpStatusOf } from "./router-effects.js";
import { proxyWithRetry, proxyWorkstreamsAppOnce } from "./router-proxy.js";
import {
  renderFailedPage,
  renderIndex,
  renderStatusJson,
  renderWorkstreamsAppFallback,
} from "./router-pages.js";
import {
  REPO_ROOT,
  parseWorktreeName,
  worktreeRoot,
} from "./router-config.js";

/** The resident workstreams app, when the router is running one. */
export interface WorkstreamsAppMount {
  supervisor: WorkstreamsAppSupervisor;
  displayLogPath: string;
}

/** What every dispatch stage needs: the lifecycle core and the resident app. */
export interface DispatchContext {
  core: RouterCore;
  workstreamsApp: WorkstreamsAppMount | undefined;
}

async function handleStatusRoute(
  ctx: DispatchContext,
  { res, url }: { res: http.ServerResponse; url: string },
): Promise<boolean> {
  if (url !== "/__router/status" && url !== "/__router/status/") return false;
  res.writeHead(200, { "content-type": "application/json" });
  res.end(await renderStatusJson(ctx.core, { workstreamsApp: ctx.workstreamsApp?.supervisor.state() }));
  return true;
}

async function handleControlRoutes(
  ctx: DispatchContext,
  { req, res, url }: { req: http.IncomingMessage; res: http.ServerResponse; url: string },
): Promise<boolean> {
  const { core, workstreamsApp } = ctx;
  if (url === "/__router/retry/workstreams-app" || url === "/__router/retry/workstreams-app/") {
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "text/plain", allow: "POST" });
      res.end("retry requires POST\n");
      return true;
    }
    if (!workstreamsApp) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("workstreams app is disabled\n");
      return true;
    }
    await workstreamsApp.supervisor.retry();
    res.writeHead(303, { location: "/workstreams/" });
    res.end();
    return true;
  }

  if (url.startsWith("/__router/retry/")) {
    const name = url.slice("/__router/retry/".length).replace(/\/$/, "");
    if (!name) {
      res.writeHead(400);
      res.end("missing worktree name");
      return true;
    }
    // POST-only — a GET probe (e.g. a curl with no -X) shouldn't have a side
    // effect. The failure page's retry button POSTs.
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "text/plain", allow: "POST" });
      res.end("retry requires POST\n");
      return true;
    }
    // Clear any failed-state entry so ensureRunning will spawn a fresh attempt
    // rather than re-throwing the cached error.
    core.clearFailed(name);
    res.writeHead(303, { location: `/${name}/` });
    res.end();
    return true;
  }

  if (url.startsWith("/__router/stop/")) {
    const name = url.slice("/__router/stop/".length).replace(/\/$/, "");
    if (!name) {
      res.writeHead(400);
      res.end("missing worktree name");
      return true;
    }
    // POST-only — same reasoning as retry: a GET (curl without -X, a link
    // prefetcher, a crawler) must not kill a running worktree.
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "text/plain", allow: "POST" });
      res.end("stop requires POST\n");
      return true;
    }
    await core.stopWorktree(name);
    const wantsHtml = (req.headers.accept ?? "").includes("text/html");
    if (wantsHtml) {
      res.writeHead(303, { location: "/" });
      res.end();
      return true;
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(`stopped ${name}\n`);
    return true;
  }

  if (url.startsWith("/__router/dashboard/")) {
    const name = url.slice("/__router/dashboard/".length).replace(/\/$/, "");
    if (!name) {
      res.writeHead(400);
      res.end("missing worktree name");
      return true;
    }
    let handle: WorktreeHandle;
    try {
      handle = await core.ensureRunning(name);
    } catch (err) {
      res.writeHead(httpStatusOf(err) ?? 502, { "content-type": "text/plain" });
      res.end(`Failed to start worktree ${name}: ${errMessage(err)}\n`);
      return true;
    }
    const dashboardUrl = readyLifecycle(handle)?.dashboardUrl ?? null;
    if (!dashboardUrl) {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(
        `Worktree ${name} is running but its dashboard failed to start. See logs at ~/.cache/callback-box/logs/${name}.log\n`,
      );
      return true;
    }
    res.writeHead(302, { location: dashboardUrl });
    res.end();
    return true;
  }
  return false;
}

async function handleRootRoutes(
  ctx: DispatchContext,
  { req, res, url }: { req: http.IncomingMessage; res: http.ServerResponse; url: string },
): Promise<boolean> {
  const { core, workstreamsApp } = ctx;
  if (url === "/" || url === "") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(await renderIndex(core));
    return true;
  }

  const requestPathname = url.split("?")[0] ?? url;
  if (requestPathname === "/workstreams" || requestPathname.startsWith("/workstreams/")) {
    if (requestPathname === "/workstreams") {
      res.writeHead(301, { location: `/workstreams/${url.includes("?") ? url.slice(url.indexOf("?")) : ""}` });
      res.end();
      return true;
    }
    if (workstreamsApp) {
      const target = workstreamsApp.supervisor.targetFor(url);
      if (!target) {
        const appState = workstreamsApp.supervisor.state();
        const wantsJson = requestPathname.startsWith("/workstreams/api/") ||
          requestPathname.startsWith("/workstreams/__internal/");
        res.writeHead(503, {
          "content-type": wantsJson ? "application/json; charset=utf-8" : "text/html; charset=utf-8",
          "retry-after": "2",
        });
        if (req.method === "HEAD") {
          res.end();
        } else if (wantsJson) {
          res.end(`${JSON.stringify({ error: "workstreams-app-unavailable", phase: appState.phase })}\n`);
        } else {
          res.end(renderWorkstreamsAppFallback(appState, workstreamsApp.displayLogPath));
        }
        return true;
      }
      const proxyError = await proxyWorkstreamsAppOnce(req, { res, target });
      if (proxyError && !res.headersSent) {
        res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
        res.end(`Workstreams app proxy failed: ${proxyError.message}\n`);
      }
      return true;
    }
    res.writeHead(503, {
      "content-type": "text/plain; charset=utf-8",
      "retry-after": "2",
    });
    res.end("Workstreams app supervisor is unavailable. Restart the router.\n");
    return true;
  }

  if (url === "/favicon.png" || url === "/favicon.ico") {
    try {
      const buf = await fs.readFile(path.join(REPO_ROOT, "bin", "assets", "favicon.png"));
      res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=86400" });
      res.end(buf);
    } catch (err) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end(`favicon not found: ${errMessage(err)}\n`);
    }
    return true;
  }

  // Bare /dev → the main checkout's dev space (it's per-worktree; default main).
  if (url.split("?")[0] === "/dev" || url.split("?")[0] === "/dev/") {
    res.writeHead(301, { location: "/main/dev/" });
    res.end();
    return true;
  }
  return false;
}

async function handleWorktreeRoutes(
  ctx: DispatchContext,
  {
    req,
    res,
    url,
    decision,
  }: {
    req: http.IncomingMessage;
    res: http.ServerResponse;
    url: string;
    decision: RouterAuthDecision & { allow: true };
  },
): Promise<void> {
  const { core } = ctx;
  const name = parseWorktreeName(url);
  if (!name) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("no worktree in path\n");
    return;
  }

  if (url === `/${name}`) {
    res.writeHead(301, { location: `/${name}/` });
    res.end();
    return;
  }

  // /<name>/dev/... — the worktree's dev space (artifacts + doc browser),
  // served straight from disk so it never cold-starts the worktree.
  const afterName = url.slice(`/${name}`.length);
  if (afterName.split("?")[0] === "/dev") {
    res.writeHead(301, { location: `/${name}/dev/` });
    res.end();
    return;
  }
  if (afterName.startsWith("/dev/")) {
    await serveDev({ name, rest: afterName, res, repoRoot: worktreeRoot(name) });
    return;
  }

  // /<name>/site/... — the generated static site (site/dist/), served from
  // disk so it never cold-starts the worktree.
  if (afterName.split("?")[0] === "/site") {
    res.writeHead(301, { location: `/${name}/site/` });
    res.end();
    return;
  }
  if (afterName.startsWith("/site/")) {
    await serveSite({ name, rest: afterName, res, repoRoot: worktreeRoot(name) });
    return;
  }

  try {
    await core.ensureRunning(name);
  } catch (err) {
    const status = httpStatusOf(err) ?? 502;
    // If we have a captured failure for this worktree, render the rich HTML
    // error page (stderr tail + retry button). Otherwise fall back to plain
    // text (e.g. 404 for unknown worktree name).
    const failedHandle = core.getHandle(name);
    const failed = failedHandle ? failedLifecycle(failedHandle) : null;
    if (failed) {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
      res.end(renderFailedPage(name, failed.lastError));
      return;
    }
    res.writeHead(status, { "content-type": "text/plain" });
    res.end(`Failed to start worktree ${name}: ${errMessage(err)}\n`);
    return;
  }

  await proxyWithRetry(req, {
    res,
    name,
    retries: 5,
    core,
    mobileBootstrap: mobileBootstrapTarget(req, decision),
  });
}

/**
 * The per-request dispatch, downstream of the auth gate. Every branch either
 * writes a response and reports `true`, or declines and lets the next stage
 * look at the URL; the worktree stage below is terminal.
 */
export async function dispatchRouterRequest(
  ctx: DispatchContext,
  {
    req,
    res,
    decision,
  }: {
    req: http.IncomingMessage;
    res: http.ServerResponse;
    decision: RouterAuthDecision & { allow: true };
  },
): Promise<void> {
  const url = req.url || "/";
  if (await handleStatusRoute(ctx, { res, url })) return;
  if (await handleControlRoutes(ctx, { req, res, url })) return;
  if (await handleRootRoutes(ctx, { req, res, url })) return;
  await handleWorktreeRoutes(ctx, { req, res, url, decision });
}
