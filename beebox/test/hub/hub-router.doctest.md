# `bbx hub` routing: the endpoint seam, plus the D2 auth split (Track D, chunks D1-D2)

`src/hub/hub-server.ts` never talks to a child process directly — it only
consumes `EndpointProvider` (`src/hub/endpoints.ts`). This doctest proves
the router/proxy layer against a **fake endpoint**: a trivial `http.Server`
standing in for "a box the hub supervises," fed in via
`staticEndpointProvider` instead of a real `Supervisor`. That's the whole
point of the seam — routing correctness doesn't need a real child process,
only something that speaks HTTP (and, for the WS case, the upgrade
handshake) at a known origin.

It also covers the D2 auth split's routing-layer half: the hub strips any
client-supplied `x-bbx-*` header before proxying (the spoof wall) and
injects its own hub-secret-gated identity header. `createHubServer` is
`async` (it builds a Fastify app internally and returns its underlying
`http.Server` after `ready()`), and now takes `hubSecret` + `boxes`.

```ts setup
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import { createHubServer } from "../../src/hub/hub-server.js";
import { staticEndpointProvider } from "../../src/hub/endpoints.js";
import { Supervisor } from "../../src/hub/supervisor.js";
import { signSession, COOKIE_NAME } from "../../src/webapp/auth.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const HUB_SECRET = "test-hub-secret-for-router-doctest";

// Most of this file exercises hub-wide OPEN mode (the hub advertises
// `x-bbx-hub-auth: off` to children). Auth is always-on by default now, so open
// mode is the explicit `openAccess` construction option — `startHub` below
// passes `openAccess: true` by default. The ONE section that needs hub auth
// actually ON constructs its hub with `openAccess: false`.
// Both hub health routes require this bearer key (mirroring the box server's
// own /healthz). Set it for the whole doctest; the auth header helper below
// sends it.
const DIAG_KEY = "test-diag-key-for-router-doctest";
process.env.BBX_DIAG_API_KEY = DIAG_KEY;
const diagAuth = { headers: { authorization: `Bearer ${DIAG_KEY}` } };

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
        xBbxAuthenticatedEmail: req.headers["x-bbx-authenticated-email"] ?? null,
        xBbxHubSecret: req.headers["x-bbx-hub-secret"] ?? null,
        xBbxHubAuth: req.headers["x-bbx-hub-auth"] ?? null,
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

async function startHub(endpoints, { boxes, getHealth, openAccess = true } = {}) {
  const sockets = [];
  const server = await createHubServer({
    endpoints,
    getHealth: getHealth ?? (() => ({ status: "ok", boxes: [] })),
    hubSecret: HUB_SECRET,
    boxes: boxes ?? [{ slug: "test1", boxRoot: "/nonexistent/test1" }],
    openAccess,
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

## `/` serves the root page, `/healthz` returns the injected health

`/` routes to the hub's box-picker handler, which serves the SPA when the
frontend bundle is built and a minimal box list otherwise — either way a 200
with an HTML body (the picker-content behavior itself is covered in
`box-picker.doctest.md`; this just asserts the routing).

```ts continue
const rootResponse = await fetch(`${hub.base}/`);
rootResponse.status
=> 200

const rootBody = await rootResponse.text();
rootBody.length > 0
=> true

const healthResponse = await fetch(`${hub.base}/healthz`, diagAuth);
JSON.stringify(await healthResponse.json())
=> {"status":"ok","boxes":[]}
```

## A request under a configured slug is proxied unchanged (no prefix stripping)

The box's own Fastify instance serves itself at `/<slug>/...` already (same
as standalone `bbx serve --slug`) — the hub forwards the full path as-is.

```ts continue
const proxied = await fetch(`${hub.base}/test1/browse/some-card`);
const body = await proxied.json();
proxied.status
=> 200

JSON.stringify({ method: body.method, url: body.url })
=> {"method":"GET","url":"/test1/browse/some-card"}
```

## A client-supplied `x-bbx-authenticated-email` header is stripped, never reaches the child

The spoof wall: no matter what a client sends, the box only ever sees
identity the HUB decided on. With hub auth off, that means the box sees
`x-bbx-hub-auth: off` + the hub secret — never the client's claimed email.

```ts continue
const spoofed = await fetch(`${hub.base}/test1/browse/some-card`, {
  headers: { "x-bbx-authenticated-email": "attacker@evil.com", "x-bbx-hub-secret": "attacker-supplied-secret" },
});
const spoofedBody = await spoofed.json();
JSON.stringify(spoofedBody.headers)
=> {"xBbxAuthenticatedEmail":null,"xBbxHubSecret":"test-hub-secret-for-router-doctest","xBbxHubAuth":"off"}
```

## A webhook path is proxied unauthenticated, carrying only the hub secret

```ts continue
const webhookHub = await startHub(staticEndpointProvider([{ slug: "test1", origin: box.origin }]));
const webhookResponse = await fetch(`${webhookHub.base}/webhook/test1/incoming`);
const webhookBody = await webhookResponse.json();
webhookResponse.status
=> 200

