# `cb hub` routing: the endpoint seam, plus the D2 auth split (Track D, chunks D1-D2)

`src/hub/hub-server.ts` never talks to a child process directly — it only
consumes `EndpointProvider` (`src/hub/endpoints.ts`). This doctest proves
the router/proxy layer against a **fake endpoint**: a trivial `http.Server`
standing in for "a box the hub supervises," fed in via
`staticEndpointProvider` instead of a real `Supervisor`. That's the whole
point of the seam — routing correctness doesn't need a real child process,
only something that speaks HTTP (and, for the WS case, the upgrade
handshake) at a known origin.

It also covers the D2 auth split's routing-layer half: the hub strips any
client-supplied `x-cb-*` header before proxying (the spoof wall) and
injects its own hub-secret-gated identity header. `createHubServer` is
`async` (it builds a Fastify app internally and returns its underlying
`http.Server` after `ready()`), and now takes `hubSecret` + `boxes`.

```ts setup
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import { createHubServer } from "../../src/hub/hub-server.js";
import { staticEndpointProvider } from "../../src/hub/endpoints.js";
import { signSession, COOKIE_NAME } from "../../src/webapp/auth.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const HUB_SECRET = "test-hub-secret-for-router-doctest";

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
    res.end(JSON.stringify({
      method: req.method,
      url: req.url,
      headers: {
        xCbAuthenticatedEmail: req.headers["x-cb-authenticated-email"] ?? null,
        xCbHubSecret: req.headers["x-cb-hub-secret"] ?? null,
        xCbHubAuth: req.headers["x-cb-hub-auth"] ?? null,
      },
    }));
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

async function startHub(endpoints, { boxes } = {}) {
  const sockets = [];
  const server = await createHubServer({
    endpoints,
    getHealth: () => ({ status: "ok", boxes: [] }),
    hubSecret: HUB_SECRET,
    boxes: boxes ?? [{ slug: "test1", boxRoot: "/nonexistent/test1" }],
  });
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

## `/` renders the box picker, `/healthz` returns the injected health

With `GOOGLE_OAUTH_CLIENT_ID` unset (the doctest process's default), hub
auth is off — the box picker lists every configured box unconditionally,
same "open" semantics a standalone box gets outside auth mode.

```ts continue
const rootResponse = await fetch(`${hub.base}/`);
rootResponse.status
=> 200

const rootBody = await rootResponse.text();
rootBody.includes(`href="/test1/"`)
=> true

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

## A client-supplied `x-cb-authenticated-email` header is stripped, never reaches the child

The spoof wall: no matter what a client sends, the box only ever sees
identity the HUB decided on. With hub auth off, that means the box sees
`x-cb-hub-auth: off` + the hub secret — never the client's claimed email.

```ts continue
const spoofed = await fetch(`${hub.base}/test1/browse/some-card`, {
  headers: { "x-cb-authenticated-email": "attacker@evil.com", "x-cb-hub-secret": "attacker-supplied-secret" },
});
const spoofedBody = await spoofed.json();
JSON.stringify(spoofedBody.headers)
=> {"xCbAuthenticatedEmail":null,"xCbHubSecret":"test-hub-secret-for-router-doctest","xCbHubAuth":"off"}
```

## A webhook path is proxied unauthenticated, carrying only the hub secret

```ts continue
const webhookHub = await startHub(staticEndpointProvider([{ slug: "test1", origin: box.origin }]));
const webhookResponse = await fetch(`${webhookHub.base}/webhook/test1/incoming`);
const webhookBody = await webhookResponse.json();
webhookResponse.status
=> 200

JSON.stringify(webhookBody.headers)
=> {"xCbAuthenticatedEmail":null,"xCbHubSecret":"test-hub-secret-for-router-doctest","xCbHubAuth":null}
```

```ts continue
for (const socket of webhookHub.sockets) socket.destroy();
await new Promise((resolve) => webhookHub.server.close(resolve));
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

## A lazy provider's `ensureRunning` cold-starts an HTTP request; WS upgrades never trigger it

Mirrors a lazy `Supervisor` (`src/hub/supervisor.ts`) without spawning a real
process: `get()` only returns an endpoint while `running` is true;
`ensureRunning()` is the only thing that flips it on. This proves
`hub-server.ts`'s contract, not `Supervisor`'s own cold-start mechanics
(covered separately in `supervisor.doctest.md`).

```ts continue
function makeLazyProvider({ slug, origin }) {
  let running = false;
  let ensureCalls = 0;
  return {
    get: (s) => (s === slug && running ? { slug, origin } : undefined),
    slugs: () => [slug],
    ensureRunning: async (s) => {
      if (s !== slug) return undefined;
      ensureCalls++;
      running = true;
      return { slug, origin };
    },
    stop: () => { running = false; },
    get ensureCalls() { return ensureCalls; },
  };
}

