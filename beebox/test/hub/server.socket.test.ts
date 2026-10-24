// # The hub routes HTTP and WebSocket traffic to a box behind a Unix socket
//
// On a unit host an endpoint carries `socketPath` and the proxy target is
// `{ host, port, socketPath }` (`src/hub/endpoints.ts`'s `proxyTarget`,
// against the pinned http-proxy-3). A stand-in box listens on a socket, the
// hub proxies a request and an upgrade to it, and a provider whose unit is
// `inactive` answers 503 with the provider's reason.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHubServer } from "../../src/hub/server/core.js";
import { staticEndpointProvider, type Endpoint, type EndpointProvider } from "../../src/hub/endpoints.js";
import { TEST_FRONTEND_PATH } from "../helpers/test-server.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function portOf(server: http.Server): number {
  const address = server.address();
  assert.ok(address && typeof address === "object", "listening on TCP");
  return address.port;
}

/** A box on a Unix socket: echoes method and url; completes a bare WebSocket handshake. */
async function startSocketBox() {
  const socketPath = join(await mkdtemp(join(tmpdir(), "bbx-hubsock-")), "box.sock");
  const sockets: net.Socket[] = [];
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ method: req.method, url: req.url, hubSecret: req.headers["x-bbx-hub-secret"] ?? null }));
  });
  server.on("connection", (socket) => sockets.push(socket));
  server.on("upgrade", (req, socket) => {
    const accept = crypto.createHash("sha1").update(String(req.headers["sec-websocket-key"]) + WS_GUID).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return { server, sockets, socketPath };
}

async function startHub(endpoints: EndpointProvider, options: { boxRoot: string; hubSecret: string | ((slug: string | null) => string) }) {
  const sockets: net.Socket[] = [];
  const server = await createHubServer({
    endpoints,
    getHealth: () => ({ status: "ok", boxes: [] }),
    hubSecret: options.hubSecret,
    boxes: [{ slug: "unit1", boxRoot: options.boxRoot }],
    baseUrl: "http://127.0.0.1",
    openAccess: true,
    frontendPath: TEST_FRONTEND_PATH,
  });
  server.on("connection", (socket) => sockets.push(socket));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, sockets, port: portOf(server) };
}

function upgradeThrough(port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    let data = "";
    socket.on("data", (chunk) => { data += chunk.toString("utf8"); if (data.includes("\r\n\r\n")) { socket.destroy(); resolve(data); } });
    socket.on("error", reject);
  });
}

void test("HTTP and a WebSocket upgrade reach the box through its socket, with that box's own hub secret", async (t) => {
  const box = await makeTmpBox();
  const stand = await startSocketBox();
  // A per-slug secret, as a unit host's hub holds (`hub/secrets.ts`).
  const hub = await startHub(
    staticEndpointProvider([{ slug: "unit1", origin: "http://localhost", socketPath: stand.socketPath }]),
    { boxRoot: box.root, hubSecret: (slug) => (slug === "unit1" ? "secret-for-unit1" : "other") },
  );
  t.teardown(async () => {
    for (const socket of [...hub.sockets, ...stand.sockets]) socket.destroy();
    await new Promise<void>((resolve) => hub.server.close(() => resolve()));
    await new Promise<void>((resolve) => stand.server.close(() => resolve()));
    await box.cleanup();
  });

  const response = await fetch(`http://127.0.0.1:${hub.port}/unit1/api/thing?x=1`);
  t.check({ status: response.status, body: await response.json() }, { status: 200, body: { method: "GET", url: "/unit1/api/thing?x=1", hubSecret: "secret-for-unit1" } });
  t.check(await upgradeThrough(hub.port, "/unit1/api/trpc"), any(String).startsWith("HTTP/1.1 101 Switching Protocols"));
});

void test("a known box whose unit is inactive answers 503 with the provider's reason", async (t) => {
  const box = await makeTmpBox();
  const none = new Map<string, Endpoint>();
  const provider: EndpointProvider = {
    get: (slug) => none.get(slug),
    slugs: () => ["unit1"],
    unavailable: () => "unit inactive",
  };
  const hub = await startHub(provider, { boxRoot: box.root, hubSecret: "secret" });
  t.teardown(async () => {
    for (const socket of hub.sockets) socket.destroy();
    await new Promise<void>((resolve) => hub.server.close(() => resolve()));
    await box.cleanup();
  });
  const response = await fetch(`http://127.0.0.1:${hub.port}/unit1/api/thing`, { headers: { accept: "application/json" } });
  t.check({ status: response.status, retryAfter: response.headers.get("retry-after"), body: await response.json() }, {
    status: 503,
    retryAfter: "60",
    body: { error: "box_unavailable", message: "Box unit1 is not running: unit inactive" },
  });
  // The WebSocket path never wakes a box: a plain 503 on the upgrade.
  t.check(await upgradeThrough(hub.port, "/unit1/api/trpc"), any(String).startsWith("HTTP/1.1 503 Service Unavailable"));
});
