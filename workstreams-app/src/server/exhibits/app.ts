// The exhibits listener: a second Fastify instance, a second origin.
//
// Agent-written pages script freely here, so this origin holds no
// router/workstreams authority: its cookie grants exhibit routes only. Route =
// store path (filesystem routing), with two roots on one contract —
// /<ws>/<exhibit>/ in the persistent store, /apps/<name>/ in the main
// checkout's tracked dev/apps.

import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";

import { DOC_FILE, MANIFEST_FILE, type ExhibitBoot } from "../../shared/exhibits.js";
import { exhibitsApiPlugin } from "./api.js";
import type { ExhibitsAssets } from "./assets.js";
import { registerExhibitsAuth } from "./auth.js";
import {
  APPS_SEGMENT,
  STORE_MARKER,
  UninitializedStoreError,
  assertStoreInitialized,
  listExhibits,
  listWorkstreams,
  readManifest,
  resolveExhibitDir,
  resolveUnderRoot,
} from "./store.js";
import {
  renderCompileError,
  renderExhibitList,
  renderManifestError,
  renderNotFound,
  renderShell,
  renderStoreError,
  renderWorkstreamList,
} from "./pages.js";

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/jsonl",
  ".md": "text/markdown; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
};

/** Page source is a build input, not content: the sibling route never hands it back. */
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".jsx"]);

export interface BuildExhibitsAppOptions {
  storeRoot: string;
  /** The main checkout's tracked dev/apps; may not exist yet. */
  appsRoot: string;
  token: string;
  /** This listener's own port — the origin a mutating request must come from. */
  port: number;
  createAssets(server: http.Server): Promise<ExhibitsAssets>;
  logger?: boolean | undefined;
}

interface Exchange {
  request: FastifyRequest;
  reply: FastifyReply;
}

interface PageTarget {
  root: string;
  segments: string[];
  scope: string;
  listUrl: string;
  listLabel: string;
  requireAsk: boolean;
}

function html(reply: FastifyReply, page: { code: number; body: string }): FastifyReply {
  return reply.code(page.code).type("text/html; charset=utf-8").send(page.body);
}

/**
 * Vite's own URLs (/@fs/…, /@vite/client, /node_modules/…) have the same shape
 * as exhibit routes, so anything this app cannot resolve must fall through to
 * the dev server rather than 404 in Fastify.
 */
function delegate(assets: ExhibitsAssets, exchange: Exchange): void {
  const { reply } = exchange;
  reply.hijack();
  assets.handle({ req: exchange.request.raw, res: reply.raw }, (error) => {
    reply.raw.setHeader("content-type", "text/plain; charset=utf-8");
    if (error !== undefined) {
      reply.raw.statusCode = 500;
      const detail = error instanceof Error ? error.stack ?? error.message : String(error);
      reply.raw.end(`exhibits asset error\n\n${detail}\n`);
      return;
    }
    reply.raw.statusCode = 404;
    reply.raw.end("not found\n");
  });
}

