// # `bbx hub` routing: the endpoint seam, plus the D2 auth split (Track D, chunks D1-D2)
//
// `src/hub/server/core.ts` never talks to a child process directly — it only
// consumes `EndpointProvider` (`src/hub/endpoints.ts`). This test proves
// the router/proxy layer against a **fake endpoint**: a trivial `http.Server`
// standing in for "a box the hub supervises," fed in via
// `staticEndpointProvider` instead of a real `Supervisor`. That's the whole
// point of the seam — routing correctness doesn't need a real child process,
// only something that speaks HTTP (and, for the WS case, the upgrade
// handshake) at a known origin.
//
// It also covers the D2 auth split's routing-layer half: the hub strips any
// client-supplied `x-bbx-*` header before proxying (the spoof wall) and
// injects its own hub-secret-gated identity header. `createHubServer` is
// `async` (it builds a Fastify app internally and returns its underlying
// `http.Server` after `ready()`), and now takes `hubSecret` + `boxes`.

import { t as root, test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate, str } from "@ianbicking/tap-check/check";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createHubServer, type HubHealth } from "../../src/hub/server/core.js";
import { staticEndpointProvider, type Endpoint, type EndpointProvider } from "../../src/hub/endpoints.js";
import type { ChildProc } from "../../src/hub/supervisor/child-spawn.js";
import type { BoxSpec } from "../../src/webapp/server-types.js";
import { Supervisor } from "../../src/hub/supervisor/core.js";
import { signSession, COOKIE_NAME } from "../../src/webapp/auth.js";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { acquireBoxMaintenance, boxMaintenanceStatus } from "../../src/lib/box-maintenance/admission.js";
import { renderUnavailablePage } from "../../src/hub/server/box-unavailable.js";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const HUB_SECRET = "test-hub-secret-for-router-test";
// The default box has a real, empty content root, as a new box does. A missing
// root is a broken box, and reading its name logs a warning.
const defaultBoxRoot = await mkdtemp(join(tmpdir(), "bbx-router-"));
await mkdir(join(defaultBoxRoot, "_content"));

// Most of this file exercises hub-wide OPEN mode (the hub advertises
// `x-bbx-hub-auth: off` to children). Auth is always-on by default now, so open
// mode is the explicit `openAccess` construction option — `startHub` below
// passes `openAccess: true` by default. The ONE section that needs hub auth
// actually ON constructs its hub with `openAccess: false`.
// Both hub health routes require this bearer key (mirroring the box server's
// own /healthz). Set it for the whole test; the auth header helper below
// sends it.
const DIAG_KEY = "test-diag-key-for-router-test";
process.env.BBX_DIAG_API_KEY = DIAG_KEY;
const diagAuth = { headers: { authorization: `Bearer ${DIAG_KEY}` } };
const BROWSE_KEY = "test-browse-key-for-router-test";

/** The JSON the fake box and the hub's own routes answer with; every field a
 *  check below reads is optional because each route answers with its own subset. */
const HubJson = z.looseObject({
  method: z.string().optional(),
  url: z.string().optional(),
  status: z.string().optional(),
  slug: z.string().optional(),
  error: z.string().optional(),
  reason: z.string().optional(),
  owner: z.looseObject({ pid: z.number() }).optional(),
  boxes: z.array(z.looseObject({ slug: z.string() })).optional(),
  headers: z.looseObject({ xBbxAuthenticatedEmail: z.string().nullable().optional() }).optional(),
});

function portOf(server: http.Server): number {
  const address = server.address();
  assert.ok(address && typeof address === "object", "server is listening on a TCP port");
  return address.port;
}

function listen(server: http.Server): Promise<void> {
  return new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
}

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
  const sockets: net.Socket[] = [];
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
    // No frame handling needed -- the test only checks the handshake made it through.
  });
  await listen(server);
  const port = portOf(server);
  return { server, sockets, port, origin: `http://127.0.0.1:${port}` };
}

/** A fake box behind a hub on the default `test1` slug. */
async function startRouter() {
  const box = await startFakeBox();
  const hub = await startHub(staticEndpointProvider([{ slug: "test1", origin: box.origin }]));
  return { box, hub };
}

async function stopRouter({ box, hub }: Awaited<ReturnType<typeof startRouter>>): Promise<void> {
  await stopHub(hub);
  for (const socket of box.sockets) socket.destroy();
  await new Promise<void>((resolve) => { box.server.close(() => { resolve(); }); });
}