const lazyProvider = makeLazyProvider({ slug: "lazybox", origin: box.origin });
const lazyHub = await startHub(lazyProvider, { boxes: [{ slug: "lazybox", boxRoot: "/nonexistent/lazybox" }] });
```

An HTTP request to the stopped box cold-starts it via `ensureRunning` and
still gets proxied through on the SAME request (no separate retry needed):

```ts continue
const coldResponse = await fetch(`${lazyHub.base}/lazybox/browse/x`);
coldResponse.status
=> 200

lazyProvider.ensureCalls
=> 1
```

A WebSocket upgrade to that same slug once it's stopped again gets a 503
(known slug, not running) -- never a 404, and `ensureRunning` is NOT called
(an abandoned tab's WS reconnect must not resurrect the box):

```ts continue
lazyProvider.stop();
const idleUpgrade = await rawUpgradeRequest({ port: lazyHub.port, path: "/lazybox/ws" });
idleUpgrade.startsWith("HTTP/1.1 503")
=> true

lazyProvider.ensureCalls
=> 1
```

```ts continue
for (const socket of lazyHub.sockets) socket.destroy();
await new Promise((resolve) => lazyHub.server.close(resolve));
```

## The Google-services OAuth callback routes to the box named in `state`, headers intact

`/auth/google-services/callback` isn't a box slug -- the generic catch-all
can't route it. The hub instead reads the box out of the OAuth `state` query
param (`"boxSlug"` or `"boxSlug:returnPath"`, same format the box's own
callback handler parses) and proxies straight to that child, applying the
same identity-header gate as any other proxied request.

```ts continue
const callbackResponse = await fetch(
  `${hub.base}/auth/google-services/callback?code=abc123&state=test1:admin`,
  { headers: { "x-cb-authenticated-email": "attacker@evil.com" } },
);
const callbackBody = await callbackResponse.json();
callbackResponse.status
=> 200

JSON.stringify({ url: callbackBody.url, headers: callbackBody.headers })
=> {"url":"/auth/google-services/callback?code=abc123&state=test1:admin","headers":{"xCbAuthenticatedEmail":null,"xCbHubSecret":"test-hub-secret-for-router-doctest","xCbHubAuth":"off"}}
```

An unknown/missing box in `state` never reaches any endpoint:

```ts continue
const unknownBoxResponse = await fetch(`${hub.base}/auth/google-services/callback?code=abc123&state=nope`);
unknownBoxResponse.status
=> 400
```

## The Google-services callback also checks the target box's own access list, not just a valid session

A valid fleet session isn't enough on its own -- the caller must also be
allowed on the SPECIFIC box named in `state` (`canAccessBox`,
`src/webapp/box-access.ts`), same fail-closed semantics used everywhere
else identity gates a box. Needs hub auth actually ON (unlike the rest of
this file) to have a session to check in the first place.

```ts continue
const ownedBox = await makeTmpBox();
await ownedBox.write("config/box.json", JSON.stringify({ allowedEmails: ["owner@example.com"] }));

process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id-for-router-doctest";
process.env.CB_SESSION_SECRET = "test-session-secret-for-router-doctest";

const authedHub = await startHub(staticEndpointProvider([{ slug: "test1", origin: box.origin }]), {
  boxes: [{ slug: "test1", boxRoot: ownedBox.root }],
});
const requestsBeforeDenial = box.sockets.length;

const strangerCookie = signSession({ email: "stranger@example.com", name: "Stranger" });
const deniedResponse = await fetch(
  `${authedHub.base}/auth/google-services/callback?code=abc123&state=test1:admin`,
  { headers: { cookie: `${COOKIE_NAME}=${strangerCookie}` } },
);
deniedResponse.status
=> 403
```

The denial never reaches the child -- no new connection to the fake box:

```ts continue
box.sockets.length === requestsBeforeDenial
=> true
```

An email on the box's own `allowedEmails` is forwarded, same as any other authorized request:

```ts continue
const allowedCookie = signSession({ email: "owner@example.com", name: "Owner" });
const allowedResponse = await fetch(
  `${authedHub.base}/auth/google-services/callback?code=abc123&state=test1:admin`,
  { headers: { cookie: `${COOKIE_NAME}=${allowedCookie}` } },
);
allowedResponse.status
=> 200

const allowedBody = await allowedResponse.json();
JSON.stringify({ url: allowedBody.url, email: allowedBody.headers.xCbAuthenticatedEmail })
=> {"url":"/auth/google-services/callback?code=abc123&state=test1:admin","email":"owner@example.com"}
```

```ts continue
delete process.env.GOOGLE_OAUTH_CLIENT_ID;
delete process.env.CB_SESSION_SECRET;
for (const socket of authedHub.sockets) socket.destroy();
await new Promise((resolve) => authedHub.server.close(resolve));
await ownedBox.cleanup();
```

## `/api/boxes` is hub-owned, matching the standalone server's shape

With hub auth off (this doctest's default), every configured box is listed
-- same "open" semantics as `/` and a standalone box outside auth mode.

```ts continue
const apiBoxesResponse = await fetch(`${hub.base}/api/boxes`);
apiBoxesResponse.status
=> 200

JSON.stringify(await apiBoxesResponse.json())
=> {"boxes":[{"slug":"test1","name":"test1"}]}
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