JSON.stringify(webhookBody.headers)
=> {"xBbxAuthenticatedEmail":null,"xBbxHubSecret":"test-hub-secret-for-router-doctest","xBbxHubAuth":null}
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

A SECOND request while the box is still running goes through `ensureRunning`
again too, not a plain `get()` (P1 review fix) -- this is what lets a real
`Supervisor.ensureRunning` refresh its idle timer on every request, not just
the cold-starting one. Without this, an actively-polled box's idle timer set
at cold-start would never be touched again and it would get SIGTERM'd out
from under live traffic:

```ts continue
const warmResponse = await fetch(`${lazyHub.base}/lazybox/browse/y`);
warmResponse.status
=> 200

lazyProvider.ensureCalls
=> 2
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
=> 2
```

A box-scoped keepalive uses the ordinary HTTP path, so it wakes the stopped
box before the frontend retries its WebSocket upgrade. The fixture box accepts
every HTTP path; the load-bearing assertion is that the hub calls
`ensureRunning` before proxying this request:

```ts continue
const wakeResponse = await fetch(`${lazyHub.base}/lazybox/api/keepalive`, { method: "HEAD" });
wakeResponse.status
=> 200

lazyProvider.ensureCalls
=> 3
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
  { headers: { "x-bbx-authenticated-email": "attacker@evil.com" } },
);
const callbackBody = await callbackResponse.json();
callbackResponse.status
=> 200

JSON.stringify({ url: callbackBody.url, headers: callbackBody.headers })
=> {"url":"/auth/google-services/callback?code=abc123&state=test1:admin","headers":{"xBbxAuthenticatedEmail":null,"xBbxHubSecret":"test-hub-secret-for-router-doctest","xBbxHubAuth":"off"}}
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
await ownedBox.write("_config/box.json", JSON.stringify({ allowedEmails: ["owner@example.com"] }));

// Hub auth ON for this section: construct the hub with openAccess: false so it
// verifies the session cookie (the rest of the file runs open).
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id-for-router-doctest";
// registerAuthRoutes fails loudly on an ID-without-secret half-config
// (MissingOAuthClientSecretError), so the fake credentials must be a pair.
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret-for-router-doctest";
process.env.BBX_SESSION_SECRET = "test-session-secret-for-router-doctest";

const authedHub = await startHub(staticEndpointProvider([{ slug: "test1", origin: box.origin }]), {
  boxes: [{ slug: "test1", boxRoot: ownedBox.root }],
  openAccess: false,
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
JSON.stringify({ url: allowedBody.url, email: allowedBody.headers.xBbxAuthenticatedEmail })
=> {"url":"/auth/google-services/callback?code=abc123&state=test1:admin","email":"owner@example.com"}
```

```ts continue
delete process.env.GOOGLE_OAUTH_CLIENT_ID;
delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
delete process.env.BBX_SESSION_SECRET;
for (const socket of authedHub.sockets) socket.destroy();
await new Promise((resolve) => authedHub.server.close(resolve));
await ownedBox.cleanup();
```

## The Google-services callback also cold-starts an idle-collected box (P2 review fix)

A user slow on Google's consent screen may come back after the target box
was idle-collected. The callback route must resolve through the SAME
`ensureRunning`-preferring helper as the catch-all, not a plain `get()` that
would 400 as `unknown_box` even though the box is configured.

```ts continue
const oauthLazyProvider = makeLazyProvider({ slug: "oauthlazybox", origin: box.origin });
const oauthLazyHub = await startHub(oauthLazyProvider, { boxes: [{ slug: "oauthlazybox", boxRoot: "/nonexistent/oauthlazybox" }] });

const oauthColdResponse = await fetch(`${oauthLazyHub.base}/auth/google-services/callback?code=abc123&state=oauthlazybox:admin`);
oauthColdResponse.status
=> 200

oauthLazyProvider.ensureCalls
=> 1

const oauthColdBody = await oauthColdResponse.json();
oauthColdBody.url
=> /auth/google-services/callback?code=abc123&state=oauthlazybox:admin
```

```ts continue
for (const socket of oauthLazyHub.sockets) socket.destroy();
await new Promise((resolve) => oauthLazyHub.server.close(resolve));
```

## The Google-services callback authenticates BEFORE resolving/waking any box

