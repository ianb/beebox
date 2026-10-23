// # Hub-side auth gating: cookie in, hub-secret header out (Track D, chunk D2)
//
// With `GOOGLE_OAUTH_CLIENT_ID` set, the hub is the ONE process that verifies
// the session cookie (it's the only process that may hold the signing
// secret — see `src/webapp/auth.ts`'s `resolveRequestIdentity` doc comment
// for why). This test exercises the hub's proxy path with hub auth
// **enabled**: unauthenticated HTML navigation redirects to `/auth/login`,
// unauthenticated API/WS gets a bare 401, an authenticated cookie becomes an
// `x-bbx-authenticated-email` header on the proxied request, and
// `/healthz` stays outside the wall regardless.

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import http from "node:http";
import net from "node:net";
import assert from "node:assert/strict";
import { z } from "zod";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { createHubServer } from "../../src/hub/server/core.js";
import { staticEndpointProvider } from "../../src/hub/endpoints.js";
import { signSession, COOKIE_NAME } from "../../src/webapp/auth.js";
import { createFirstUser, setPassword } from "../../src/webapp/local-users.js";
import { resetLocalUserCache } from "../../src/webapp/local-users-cache.js";
import { createMobilePairingTicket, redeemMobilePairingTicket } from "../../src/core/mobile/pairing.js";
import { MOBILE_COOKIE_NAME, MOBILE_SESSION_TTL_MS, signMobileSession } from "../../src/core/mobile/session.js";
import { getOrCreateAgentToken } from "../../src/core/agent/token.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

const HUB_SECRET = "test-hub-secret-for-auth-test";

process.env.BBX_SESSION_SECRET = "test-session-secret-for-hub-server-auth-test";
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id-for-hub-server-auth-test";
// registerAuthRoutes now fails loudly on an ID-without-secret half-config
// (MissingOAuthClientSecretError), so the fake credentials must be a pair.
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret-for-hub-server-auth-test";

// A per-test credential store (empty until the gen-revocation section creates an
// owner) with a fast test-only scrypt work factor. Pointing BBX_AUTH_FILE at a
// tmp path also keeps every cookie check off any real ~/.bbx-auth.json.
const authDir = await mkdtemp(path.join(os.tmpdir(), "bbx-hub-auth-"));
process.env.BBX_AUTH_FILE = path.join(authDir, "auth.json");
process.env.BBX_AUTH_SCRYPT_N = "1024";

/** What the fake box echoes back: the request URL and the identity headers it received. */
const BoxEcho = z.object({
  url: z.string(),
  xBbxAuthenticatedEmail: z.string().nullable(),
  xBbxHubSecret: z.string().nullable(),
});

function portOf(server: http.Server): number {
  const address = server.address();
  assert.ok(address && typeof address === "object", "server is listening on a TCP port");
  return address.port;
}

function listen(server: http.Server): Promise<void> {
  return new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
}

function close(server: http.Server): Promise<void> {
  return new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
}

async function startFakeBox() {
  const sockets: net.Socket[] = [];
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      url: req.url,
      xBbxAuthenticatedEmail: req.headers["x-bbx-authenticated-email"] ?? null,
      xBbxHubSecret: req.headers["x-bbx-hub-secret"] ?? null,
    }));
  });
  server.on("connection", (socket) => sockets.push(socket));
  await listen(server);
  const port = portOf(server);
  return { server, sockets, port, origin: `http://127.0.0.1:${port}` };
}

const box = await startFakeBox();
const mobileBox = await makeTmpBox();
const mobileTicket = createMobilePairingTicket(mobileBox.root);
const mobileRedeemed = await redeemMobilePairingTicket(mobileBox.root, {
  pairingToken: mobileTicket.token,
  deviceLabel: "test mobile",
});
if (!mobileRedeemed) throw new Error("test mobile pairing failed");
const mobileToken = mobileRedeemed.deviceToken;
const mobileDeviceId = mobileRedeemed.deviceId;
const endpoints = staticEndpointProvider([{ slug: "test1", origin: box.origin }]);
const hubServer = await createHubServer({
  endpoints,
  getHealth: () => ({ status: "ok", boxes: [] }),
  hubSecret: HUB_SECRET,
  boxes: [{ slug: "test1", boxRoot: mobileBox.root }],
  baseUrl: "http://127.0.0.1",
});
const hubSockets: net.Socket[] = [];
hubServer.on("connection", (socket) => hubSockets.push(socket));
await listen(hubServer);
const hubBase = `http://127.0.0.1:${portOf(hubServer)}`;

