/**
 * `cb hub`'s HTTP/WS router (Track D, chunk D1). Adapted from the monorepo
 * dev router's proxy layer (`../../../bin/router.ts`'s `proxy`/`upgrade`
 * handling), but simplified: no lazy-start (`ensureRunning` becomes a plain
 * `endpoints.get(slug)` lookup -- a box is either up or it isn't, the hub
 * never spawns on first request), no idle shutdown, no Vite/worktree
 * concepts. This module knows NOTHING about child processes -- it only
 * consumes `EndpointProvider` (`./endpoints.js`), per the plan's "routing
 * consumes endpoints" seam.
 *
 * A box's own Fastify instance already serves itself under `/<slug>/...`
 * (see `server-box-scope.ts`'s `registerBox`, and `cb serve --slug`) -- so
 * the hub forwards the request's path UNCHANGED to the endpoint's origin,
 * the same "no prefix stripping" shape the dev router uses for `/main/...`.
 */

import http from "node:http";
import type { Socket } from "node:net";
import httpProxy from "http-proxy-3";
import type { EndpointProvider } from "./endpoints.js";
import type { BoxRuntimeStatus } from "./supervisor.js";

export interface HubHealth {
  status: "ok";
  boxes: BoxRuntimeStatus[];
}

export interface HubServerOptions {
  endpoints: EndpointProvider;
  getHealth: () => HubHealth;
}

/** First path segment, e.g. `/test1/browse/x` -> `test1`. Mirrors the dev
 *  router's `parseWorktreeName`. */
function parseSlug(reqPath: string): string | null {
  const m = /^\/([^#/?]+)(?:[#/?]|$)/.exec(reqPath);
  return m ? m[1]! : null;
}

function sendJson(res: http.ServerResponse, { status, body }: { status: number; body: unknown }): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

/**
 * Build the hub's `http.Server`. Kept as a plain `http.Server` (not
 * Fastify) so the proxy layer owns the raw request/socket exactly like the
 * dev router does -- a box's own Fastify instance is the one terminating
 * the request.
 */
export function createHubServer(options: HubServerOptions): http.Server {
  const { endpoints, getHealth } = options;
  const proxy = httpProxy.createProxyServer({ ws: true, changeOrigin: true });

  // eslint-disable-next-line max-params -- http-proxy-3's ProxyServer "error" event signature is (err, req, res)
  proxy.on("error", (err: Error, _req, res) => {
    if (res && "writeHead" in res && !(res as http.ServerResponse).headersSent) {
      sendJson(res as http.ServerResponse, { status: 502, body: { error: "bad_gateway", message: err.message } });
    } else if (res) {
      try {
        (res as http.ServerResponse | Socket).end();
      } catch (_e) {
        /* already gone */
      }
    }
  });

  const server = http.createServer((req, res) => {
    const reqPath = req.url ?? "/";

    if (reqPath === "/healthz") {
      sendJson(res, { status: 200, body: getHealth() });
      return;
    }
    if (reqPath === "/") {
      sendJson(res, { status: 200, body: { boxes: endpoints.slugs() } });
      return;
    }

    const slug = parseSlug(reqPath);
    const endpoint = slug ? endpoints.get(slug) : undefined;
    if (!endpoint) {
      sendJson(res, {
        status: 404,
        body: { error: "not_found", message: `No running box for ${JSON.stringify(reqPath)}` },
      });
      return;
    }

    proxy.web(req, res, { target: endpoint.origin });
  });

  // eslint-disable-next-line max-params -- Node's http "upgrade" event signature is (req, socket, head)
  server.on("upgrade", (req, socket, head) => {
    const reqPath = req.url ?? "/";
    const slug = parseSlug(reqPath);
    const endpoint = slug ? endpoints.get(slug) : undefined;
    if (!endpoint) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    proxy.ws(req, socket, head, { target: endpoint.origin }, (err) => {
      if (err) socket.destroy();
    });
  });

  return server;
}