Auth must happen before box resolution: an *unauthenticated* callback naming a
real configured slug must NOT cold-start that box, and must be indistinguishable
from one naming an unknown slug (both redirect to login) — otherwise the route
is an unauthenticated box-wake plus a configured-slug oracle. Needs hub auth ON.

```ts continue
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id-for-router-doctest";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret-for-router-doctest";
process.env.BBX_SESSION_SECRET = "test-session-secret-for-router-doctest";

// Hub auth ON: construct with openAccess: false so the callback verifies a
// session cookie rather than passing through (auth is structurally always-on
// now — the only auth-off path is this construction option).
const preAuthProvider = makeLazyProvider({ slug: "preauthbox", origin: box.origin });
const preAuthHub = await startHub(preAuthProvider, {
  boxes: [{ slug: "preauthbox", boxRoot: "/nonexistent/preauthbox" }],
  openAccess: false,
});

// Unauthenticated, REAL configured slug: redirect to login, box NOT woken.
const knownUnauth = await fetch(`${preAuthHub.base}/auth/google-services/callback?code=abc123&state=preauthbox:admin`, { redirect: "manual" });
print(`known status: ${knownUnauth.status}`);
print(`known → login: ${(knownUnauth.headers.get("location") ?? "").startsWith("/auth/login")}`);
print(`ensureCalls: ${preAuthProvider.ensureCalls}`);
=>
known status: 302
known → login: true
ensureCalls: 0
```

An unknown slug is handled identically — same 302 to login, still no wake — so
the response reveals nothing about which slugs are configured.

```ts continue
const unknownUnauth = await fetch(`${preAuthHub.base}/auth/google-services/callback?code=abc123&state=nosuchbox:admin`, { redirect: "manual" });
print(`unknown status: ${unknownUnauth.status}`);
print(`unknown → login: ${(unknownUnauth.headers.get("location") ?? "").startsWith("/auth/login")}`);
print(`still no wake: ${preAuthProvider.ensureCalls}`);
=>
unknown status: 302
unknown → login: true
still no wake: 0
```

```ts continue
delete process.env.GOOGLE_OAUTH_CLIENT_ID;
delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
delete process.env.BBX_SESSION_SECRET;
for (const socket of preAuthHub.sockets) socket.destroy();
await new Promise((resolve) => preAuthHub.server.close(resolve));
```

## `/api/boxes` is hub-owned, matching the standalone server's shape

With hub auth off (this doctest's default), every configured box is listed
-- same "open" semantics as `/` and a standalone box outside auth mode.

```ts continue
const apiBoxesResponse = await fetch(`${hub.base}/api/boxes`);
apiBoxesResponse.status
=> 200

JSON.stringify(await apiBoxesResponse.json())
=> {"boxes":[{"slug":"test1","name":"test1","symbol":null}]}
```

## `/healthz` is diag-key-gated (it used to leak slugs/PIDs/ports publicly)

No key configured → 503 `unconfigured`; wrong/missing key → 401; correct key
→ the verdict. (`BBX_DIAG_API_KEY` is read per-request, so temporarily unsetting
it exercises the unconfigured branch without restarting the hub.)

```ts continue
const savedKey = process.env.BBX_DIAG_API_KEY;
delete process.env.BBX_DIAG_API_KEY;
const unconfigured = await fetch(`${hub.base}/healthz`);
process.env.BBX_DIAG_API_KEY = savedKey;
unconfigured.status
=> 503

const noKey = await fetch(`${hub.base}/healthz`);
noKey.status
=> 401

const wrongKey = await fetch(`${hub.base}/healthz`, { headers: { authorization: "Bearer nope" } });
wrongKey.status
=> 401
```

## An `unhealthy` verdict is served as HTTP 503, not 200

The status code carries the verdict so a monitor reading only the code alarms;
the body names the crash-looping box. Here `getHealth` is injected to report a
box latched `unhealthy` (the shape `hubVerdict` produces from supervisor state
— see `hub-health.doctest.md` for the derivation itself).

```ts continue
const brokenHealth = () => ({
  status: "unhealthy",
  boxes: [{ slug: "sick", status: "unhealthy", pid: undefined, port: undefined, restarts: 5, consecutiveFailures: 5, lastError: "ERR_DLOPEN_FAILED" }],
});
const brokenHub = await startHub(staticEndpointProvider([]), { getHealth: brokenHealth });
const brokenResponse = await fetch(`${brokenHub.base}/healthz`, diagAuth);
brokenResponse.status
=> 503

const brokenBody = await brokenResponse.json();
JSON.stringify({ status: brokenBody.status, slug: brokenBody.boxes[0].slug })
=> {"status":"unhealthy","slug":"sick"}

await new Promise((resolve) => brokenHub.server.close(resolve));
```

## `/healthz/canary` cold-starts one box and reports whether it serves

The deploy's child-level check: it drives `ensureRunning` server-side (the
passive verdict can't see a `stopped` box, and the diag key can't drive a box
through the proxy auth wall). A slug that comes ready → 200; a configured slug
whose cold-start never yields an endpoint → 503 `canary-failed`; an empty
config → 503 `no-boxes`.