// ## Unauthenticated HTML navigation redirects to `/auth/login`
void test("Unauthenticated HTML navigation redirects to `/auth/login`", async (t) => {
  t.teardown(async () => {
    try {
      delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      delete process.env.BBX_SESSION_SECRET;
      delete process.env.BBX_AUTH_FILE;
      delete process.env.BBX_AUTH_SCRYPT_N;
      await rm(authDir, { recursive: true, force: true });
      await mobileBox.cleanup();
      for (const socket of hubSockets) socket.destroy();
      for (const socket of box.sockets) socket.destroy();
      await close(hubServer);
      await close(box.server);
    } catch (error) {
      t.error(error);
    }
  });
  await loginAndProxy(t);
  await bogusCredentials(t);
  await discovery(t);
  await healthzAndWebhookPrefix(t);
  await revocation(t);
});

async function loginAndProxy(t: Test) {
  const navResponse = await fetch(`${hubBase}/test1/browse/some-card`, { redirect: "manual" });
  t.check(navResponse.status, 302);

  t.check(navResponse.headers.get("location"), "/auth/login?returnTo=%2Ftest1%2Fbrowse%2Fsome-card");

  // ## A mobile bearer token proxies without a browser session

  const mobileResponse = await fetch(`${hubBase}/test1/chat?nativeComposer=1`, {
    headers: { authorization: `Bearer ${mobileToken}` },
  });
  const mobileBody = BoxEcho.parse(await mobileResponse.json());
  t.check(
    {
      status: mobileResponse.status,
      url: mobileBody.url,
      email: mobileBody.xBbxAuthenticatedEmail,
      secret: mobileBody.xBbxHubSecret,
    },
    {
    status: 200,
    url: "/test1/chat?nativeComposer=1",
    email: null,
    secret: null,
  },
  );

  // ## The box's agent token proxies without a browser session
  //
  // A `bbx` command run with the hub's URL sends the box's agent token. The hub
  // checks it against that box's token file and proxies it with no identity
  // attached; the box child checks it again. A different token is a bare 401.

  const agentToken = getOrCreateAgentToken(mobileBox.root);
  const agentResponse = await fetch(`${hubBase}/test1/api/chat/ui/request`, {
    method: "POST",
    headers: { authorization: `Bearer ${agentToken}` },
  });
  const agentBody = BoxEcho.parse(await agentResponse.json());
  const wrongAgent = await fetch(`${hubBase}/test1/api/chat/ui/request`, {
    method: "POST",
    headers: { authorization: `Bearer ${"0".repeat(64)}` },
  });
  t.check(({ status: agentResponse.status, email: agentBody.xBbxAuthenticatedEmail, secret: agentBody.xBbxHubSecret, wrong: wrongAgent.status }), {
    status: 200,
    email: null,
    secret: null,
    wrong: 401,
  });

}

