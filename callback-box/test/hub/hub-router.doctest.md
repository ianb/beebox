# `cb hub` routing: the endpoint seam (Track D, chunk D1)

`src/hub/hub-server.ts` never talks to a child process directly — it only
consumes `EndpointProvider` (`src/hub/endpoints.ts`). This doctest proves
the router/proxy layer against a **fake endpoint**: a trivial `http.Server`
standing in for "a box the hub supervises," fed in via
`staticEndpointProvider` instead of a real `Supervisor`. That's the whole
point of the seam — routing correctness doesn't need a real child process,
only something that speaks HTTP (and, for the WS case, the upgrade
handshake) at a known origin.

```ts setup
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import { createHubServer } from "../../src/hub/hub-server.js";
import { staticEndpointProvider } from "../../src/hub/endpoints.js";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** A minimal fake "box": echoes back method/url/headers as JSON for plain
 *  HTTP, and completes a bare-bones WebSocket handshake (no framing) for
 *  upgrade requests — enough to prove the hub proxies the upgrade through
 *  rather than terminating or dropping it. Tracks every accepted socket so
 *  cleanup can force-destroy them: an "upgraded" socket is deliberately
 *  detached from Node's normal HTTP request bookkeeping, so
 *  `server.close()` alone can hang forever waiting for a connection that
 *  `closeAllConnections()` doesn't reliably reach once it's been handed off
 *  via the "upgrade" event. */
async function startFakeBox() {
  const sockets = [];
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ method: req.method, url: req.url, xForwardedHost: req.headers["x-forwarded-host"] ?? null }));
  });
  server.on("connection", (socket) => sockets.push(socket));
  server.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    const accept = crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    // No frame handling needed -- the doctest only checks the handshake made it through.
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, sockets, port, origin: `http://127.0.0.1:${port}` };
}

async function startHub(endpoints) {
  const sockets = [];
  const server = createHubServer({ endpoints, getHealth: () => ({ status: "ok", boxes: [] }) });
  server.on("connection", (socket) => sockets.push(socket));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, sockets, port, base: `http://127.0.0.1:${port}` };
}

function rawUpgradeRequest({ port, path }) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${port}\r\n` +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
        "Sec-WebSocket-Version: 13\r\n\r\n"
      );
    });
    let data = "";
    socket.on("data", (chunk) => {
      data += chunk.toString("utf8");
      if (data.includes("\r\n\r\n")) {
        socket.destroy();
        resolve(data);
      }
    });
    socket.on("error", reject);
  });
}
```

## An unconfigured slug 404s without touching any endpoint

```ts
const box = await startFakeBox();
const hub = await startHub(staticEndpointProvider([{ slug: "test1", origin: box.origin }]));

const missingResponse = await fetch(`${hub.base}/nope/x`);
missingResponse.status
=> 404
```

## `/` lists configured slugs, `/healthz` returns the injected health

```ts continue
const rootResponse = await fetch(`${hub.base}/`);
JSON.stringify(await rootResponse.json())
=> {"boxes":["test1"]}

const healthResponse = await fetch(`${hub.base}/healthz`);
JSON.stringify(await healthResponse.json())
=> {"status":"ok","boxes":[]}
```

## A request under a configured slug is proxied unchanged (no prefix stripping)

The box's own Fastify instance serves itself at `/<slug>/...` already (same
as standalone `cb serve --slug`) — the hub forwards the full path as-is.

```ts continue
const proxied = await fetch(`${hub.base}/test1/browse/some-card`);
const body = await proxied.json();
proxied.status
=> 200

JSON.stringify({ method: body.method, url: body.url })
=> {"method":"GET","url":"/test1/browse/some-card"}
```

## A WebSocket upgrade under a configured slug is proxied through

```ts continue
const upgradeResponse = await rawUpgradeRequest({ port: hub.port, path: "/test1/ws" });
upgradeResponse.startsWith("HTTP/1.1 101")
=> true
```

## A WebSocket upgrade for an unconfigured slug gets a raw 404 (never reaches an endpoint)

```ts continue
const rejectedUpgrade = await rawUpgradeRequest({ port: hub.port, path: "/nope/ws" });
rejectedUpgrade.startsWith("HTTP/1.1 404")
=> true
```

```ts cleanup
// Force-destroy every tracked socket (not just closeAllConnections(), which
// doesn't reliably reach sockets detached via the "upgrade" event -- see
// startFakeBox's/startHub's doc comments) before close() -- otherwise the
// raw WS handshake sockets above hang server.close() forever.
for (const socket of hub.sockets) socket.destroy();
for (const socket of box.sockets) socket.destroy();
await new Promise((resolve) => hub.server.close(resolve));
await new Promise((resolve) => box.server.close(resolve));
```