```ts continue
const canaryProvider = makeLazyProvider({ slug: "canarybox", origin: box.origin });
const canaryHub = await startHub(canaryProvider, { boxes: [{ slug: "canarybox", boxRoot: "/nonexistent/canarybox" }] });

// No ?box= → picks the first configured slug, cold-starts it, 200.
const canaryOk = await fetch(`${canaryHub.base}/healthz/canary`, diagAuth);
canaryOk.status
=> 200

JSON.stringify(await canaryOk.json())
=> {"status":"ok","slug":"canarybox"}

canaryProvider.ensureCalls
=> 1
```

A provider whose `ensureRunning` never yields an endpoint (the crash-loop case
— the child never becomes ready) → 503, naming the slug:

```ts continue
const deadProvider = {
  get: () => undefined,
  slugs: () => ["deadbox"],
  ensureRunning: async () => undefined,
};
const deadHub = await startHub(deadProvider, { boxes: [{ slug: "deadbox", boxRoot: "/nonexistent/deadbox" }] });
const canaryDead = await fetch(`${deadHub.base}/healthz/canary`, diagAuth);
canaryDead.status
=> 503

const deadBody = await canaryDead.json();
JSON.stringify({ status: deadBody.status, slug: deadBody.slug })
=> {"status":"canary-failed","slug":"deadbox"}

await new Promise((resolve) => deadHub.server.close(resolve));
```

An empty configuration has nothing to canary → 503 `no-boxes`:

```ts continue
const emptyHub = await startHub(staticEndpointProvider([]), { boxes: [] });
const canaryEmpty = await fetch(`${emptyHub.base}/healthz/canary`, diagAuth);
canaryEmpty.status
=> 503

JSON.stringify(await canaryEmpty.json())
=> {"status":"no-boxes"}

await new Promise((resolve) => emptyHub.server.close(resolve));
```

The canary is also diag-gated — no key → 401, and the gate runs BEFORE the
side effect, so an unauthorized request never cold-starts a box
(`ensureCalls` unchanged):

```ts continue
const callsBefore = canaryProvider.ensureCalls;
const canaryNoKey = await fetch(`${canaryHub.base}/healthz/canary`);
canaryNoKey.status
=> 401

canaryProvider.ensureCalls === callsBefore
=> true

for (const socket of canaryHub.sockets) socket.destroy();
await new Promise((resolve) => canaryHub.server.close(resolve));
```

## The canary reproduces the incident path: a real Supervisor whose child never becomes ready → 503

The fake providers above prove the route's branching; this proves the actual
production wiring. A lazy `Supervisor` with an injected `checkReady` that always
rejects models the 2026-07-16 ABI crash (the child never answers `/healthz`, so
`ensureRunning` never yields a live endpoint). The canary must 503, not 200.

```ts continue
const crashFixture = await makeTmpBox();
function crashSpawn() {
  const exitHandlers = [];
  return { pid: 970001, on: (e, bbx) => { if (e === "exit") exitHandlers.push(bbx); }, catch: () => {}, fireExit: (c, s) => exitHandlers.forEach((bbx) => bbx(c, s)) };
}
const crashSupervisor = new Supervisor({
  config: {
    port: undefined, host: undefined,
    boxes: { crashbox: { path: crashFixture.root } },
    configPath: crashFixture.path("hub.json"),
    lazy: true, idleMs: 30, keepRecent: 0,
  },
  hubSecret: HUB_SECRET,
  spawnChild: crashSpawn,
  checkReady: () => Promise.reject(new Error("simulated readiness timeout (ABI crash)")),
});
await crashSupervisor.startAll();
const crashHub = await startHub(crashSupervisor, { boxes: [{ slug: "crashbox", boxRoot: crashFixture.root }] });

const canaryCrash = await fetch(`${crashHub.base}/healthz/canary`, diagAuth);
canaryCrash.status
=> 503

const crashBody = await canaryCrash.json();
JSON.stringify({ status: crashBody.status, slug: crashBody.slug })
=> {"status":"canary-failed","slug":"crashbox"}
```

```ts continue
await crashSupervisor.stopAll();
await crashFixture.cleanup();
for (const socket of crashHub.sockets) socket.destroy();
await new Promise((resolve) => crashHub.server.close(resolve));
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