async function bogusCredentials(t: Test) {
  // ## Unauthenticated and bogus API requests get a bare 401 (no redirect, no enumeration)
  //
  // An unauthenticated API request gets a bare 401, not a redirect.
  //
  // The hub's mobile gate used to be presence-only: any `Authorization: Bearer `
  // prefix, verified by nobody, was enough to skip the auth wall and be proxied to
  // the box, which meant an unauthenticated caller could cold-start a stopped box
  // (known risk S1). The gate now verifies, so a syntactically valid but
  // cryptographically worthless credential is rejected here rather than downstream.
  //
  // The rejection must not leak whether the slug exists: a valid-but-live slug with
  // a worthless token and a slug that was never configured have to answer
  // identically, and neither may cold-start a box. Because the auth wall rejects
  // BEFORE the endpoint is resolved, all of them return the same bare 401. An
  // attacker learns nothing about which slugs are real, and pays no box-wake for
  // the guess.

  const trpcPath = "/api/trpc/health.check";
  const refused: Array<[string, string, Record<string, string>]> = [
    ["no credential, real slug", "test1", {}],
    ["bogus bearer, real slug", "test1", { authorization: "Bearer not-a-real-device-token" }],
    ["bogus bbx_mobile cookie, real slug", "test1", { cookie: "bbx_mobile=forged.deadbeef" }],
    ["worthless bearer, real slug", "test1", { authorization: "Bearer worthless" }],
    ["worthless bearer, unknown slug", "nosuchbox", { authorization: "Bearer worthless" }],
    ["no credential, unknown slug", "nosuchbox", {}],
  ];
  const refusedLines = [];
  for (const [label, slug, headers] of refused) {
    refusedLines.push(`${label} → ${(await fetch(`${hubBase}/${slug}${trpcPath}`, { headers })).status}`);
  }
  await t.checkText(refusedLines.join("\n"), `no credential, real slug → 401
bogus bearer, real slug → 401
bogus bbx_mobile cookie, real slug → 401
worthless bearer, real slug → 401
worthless bearer, unknown slug → 401
no credential, unknown slug → 401`);

  // A real `bbx_mobile` cookie does pass — this is the credential a WebSocket
  // upgrade carries, since the browser API cannot set headers on one.

  const mobileCookie = signMobileSession(mobileBox.root, {
    deviceId: mobileDeviceId,
    createdBy: null,
    ttlMs: MOBILE_SESSION_TTL_MS,
  });
  const cookieResponse = await fetch(`${hubBase}/test1/chat?nativeComposer=1`, {
    headers: { cookie: `${MOBILE_COOKIE_NAME}=${mobileCookie}` },
  });
  t.check(cookieResponse.status, 200);

}