async function readDoc(dir: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(dir, DOC_FILE), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function servePage(
  assets: ExhibitsAssets,
  target: PageTarget & Exchange,
): Promise<unknown> {
  const { request, reply } = target;
  const resolved = await resolveExhibitDir(target.root, target.segments);
  if (!resolved) return delegate(assets, target);

  const manifest = await readManifest(resolved.dir, { requireAsk: target.requireAsk });
  if (!manifest.ok) {
    return html(reply, {
      code: manifest.missing ? 404 : 500,
      body: renderManifestError({
        scope: target.scope,
        manifestPath: path.join(target.scope, MANIFEST_FILE),
        issues: manifest.issues,
      }),
    });
  }

  if (resolved.tier === "html") {
    // A vanilla HTML page is a first-class exhibit: served as-is, scripts
    // allowed. That is what this origin exists for.
    const body = await fs.readFile(path.join(resolved.dir, "index.html"), "utf8");
    return reply.type("text/html; charset=utf-8").send(body);
  }

  assets.noticeExhibit(resolved.dir);
  const modulePath = path.join(resolved.dir, "index.tsx");
  if (resolved.tier === "module") {
    try {
      await assets.preflightModule(modulePath);
    } catch (error) {
      return html(reply, {
        code: 500,
        body: renderCompileError({
          scope: target.scope,
          message: error instanceof Error ? error.message : String(error),
        }),
      });
    }
  }
  const boot: ExhibitBoot = {
    scope: target.scope,
    listUrl: target.listUrl,
    listLabel: target.listLabel,
    manifest: manifest.manifest,
    doc: await readDoc(resolved.dir),
    module: resolved.tier === "module" ? `/@fs${modulePath}` : null,
  };
  return html(reply, { code: 200, body: await assets.transformIndexHtml(request.url, renderShell(boot)) });
}

async function serveSibling(
  assets: ExhibitsAssets,
  target: { root: string; segments: string[]; rest: string } & Exchange,
): Promise<unknown> {
  const { reply } = target;
  const rest = target.rest.split("/").filter((part) => part !== "");
  let resolved: string;
  try {
    // Resolve BEFORE judging the extension: Vite's own URLs (/@fs/<abs>/index.tsx)
    // reach this route too, and they must fall through rather than be refused.
    resolved = await resolveUnderRoot(target.root, [...target.segments, ...rest]);
  } catch (_error) {
    return delegate(assets, target);
  }
  if (SOURCE_EXTENSIONS.has(path.extname(resolved))) {
    return html(reply, { code: 404, body: renderNotFound("Page source is not served as content.") });
  }
  if (!(await fs.stat(resolved)).isFile()) return delegate(assets, target);
  return reply
    .type(CONTENT_TYPES[path.extname(resolved).toLowerCase()] ?? "application/octet-stream")
    .send(await fs.readFile(resolved));
}

export async function buildExhibitsApp(options: BuildExhibitsAppOptions): Promise<FastifyInstance> {
  const rawServer = http.createServer();
  const app = Fastify({
    logger: options.logger ?? false,
    serverFactory: (handler) => rawServer.on("request", handler),
  });
  const assets = await options.createAssets(rawServer);
  // Fastify does not own keep-alive sockets on a serverFactory server, and a
  // page holds one open, so a plain close hangs until the supervisor's SIGKILL.
  app.addHook("preClose", async () => rawServer.closeAllConnections());
  app.addHook("onClose", () => assets.close());
  registerExhibitsAuth(app, { token: options.token, port: options.port });
  // On this instance, so the API inherits the auth hook above: a separately
  // built instance would be an unauthenticated write surface.
  await app.register(exhibitsApiPlugin, { prefix: "/api", storeRoot: options.storeRoot });

  /** Every store route fails closed on an unmarked root (marker discipline). */
  async function requireStore(reply: FastifyReply): Promise<boolean> {
    try {
      await assertStoreInitialized(options.storeRoot);
      return true;
    } catch (error) {
      if (!(error instanceof UninitializedStoreError)) throw error;
      await html(reply, {
        code: 503,
        body: renderStoreError({ storeRoot: options.storeRoot, marker: STORE_MARKER }),
      });
      return false;
    }
  }

  app.get("/", async (_request, reply) => {
    if (!(await requireStore(reply))) return reply;
    const hasApps = await fs.stat(options.appsRoot).then((stats) => stats.isDirectory(), () => false);
    return html(reply, {
      code: 200,
      body: renderWorkstreamList({ workstreams: await listWorkstreams(options.storeRoot), hasApps }),
    });
  });

  app.get("/apps/", async (_request, reply) =>
    html(reply, {
      code: 200,
      body: renderExhibitList({
        heading: "Committed apps",
        basePath: "/apps/",
        // A committed app's code is tracked in the checkout; its documents —
        // including any disposition — live in the store's reserved namespace.
        exhibits: await listExhibits(options.appsRoot, {
          requireAsk: false,
          dataRoot: path.join(options.storeRoot, APPS_SEGMENT),
        }),
      }),
    }));

  app.get<{ Params: { name: string } }>("/apps/:name/", async (request, reply) =>
    servePage(assets, {
      root: options.appsRoot,
      segments: [request.params.name],
      scope: `${APPS_SEGMENT}/${request.params.name}`,
      listUrl: "/apps/",
      listLabel: "Committed apps",
      requireAsk: false,
      request,
      reply,
    }));

  app.get<{ Params: { name: string; "*": string } }>("/apps/:name/*", async (request, reply) =>
    serveSibling(assets, {
      root: options.appsRoot,
      segments: [request.params.name],
      rest: request.params["*"],
      request,
      reply,
    }));

  app.get<{ Params: { ws: string } }>("/:ws/", async (request, reply) => {
    if (!(await requireStore(reply))) return reply;
    const { ws } = request.params;
    let root: string;
    try {
      root = await resolveUnderRoot(options.storeRoot, [ws]);
    } catch (_error) {
      return delegate(assets, { request, reply });
    }
    return html(reply, {
      code: 200,
      body: renderExhibitList({
        heading: ws,
        basePath: `/${encodeURIComponent(ws)}/`,
        exhibits: await listExhibits(root, { requireAsk: true }),
      }),
    });
  });

  app.get<{ Params: { ws: string; exhibit: string } }>("/:ws/:exhibit/", async (request, reply) => {
    if (!(await requireStore(reply))) return reply;
    const { ws, exhibit } = request.params;
    return servePage(assets, {
      root: options.storeRoot,
      segments: [ws, exhibit],
      scope: `${ws}/${exhibit}`,
      listUrl: `/${encodeURIComponent(ws)}/`,
      listLabel: ws,
      requireAsk: true,
      request,
      reply,
    });
  });

  app.get<{ Params: { ws: string; exhibit: string; "*": string } }>("/:ws/:exhibit/*", async (request, reply) => {
    if (!(await requireStore(reply))) return reply;
    return serveSibling(assets, {
      root: options.storeRoot,
      segments: [request.params.ws, request.params.exhibit],
      rest: request.params["*"],
      request,
      reply,
    });
  });

  app.setNotFoundHandler((request, reply) => delegate(assets, { request, reply }));
  return app;
}