async function startHub(
  endpoints: EndpointProvider,
  options?: { boxes?: BoxSpec[]; getHealth?: () => HubHealth; openAccess?: boolean },
) {
  const sockets: net.Socket[] = [];
  const server = await createHubServer({
    endpoints,
    getHealth: options?.getHealth ?? (() => ({ status: "ok", boxes: [] })),
    hubSecret: HUB_SECRET,
    boxes: options?.boxes ?? [{ slug: "test1", boxRoot: defaultBoxRoot }],
    baseUrl: "http://127.0.0.1",
    openAccess: options?.openAccess ?? true,
  });
  server.on("connection", (socket) => sockets.push(socket));
  await listen(server);
  const port = portOf(server);
  return { server, sockets, port, base: `http://127.0.0.1:${port}` };
}

function rawUpgradeRequest({ port, path }: { port: number; path: string }): Promise<string> {
  return new Promise<string>((resolve, reject) => {
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

// Destroy every tracked socket (a detached upgrade socket would hang close()), then close.
async function stopHub(hub: { sockets: net.Socket[]; server: http.Server }): Promise<void> {
  for (const socket of hub.sockets) socket.destroy();
  await new Promise<void>((resolve) => { hub.server.close(() => { resolve(); }); });
}

// GET through a hub; the fake box answers with JSON describing what it received.
async function getJson(hub: { base: string }, request: RequestInit & { path: string }) {
  const { path, ...init } = request;
  const response = await fetch(`${hub.base}${path}`, init);
  return { status: response.status, body: HubJson.parse(await response.json()) };
}

// Hub auth ON needs a (fake) OAuth client pair and a session secret.
function setOAuthEnv(on: boolean) {
  const vars = {
    GOOGLE_OAUTH_CLIENT_ID: "test-client-id-for-router-test",
    // registerAuthRoutes fails loudly on an ID-without-secret half-config
    // (MissingOAuthClientSecretError), so the fake credentials must be a pair.
    GOOGLE_OAUTH_CLIENT_SECRET: "test-client-secret-for-router-test",
    BBX_SESSION_SECRET: "test-session-secret-for-router-test",
  };
  for (const [name, value] of Object.entries(vars)) {
    if (on) process.env[name] = value;
    else delete process.env[name];
  }
}

// Mirrors a lazy `Supervisor`: `get()` only returns an endpoint while `running`
// is true; `ensureRunning()` is the only thing that flips it on.
const NO_ENDPOINTS = new Map<string, Endpoint>();

function makeLazyProvider({ slug, origin }: Endpoint) {
  let running = false;
  let ensureCalls = 0;
  return {
    get: (s: string) => (s === slug && running ? { slug, origin } : undefined),
    slugs: () => [slug],
    ensureRunning: async (s: string): Promise<Endpoint | undefined> => {
      if (s !== slug) return undefined;
      ensureCalls++;
      running = true;
      return { slug, origin };
    },
    stop: () => { running = false; },
    get ensureCalls() { return ensureCalls; },
  };
}

const CALLBACK = "/auth/google-services/callback?code=abc123&state=";

root.teardown(async () => {
  try {
    await rm(defaultBoxRoot, { recursive: true, force: true });
  } catch (error) {
    console.error("teardown failed:", error);
    process.exitCode = 1;
  }
});

// ## Routing: unknown slug, root page, unchanged proxying
//
// An unconfigured slug 404s without touching any endpoint. `/` routes to the
// hub's box-picker handler, which serves the SPA when the frontend bundle is built
// and a minimal box list otherwise — either way a 200 with an HTML body (the
// picker-content behavior itself is covered in `test/hub/server/box-picker.test.ts`; this just
// asserts the routing):
void test("An unconfigured slug 404s without touching any endpoint.", async (t) => {
  t.teardown(async () => {
    try {
      await stopHub(hub);
      for (const socket of box.sockets) socket.destroy();
      await new Promise<void>((resolve) => { box.server.close(() => { resolve(); }); });
    } catch (error) {
      t.error(error);
    }
  });
  const box = await startFakeBox();
  const hub = await startHub(staticEndpointProvider([{ slug: "test1", origin: box.origin }]));

  const missingResponse = await fetch(`${hub.base}/nope/x`);
  t.check(missingResponse.status, 404);

  const rootResponse = await fetch(`${hub.base}/`);
  t.check(rootResponse.status, 200);

  t.checkText(await rootResponse.text(), "<!DOCTYPE html>\n<html>\n<head>\n  <title>Bee Box Hub</title>\n  <meta charset=\"utf-8\">\n  <style>\n    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; }\n    h1 { color: #333; }\n    ul { padding-left: 1.25rem; }\n    li { margin: 0.25rem 0; }\n  </style>\n</head>\n<body>\n  <h1>Boxes</h1>\n  <ul>\n    <li><a href=\"/test1/\">test1</a></li>\n  </ul>\n</body>\n</html>");

  // ## A request under a configured slug is proxied unchanged (no prefix stripping)
  //
  // The box's own Fastify instance serves itself at `/<slug>/...` already (same
  // as standalone `bbx serve --slug`) — the hub forwards the full path as-is.

  const proxied = await getJson(hub, { path: "/test1/browse/some-card" });
  t.check([proxied.status, proxied.body.method, proxied.body.url], [
    200,
    "GET",
    "/test1/browse/some-card",
  ]);

});

void test("Identity headers: client-supplied ones are stripped, the hub's own are injected", async (t) => {
  t.teardown(async () => {
    try {
      await stopRouter(router);
    } catch (error) {
      t.error(error);
    }
  });
  const router = await startRouter();
  const { box, hub } = router;

  // ## Identity headers: client-supplied ones are stripped, the hub's own are injected
  //
  // The spoof wall: no matter what a client sends, the box only ever sees
  // identity the HUB decided on. With hub auth off, that means the box sees
  // `x-bbx-hub-auth: off` + the hub secret — never the client's claimed email.

  const spoofed = await getJson(hub, { path: "/test1/browse/some-card",
    headers: { "x-bbx-authenticated-email": "attacker@evil.com", "x-bbx-hub-secret": "attacker-supplied-secret" },
  });
  t.check(spoofed.body.headers, {
    xBbxAuthenticatedEmail: null,
    xBbxHubSecret: "test-hub-secret-for-router-test",
    xBbxHubAuth: "off",
  });

  // `/webhook/<slug>/…` is not routed to the box: no box registers a webhook
  // route, so the hub reads `webhook` as the slug and finds no such box.

  const webhook = await getJson(hub, { path: "/webhook/test1/incoming" });
  t.check(webhook.status, 404);

  // ## The browse key reaches hub-mode children through the trusted auth contract
  //
  // The machine-wide dev browse key authenticates at the hub. It must continue as
  // the hub's explicit `auth: off` decision when the child is hub-mode; treating it
  // as per-box mobile auth would skip those headers and make the child reject the
  // request.

  process.env.BBX_BROWSE_API_KEY = BROWSE_KEY;
  const browseHub = await startHub(staticEndpointProvider([{ slug: "test1", origin: box.origin }]), {
    openAccess: false,
  });
  const browse = await getJson(browseHub, { path: "/test1/api/health",
    headers: { cookie: `bbx_browse_key=${BROWSE_KEY}` },
  });
  t.check([browse.status, browse.body.headers], [
    200,
    {
      xBbxAuthenticatedEmail: null,
      xBbxHubSecret: "test-hub-secret-for-router-test",
      xBbxHubAuth: "off",
    },
  ]);

  await stopHub(browseHub);
  delete process.env.BBX_BROWSE_API_KEY;

});

void test("WebSocket upgrades and a lazy provider cold-start HTTP requests only", async (t) => {
  t.teardown(async () => {
    try {
      await stopRouter(router);
    } catch (error) {
      t.error(error);
    }
  });
  const router = await startRouter();
  const { box, hub } = router;

  // ## WebSocket upgrades
  //
  // A WebSocket upgrade under a configured slug is proxied through; one for an
  // unconfigured slug gets a raw 404 (never reaches an endpoint):

  const upgradeResponse = await rawUpgradeRequest({ port: hub.port, path: "/test1/ws" });
  const rejectedUpgrade = await rawUpgradeRequest({ port: hub.port, path: "/nope/ws" });
  t.check([upgradeResponse, rejectedUpgrade], [
    "HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n",
    "HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n",
  ]);

  // ## A lazy provider's `ensureRunning` cold-starts an HTTP request; WS upgrades never trigger it
  //
  // The lazy provider (`makeLazyProvider`, in setup) mirrors a lazy `Supervisor`
  // (`src/hub/supervisor/core.ts`) without spawning a real process. This proves
  // `hub-server.ts`'s contract, not `Supervisor`'s own cold-start mechanics
  // (covered separately in `test/hub/supervisor.test.ts`).
  //
  // An HTTP request to the stopped box cold-starts it via `ensureRunning` and
  // still gets proxied through on the SAME request (no separate retry needed):

  const lazyProvider = makeLazyProvider({ slug: "lazybox", origin: box.origin });
  const lazyHub = await startHub(lazyProvider, { boxes: [{ slug: "lazybox", boxRoot: "/nonexistent/lazybox" }] });

  const coldResponse = await fetch(`${lazyHub.base}/lazybox/browse/x`);
  t.check(coldResponse.status, 200);

  t.check(lazyProvider.ensureCalls, 1);

  // A SECOND request while the box is still running goes through `ensureRunning`
  // again too, not a plain `get()` (P1 review fix) -- this is what lets a real
  // `Supervisor.ensureRunning` refresh its idle timer on every request, not just
  // the cold-starting one. Without this, an actively-polled box's idle timer set
  // at cold-start would never be touched again and it would get SIGTERM'd out
  // from under live traffic:

  const warmResponse = await fetch(`${lazyHub.base}/lazybox/browse/y`);
  t.check(warmResponse.status, 200);

  t.check(lazyProvider.ensureCalls, 2);

  // A WebSocket upgrade to that same slug once it's stopped again gets a 503
  // (known slug, not running) -- never a 404, and `ensureRunning` is NOT called
  // (an abandoned tab's WS reconnect must not resurrect the box):

  lazyProvider.stop();
  const idleUpgrade = await rawUpgradeRequest({ port: lazyHub.port, path: "/lazybox/ws" });
  t.check(idleUpgrade, "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");

  t.check(lazyProvider.ensureCalls, 2);

  // A box-scoped keepalive uses the ordinary HTTP path, so it wakes the stopped
  // box before the frontend retries its WebSocket upgrade. The fixture box accepts
  // every HTTP path; the load-bearing assertion is that the hub calls
  // `ensureRunning` before proxying this request:

  const wakeResponse = await fetch(`${lazyHub.base}/lazybox/api/keepalive`, { method: "HEAD" });
  t.check(wakeResponse.status, 200);

  t.check(lazyProvider.ensureCalls, 3);

  await stopHub(lazyHub);

});

void test("The Google-services OAuth callback routes to the box named in state", async (t) => {
  t.teardown(async () => {
    try {
      await stopRouter(router);
    } catch (error) {
      t.error(error);
    }
  });
  const router = await startRouter();
  const { box, hub } = router;

  // ## The Google-services OAuth callback routes to the box named in `state`, headers intact
  //
  // `/auth/google-services/callback` isn't a box slug -- the generic catch-all
  // can't route it. The hub instead reads the box out of the OAuth `state` query
  // param (`"boxSlug"` or `"boxSlug:returnPath"`, same format the box's own
  // callback handler parses) and proxies straight to that child, applying the
  // same identity-header gate as any other proxied request. An unknown/missing box
  // in `state` never reaches any endpoint:

  const callback = await getJson(hub, { path: `${CALLBACK}test1:admin`,
    headers: { "x-bbx-authenticated-email": "attacker@evil.com" },
  });
  t.check([callback.status, callback.body.url, callback.body.headers], [
    200,
    "/auth/google-services/callback?code=abc123&state=test1:admin",
    {
      xBbxAuthenticatedEmail: null,
      xBbxHubSecret: "test-hub-secret-for-router-test",
      xBbxHubAuth: "off",
    },
  ]);

  const unknownBoxResponse = await fetch(`${hub.base}${CALLBACK}nope`);
  t.check(unknownBoxResponse.status, 400);

  // ## The Google-services callback also checks the target box's own access list, not just a valid session
  //
  // A valid fleet session isn't enough on its own -- the caller must also be
  // allowed on the SPECIFIC box named in `state` (`canAccessBox`,
  // `src/webapp/box-access.ts`), same fail-closed semantics used everywhere
  // else identity gates a box. Needs hub auth actually ON (unlike the rest of
  // this file) to have a session to check in the first place: the hub is
  // constructed with `openAccess: false` so it verifies the session cookie.

  const ownedBox = await makeTmpBox();
  await ownedBox.write("_config/box.json", JSON.stringify({ allowedEmails: ["owner@example.com"] }));
  setOAuthEnv(true);

  const authedHub = await startHub(staticEndpointProvider([{ slug: "test1", origin: box.origin }]), {
    boxes: [{ slug: "test1", boxRoot: ownedBox.root }],
    openAccess: false,
  });
  const socketsBeforeDenial = box.sockets.map((socket) => socket.remotePort);

  const strangerCookie = signSession({ email: "stranger@example.com", name: "Stranger" });
  const deniedResponse = await fetch(`${authedHub.base}${CALLBACK}test1:admin`, {
    headers: { cookie: `${COOKIE_NAME}=${strangerCookie}` },
  });
  t.check(deniedResponse.status, 403);

  // The denial never reaches the child -- no new connection to the fake box:

  t.check(box.sockets.map((socket) => socket.remotePort), socketsBeforeDenial);

  // An email on the box's own `allowedEmails` is forwarded, same as any other authorized request:

  const allowedCookie = signSession({ email: "owner@example.com", name: "Owner" });
  const allowed = await getJson(authedHub, { path: `${CALLBACK}test1:admin`,
    headers: { cookie: `${COOKIE_NAME}=${allowedCookie}` },
  });
  t.check([allowed.status, allowed.body.url, allowed.body.headers?.xBbxAuthenticatedEmail], [
    200,
    "/auth/google-services/callback?code=abc123&state=test1:admin",
    "owner@example.com",
  ]);

  setOAuthEnv(false);
  await stopHub(authedHub);
  await ownedBox.cleanup();

});

void test("The Google-services callback cold-starts an idle box and authenticates first", async (t) => {
  t.teardown(async () => {
    try {
      await stopRouter(router);
    } catch (error) {
      t.error(error);
    }
  });
  const router = await startRouter();
  const { box } = router;

  // ## The Google-services callback also cold-starts an idle-collected box (P2 review fix)
  //
  // A user slow on Google's consent screen may come back after the target box
  // was idle-collected. The callback route must resolve through the SAME
  // `ensureRunning`-preferring helper as the catch-all, not a plain `get()` that
  // would 400 as `unknown_box` even though the box is configured.

  const oauthLazyProvider = makeLazyProvider({ slug: "oauthlazybox", origin: box.origin });
  const oauthLazyHub = await startHub(oauthLazyProvider, { boxes: [{ slug: "oauthlazybox", boxRoot: "/nonexistent/oauthlazybox" }] });

  const oauthCold = await getJson(oauthLazyHub, { path: `${CALLBACK}oauthlazybox:admin` });
  t.check([oauthCold.status, oauthLazyProvider.ensureCalls, oauthCold.body.url], [
    200,
    1,
    "/auth/google-services/callback?code=abc123&state=oauthlazybox:admin",
  ]);

  await stopHub(oauthLazyHub);

  // ## The Google-services callback authenticates BEFORE resolving/waking any box
  //
  // Auth must happen before box resolution: an *unauthenticated* callback naming a
  // real configured slug must NOT cold-start that box, and must be indistinguishable
  // from one naming an unknown slug (both redirect to login) — otherwise the route
  // is an unauthenticated box-wake plus a configured-slug oracle. Needs hub auth ON
  // (`openAccess: false`, so the callback verifies a session cookie rather than
  // passing through). An unknown slug is handled identically — same 302 to login,
  // still no wake — so the response reveals nothing about which slugs are configured.

  setOAuthEnv(true);
  const preAuthProvider = makeLazyProvider({ slug: "preauthbox", origin: box.origin });
  const preAuthHub = await startHub(preAuthProvider, {
    boxes: [{ slug: "preauthbox", boxRoot: "/nonexistent/preauthbox" }],
    openAccess: false,
  });

  const outcomes = [];
  for (const state of ["preauthbox:admin", "nosuchbox:admin"]) {
    const res = await fetch(`${preAuthHub.base}${CALLBACK}${state}`, { redirect: "manual" });
    outcomes.push({
      status: res.status,
      location: res.headers.get("location"),
      ensureCalls: preAuthProvider.ensureCalls,
    });
  }
  t.check(outcomes, [
    { status: 302, location: "/auth/login?returnTo=%2Fauth%2Fgoogle-services%2Fcallback%3Fcode%3Dabc123%26state%3Dpreauthbox%3Aadmin", ensureCalls: 0 },
    { status: 302, location: "/auth/login?returnTo=%2Fauth%2Fgoogle-services%2Fcallback%3Fcode%3Dabc123%26state%3Dnosuchbox%3Aadmin", ensureCalls: 0 },
  ]);

  setOAuthEnv(false);
  await stopHub(preAuthHub);

});

void test("The hub owns /api/boxes and gates /healthz by diag key", async (t) => {
  t.teardown(async () => {
    try {
      await stopRouter(router);
    } catch (error) {
      t.error(error);
    }
  });
  const router = await startRouter();
  const { hub } = router;

  // ## `/api/boxes` is hub-owned, matching the standalone server's shape
  //
  // With hub auth off (this test's default), every configured box is listed
  // -- same "open" semantics as `/` and a standalone box outside auth mode.

  const apiBoxes = await getJson(hub, { path: "/api/boxes" });
  t.check([apiBoxes.status, apiBoxes.body], [
    200,
    {
      boxes: [
        {
          slug: "test1",
          name: "test1",
          symbol: null,
        },
      ],
    },
  ]);

  // ## `/healthz` is diag-key-gated (it used to leak slugs/PIDs/ports publicly)
  //
  // No key configured → 503 `unconfigured`; wrong/missing key → 401; correct key
  // → the verdict. (`BBX_DIAG_API_KEY` is read per-request, so temporarily unsetting
  // it exercises the unconfigured branch without restarting the hub.)

  const savedKey = process.env.BBX_DIAG_API_KEY;
  delete process.env.BBX_DIAG_API_KEY;
  const unconfigured = await fetch(`${hub.base}/healthz`);
  process.env.BBX_DIAG_API_KEY = savedKey;
  const noKey = await fetch(`${hub.base}/healthz`);
  const wrongKey = await fetch(`${hub.base}/healthz`, { headers: { authorization: "Bearer nope" } });
  t.check([unconfigured.status, noKey.status, wrongKey.status], [
    503,
    401,
    401,
  ]);

  // ## An `unhealthy` verdict is served as HTTP 503, not 200
  //
  // The status code carries the verdict so a monitor reading only the code alarms;
  // the body names the crash-looping box. Here `getHealth` is injected to report a
  // box latched `unhealthy` (the shape `hubVerdict` produces from supervisor state
  // — see `test/hub/health.test.ts` for the derivation itself).

  const brokenHealth = (): HubHealth => ({
    status: "unhealthy",
    boxes: [{ slug: "sick", status: "unhealthy", pid: undefined, port: undefined, restarts: 5, consecutiveFailures: 5, lastError: "ERR_DLOPEN_FAILED", lastStart: undefined }],
  });
  const brokenHub = await startHub(staticEndpointProvider([]), { getHealth: brokenHealth });
  const broken = await getJson(brokenHub, { path: "/healthz", ...diagAuth });
  t.check([broken.status, broken.body.status, broken.body.boxes?.[0]?.slug], [
    503,
    "unhealthy",
    "sick",
  ]);

  await stopHub(brokenHub);

});

void test("/healthz/canary cold-starts one box and reports whether it serves", async (t) => {
  t.teardown(async () => {
    try {
      await stopRouter(router);
    } catch (error) {
      t.error(error);
    }
  });
  const router = await startRouter();
  const { box } = router;

  // ## `/healthz/canary` cold-starts one box and reports whether it serves
  //
  // The deploy's child-level check: it drives `ensureRunning` server-side (the
  // passive verdict can't see a `stopped` box, and the diag key can't drive a box
  // through the proxy auth wall). A slug that comes ready → 200; a configured slug
  // whose cold-start never yields an endpoint → 503 `canary-failed`; an empty
  // config → 503 `no-boxes`.

  const canaryProvider = makeLazyProvider({ slug: "canarybox", origin: box.origin });
  const canaryHub = await startHub(canaryProvider, { boxes: [{ slug: "canarybox", boxRoot: "/nonexistent/canarybox" }] });

  // No ?box= → picks the first configured slug, cold-starts it, 200.
  const canaryOk = await getJson(canaryHub, { path: "/healthz/canary", ...diagAuth });
  t.check([canaryOk.status, canaryOk.body, canaryProvider.ensureCalls], [
    200,
    {
      status: "ok",
      slug: "canarybox",
    },
    1,
  ]);

  // A provider whose `ensureRunning` never yields an endpoint (the crash-loop case
  // — the child never becomes ready) → 503, naming the slug:

  const deadProvider = {
    get: (slug: string) => NO_ENDPOINTS.get(slug),
    slugs: () => ["deadbox"],
    ensureRunning: async (slug: string) => NO_ENDPOINTS.get(slug),
  };
  const deadHub = await startHub(deadProvider, { boxes: [{ slug: "deadbox", boxRoot: "/nonexistent/deadbox" }] });
  const canaryDead = await getJson(deadHub, { path: "/healthz/canary", ...diagAuth });
  t.check([canaryDead.status, canaryDead.body.status, canaryDead.body.slug], [
    503,
    "canary-failed",
    "deadbox",
  ]);

  await stopHub(deadHub);

  // An empty configuration has nothing to canary → 503 `no-boxes`:

  const emptyHub = await startHub(staticEndpointProvider([]), { boxes: [] });
  const canaryEmpty = await getJson(emptyHub, { path: "/healthz/canary", ...diagAuth });
  t.check([canaryEmpty.status, canaryEmpty.body], [
    503,
    {
      status: "no-boxes",
    },
  ]);

  await stopHub(emptyHub);

  // The canary is also diag-gated — no key → 401, and the gate runs BEFORE the
  // side effect, so an unauthorized request never cold-starts a box
  // (`ensureCalls` unchanged):

  const callsBefore = canaryProvider.ensureCalls;
  const canaryNoKey = await fetch(`${canaryHub.base}/healthz/canary`);
  t.check(canaryNoKey.status, 401);

  t.check(canaryProvider.ensureCalls, callsBefore);

  await stopHub(canaryHub);

  // ## The canary reproduces the incident path: a real Supervisor whose child never becomes ready → 503
  //
  // The fake providers above prove the route's branching; this proves the actual
  // production wiring. A lazy `Supervisor` with an injected `checkReady` that always
  // rejects models the 2026-07-16 ABI crash (the child never answers `/healthz`, so
  // `ensureRunning` never yields a live endpoint). The canary must 503, not 200.

  const crashFixture = await makeTmpBox();
  type ExitHandler = (code: number | null, signal: NodeJS.Signals | null) => void;
  function crashSpawn(): ChildProc {
    const exitHandlers: ExitHandler[] = [];
    // Deliberately partial fake: the supervisor reads only pid, on("exit"), and catch() before the readiness check fails.
    // A prototype-backed object carries the ChildProc type without running execa.
    return Object.assign(Object.create(Promise.prototype), { pid: 970001, on: (e: string, bbx: ExitHandler) => { if (e === "exit") exitHandlers.push(bbx); }, catch: () => {} });
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

  const canaryCrash = await getJson(crashHub, { path: "/healthz/canary", ...diagAuth });
  t.check([canaryCrash.status, canaryCrash.body.status, canaryCrash.body.slug], [
    503,
    "canary-failed",
    "crashbox",
  ]);

  await crashSupervisor.stopAll();
  await crashFixture.cleanup();
  await stopHub(crashHub);
});

// ## A configured box that cannot be served answers 503 with the reason
//
// A known slug with no endpoint is never a 404 (the 2026-09-16 incident's only
// symptom). While a maintenance owner holds the box, the body names the reason
// and the owner; otherwise it carries the provider's last word on the box.
void test("A known slug with no endpoint is never a 404 (the 2026-09-16 incident's only...", async (t) => {
  t.teardown(async () => {
    try {
      await owner.release();
      closedHub.server.close();
      for (const socket of closedHub.sockets) socket.destroy();
      await closedBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const closedBox = await makeTmpBox({ git: true });
  const provider = {
    get: (slug: string) => NO_ENDPOINTS.get(slug), slugs: () => ["closed", "broken"],
    unavailable: (slug: string) => new Map([["broken", "child exited with code 1"]]).get(slug),
  };
  const closedHub = await startHub(provider, { boxes: [{ slug: "closed", boxRoot: closedBox.root }, { slug: "broken", boxRoot: "/nonexistent/broken" }] });
  const owner = await acquireBoxMaintenance(closedBox.root, { reason: "migration" });
  // Retry-After is the lease's remaining whole seconds at request time. The
  // lease runs 600s from acquire, so pin the hub's clock to that moment: 600
  // is then exact, and still tells the lease from the 60s default. Unpinned, a
  // request more than a second after acquire read 599 (2026-10-08).
  const realNow = Date.now;
  const leaseStart = Date.parse((await boxMaintenanceStatus(closedBox.root))?.until ?? "") - 600_000;
  Date.now = () => leaseStart;
  const closedResponse = await fetch(`${closedHub.base}/closed/api/x`);
  const closedBody = HubJson.parse(await closedResponse.json());
  const retryAfter = closedResponse.headers.get("retry-after");
  t.check({ status: closedResponse.status, retryAfter, body: closedBody }, {
    status: 503,
    retryAfter: "600",
    body: {
      error: "box_closed",
      reason: "migration",
      owner: { pid: process.pid, since: isoDate() },
      since: isoDate(),
      message: str`Box closed is closed for migration (pid ${String(process.pid)}, since ${isoDate()}); it reopens when that process finishes or exits`,
    },
  });

  // A page navigation (a browser, the iOS web view) gets a scriptless page: a
  // sign that swings once, the sentence, and a refresh after Retry-After.
  const page = await fetch(`${closedHub.base}/closed/chat`, { headers: { accept: "text/html,application/xhtml+xml" } });
  const html = await page.text();
  t.check({ status: page.status, type: page.headers.get("content-type"), refresh: html.match(/<meta http-equiv="refresh" content="(\d+)">/u)?.[1], headline: html.match(/<h1 class="bbx-sign-title">([^<]*)<\/h1><p>([^<]*)<\/p>/u)?.slice(1), sign: html.match(/<div class="(bbx-sign[^"]*)">/u)?.[1], scripts: html.match(/<script/gu), detail: html.match(/<p class="detail">([^<]*)<\/p>/u)?.[1]?.replace(/\(pid \d+, since \S+\)/u, "(pid <n>, since <time>)") }, {
    status: 503,
    type: "text/html; charset=utf-8",
    refresh: "600",
    headline: [
      "Closed",
      "for migration",
    ],
    sign: "bbx-sign swing",
    scripts: null,
    detail: "Box closed is closed for migration (pid <n>, since <time>); it reopens when that process finishes or exits",
  });

  // A form post that accepts HTML gets the sentence as text: a self-reload would repeat it as a GET.
  const posted = await fetch(`${closedHub.base}/closed/chat`, { method: "POST", headers: { accept: "text/html" } });
  t.check({ status: posted.status, type: posted.headers.get("content-type"), text: (await posted.text()).replace(/\(pid \d+, since \S+\)/u, "(pid <n>, since <time>)").replace(/Retry in \d+ seconds/u, "Retry in <n> seconds") }, {
    status: 503,
    type: "text/plain; charset=utf-8",
    text: `Box closed is closed for migration (pid <n>, since <time>); it reopens when that process finishes or exits
Retry in <n> seconds.
`,
  });

  // Once the owner names a step, the sentence and the body say which one is running.
  await owner.step("finding changed files");
  const stepped = z.object({ step: z.unknown(), message: z.string() }).parse(await (await fetch(`${closedHub.base}/closed/api/x`)).json());
  t.check(({ step: stepped.step, message: stepped.message.replace(/\(pid \d+, since \S+\)/u, "(pid <n>, since <time>)") }), {
    step: {
      name: "finding changed files",
      since: str`${isoDate()}`,
    },
    message: str`Box closed is closed for migration (pid <n>, since <time>); current step: finding changed files, since ${isoDate()}; it reopens when that process finishes or exits`,
  });

  Date.now = realNow;

  await owner.beginChanges();
  await owner.release();
  const reopened = await fetch(`${closedHub.base}/closed/api/x`);
  t.check({ status: reopened.status, error: HubJson.parse(await reopened.json()).error }, {
    status: 503,
    error: "box_unavailable",
  });

  // Pairing redemption passes the auth wall unauthenticated and learns nothing about the owner.
  const unauthed = await startHub(provider, { boxes: [{ slug: "closed", boxRoot: closedBox.root }], openAccess: false });
  const sealed = await acquireBoxMaintenance(closedBox.root, { reason: "migration" });
  const redeem = await fetch(`${unauthed.base}/closed/api/pairing/redeem`, { method: "POST" });
  t.check({ status: redeem.status, body: await redeem.json() }, {
    status: 503,
    body: {
      error: "box_unavailable",
      message: "Box closed is not running",
    },
  });

  await sealed.complete();
  unauthed.server.close();
  for (const socket of unauthed.sockets) socket.destroy();
  const latchedResponse = await fetch(`${closedHub.base}/broken/api/x`);
  t.check({ status: latchedResponse.status, body: await latchedResponse.json() }, {
    status: 503,
    body: {
      error: "box_unavailable",
      message: "Box broken is not running: child exited with code 1",
    },
  });
});

// A retry shorter than the swing would restart it on every reload, so a short
// retry gets a still sign; message text is escaped.
void test("A retry shorter than the swing would restart it on every reload, so a short r...", async (t) => {
  const quick = renderUnavailablePage({ status: 503, retryAfter: 3, body: { error: "box_unavailable", message: "Box <b> is not running" } });
  t.check({ refresh: quick.match(/content="(\d+)">/u)?.[1], sign: quick.match(/<div class="(bbx-sign[^"]*)">/u)?.[1], headline: quick.match(/<h1 class="bbx-sign-title">([^<]*)<\/h1>/u)?.[1], detail: quick.match(/<p class="detail">([^<]*)<\/p>/u)?.[1] }, {
    refresh: "3",
    sign: "bbx-sign",
    headline: "Not open",
    detail: "Box &lt;b&gt; is not running",
  });
});