async function discovery(t: Test) {
  // ## A mobile bearer token can discover its paired box

  const boxesWithoutMobileAuth = await fetch(`${hubBase}/api/boxes`);
  t.check(await boxesWithoutMobileAuth.json(), {
    boxes: [],
    authRequired: true,
  });

  const boxesWithMobileAuth = await fetch(`${hubBase}/api/boxes`, {
    headers: { authorization: `Bearer ${mobileToken}` },
  });
  t.check(await boxesWithMobileAuth.json(), {
    boxes: [
      {
        slug: "test1",
        name: "test1",
        symbol: null,
      },
    ],
  });

  // ## Unauthenticated mobile pairing redemption proxies to the box
  //
  // Pairing redemption is the one non-webhook API path that starts unauthenticated:
  // the box validates the short-lived pairing token itself, before creating a
  // device bearer token. The hub should pass the request through without injecting a
  // browser identity.

  const pairingResponse = await fetch(`${hubBase}/test1/api/pairing/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pairingToken: "test-token", deviceLabel: "test device" }),
  });
  const pairingBody = BoxEcho.parse(await pairingResponse.json());
  t.check(
    {
      status: pairingResponse.status,
      url: pairingBody.url,
      email: pairingBody.xBbxAuthenticatedEmail,
      secret: pairingBody.xBbxHubSecret,
    },
    {
    status: 200,
    url: "/test1/api/pairing/redeem",
    email: null,
    secret: null,
  },
  );

  // ## A valid session cookie becomes `x-bbx-authenticated-email` on the proxied request

  const cookieValue = signSession({ email: "person@example.com", name: "Person" });
  const authedResponse = await fetch(`${hubBase}/test1/browse/some-card`, {
    headers: { cookie: `${COOKIE_NAME}=${cookieValue}` },
  });
  t.check(authedResponse.status, 200);

  const authedBody = BoxEcho.parse(await authedResponse.json());
  t.check({ email: authedBody.xBbxAuthenticatedEmail, secret: authedBody.xBbxHubSecret }, {
    email: "person@example.com",
    secret: "test-hub-secret-for-auth-test",
  });

}

async function healthzAndWebhookPrefix(t: Test) {
  // ## `/healthz` is outside the session/OAuth wall, but diag-key-gated
  //
  // `/healthz` never redirects to login the way a protected box path does (the
  // whole point of it being outside the auth wall — an uptime monitor has no
  // session). But it carries its own diag-key gate, so an unauthenticated caller
  // gets a 401 from the gate, NOT a 302 to `/auth/login`. With the diag bearer key
  // it returns the verdict.

  process.env.BBX_DIAG_API_KEY = "test-diag-key-for-auth-test";

  const healthzNoKey = await fetch(`${hubBase}/healthz`, { redirect: "manual" });
  t.check(healthzNoKey.status, 401);

  const healthzWithKey = await fetch(`${hubBase}/healthz`, { headers: { authorization: "Bearer test-diag-key-for-auth-test" } });
  t.check(healthzWithKey.status, 200);

  delete process.env.BBX_DIAG_API_KEY;

  // ## `/webhook/<slug>/…` has no anonymous passthrough
  //
  // No box registers a webhook route. An anonymous request there gets the same
  // login redirect as any other protected path, so it cannot wake a box or
  // learn whether a slug exists.

  const webhookResponse = await fetch(`${hubBase}/webhook/test1/incoming`, { redirect: "manual" });
  t.check(
    { status: webhookResponse.status, location: webhookResponse.headers.get("location") },
    { status: 302, location: "/auth/login?returnTo=%2Fwebhook%2Ftest1%2Fincoming" },
  );

  // ## An unauthenticated WebSocket upgrade is rejected with a raw 401 (no cookie fallback either)

  function rawUpgradeRequest({ port, path: reqPath, headers }: { port: number; path: string; headers?: Record<string, string> }): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const socket = net.connect(port, "127.0.0.1", () => {
        const headerLines = Object.entries(headers ?? {}).map(([k, v]) => `${k}: ${v}\r\n`).join("");
        socket.write(
          `GET ${reqPath} HTTP/1.1\r\n` +
          `Host: 127.0.0.1:${port}\r\n` +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          headerLines +
          "\r\n"
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

  const unauthedUpgrade = await rawUpgradeRequest({ port: portOf(hubServer), path: "/test1/ws" });
  t.check(unauthedUpgrade, "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");

  // The webhook prefix gets no exception on the upgrade path either.
  const webhookUpgrade = await rawUpgradeRequest({ port: portOf(hubServer), path: "/webhook/test1/ws" });
  t.check(webhookUpgrade, "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");

}

async function revocation(t: Test) {
  // ## `gen`-revocation applies at the hub (FIX 1): a password change kills the old cookie
  //
  // The hub verifies the cookie through the SAME `resolveRequestIdentity` a box uses,
  // so a cookie minted before a password change (stale `gen`) is rejected at the hub —
  // `decideHubAuth` no longer trusts an HMAC-valid-but-revoked cookie.

  await createFirstUser({ email: "owner@example.com", name: "Owner", password: "pw-original" });
  resetLocalUserCache();

  // A cookie minted now carries the record's current gen (1) and proxies through.
  const genCookie = signSession({ email: "owner@example.com", name: "Owner" });
  const authedGen = await fetch(`${hubBase}/test1/browse/x`, { headers: { cookie: `${COOKIE_NAME}=${genCookie}` } });
  t.check(authedGen.status, 200);

  // Change the password → gen bumps to 2 → the old cookie is now revoked.
  await setPassword({ email: "owner@example.com", password: "pw-rotated" });
  resetLocalUserCache();
  const revoked = await fetch(`${hubBase}/test1/browse/x`, {
    headers: { cookie: `${COOKIE_NAME}=${genCookie}` },
    redirect: "manual",
  });
  t.check(revoked.status, 302);

  t.check(revoked.headers.get("location"), "/auth/login?returnTo=%2Ftest1%2Fbrowse%2Fx");
}
