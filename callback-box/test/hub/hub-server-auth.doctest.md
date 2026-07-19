# Hub-side auth gating: cookie in, hub-secret header out (Track D, chunk D2)

With `GOOGLE_OAUTH_CLIENT_ID` set, the hub is the ONE process that verifies
the session cookie (it's the only process that may hold the signing
secret — see `src/webapp/auth.ts`'s `resolveRequestIdentity` doc comment
for why). This doctest exercises the hub's proxy path with hub auth
**enabled**: unauthenticated HTML navigation redirects to `/auth/login`,
unauthenticated API/WS gets a bare 401, an authenticated cookie becomes an
`x-cb-authenticated-email` header on the proxied request, and
`/healthz` + `/webhook/<slug>/*` stay outside the wall regardless.

```ts setup
import http from "node:http";
import net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { createHubServer } from "../../src/hub/hub-server.js";
import { staticEndpointProvider } from "../../src/hub/endpoints.js";
import { signSession, COOKIE_NAME } from "../../src/webapp/auth.js";
import { createFirstUser, setPassword } from "../../src/webapp/local-users.js";
import { resetLocalUserCache } from "../../src/webapp/local-users-cache.js";
import { createMobilePairingTicket, redeemMobilePairingTicket } from "../../src/core/mobile/pairing.js";
import { MOBILE_COOKIE_NAME, MOBILE_SESSION_TTL_MS, signMobileSession } from "../../src/core/mobile/mobile-session.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const HUB_SECRET = "test-hub-secret-for-auth-doctest";

process.env.CB_SESSION_SECRET = "test-session-secret-for-hub-server-auth-doctest";
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id-for-hub-server-auth-doctest";
// registerAuthRoutes now fails loudly on an ID-without-secret half-config
// (MissingOAuthClientSecretError), so the fake credentials must be a pair.
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret-for-hub-server-auth-doctest";

// A per-test credential store (empty until the gen-revocation section creates an
// owner) with a fast test-only scrypt work factor. Pointing CB_AUTH_FILE at a
// tmp path also keeps every cookie check off any real ~/.cb-auth.json.
const authDir = await mkdtemp(path.join(os.tmpdir(), "cb-hub-auth-"));
process.env.CB_AUTH_FILE = path.join(authDir, "auth.json");
process.env.CB_AUTH_SCRYPT_N = "1024";

async function startFakeBox() {
  const sockets = [];
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      url: req.url,
      xCbAuthenticatedEmail: req.headers["x-cb-authenticated-email"] ?? null,
      xCbHubSecret: req.headers["x-cb-hub-secret"] ?? null,
    }));
  });
  server.on("connection", (socket) => sockets.push(socket));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, sockets, port, origin: `http://127.0.0.1:${port}` };
}

const box = await startFakeBox();
const mobileBox = await makeTmpBox();
const mobileTicket = createMobilePairingTicket(mobileBox.root);
const mobileRedeemed = redeemMobilePairingTicket(mobileBox.root, {
  pairingToken: mobileTicket.token,
  deviceLabel: "doctest mobile",
});
if (!mobileRedeemed) throw new Error("doctest mobile pairing failed");
const mobileToken = mobileRedeemed.deviceToken;
const endpoints = staticEndpointProvider([{ slug: "test1", origin: box.origin }]);
const hubServer = await createHubServer({
  endpoints,
  getHealth: () => ({ status: "ok", boxes: [] }),
  hubSecret: HUB_SECRET,
  boxes: [{ slug: "test1", boxRoot: mobileBox.root }],
});
const hubSockets = [];
hubServer.on("connection", (socket) => hubSockets.push(socket));
await new Promise((resolve) => hubServer.listen(0, "127.0.0.1", resolve));
const hubBase = `http://127.0.0.1:${hubServer.address().port}`;
```

## Unauthenticated HTML navigation redirects to `/auth/login`

```ts
const navResponse = await fetch(`${hubBase}/test1/browse/some-card`, { redirect: "manual" });
navResponse.status
=> 302

navResponse.headers.get("location")
=> /auth/login?returnTo=%2Ftest1%2Fbrowse%2Fsome-card
```

## Unauthenticated API request gets a bare 401 (no redirect)

```ts continue
const apiResponse = await fetch(`${hubBase}/test1/api/trpc/health.check`);
apiResponse.status
=> 401
```

## A mobile bearer token proxies without a browser session

```ts continue
const mobileResponse = await fetch(`${hubBase}/test1/chat?embed=1`, {
  headers: { authorization: `Bearer ${mobileToken}` },
});
const mobileBody = await mobileResponse.json();
JSON.stringify({
  status: mobileResponse.status,
  url: mobileBody.url,
  email: mobileBody.xCbAuthenticatedEmail,
  secret: mobileBody.xCbHubSecret,
})
=> {"status":200,"url":"/test1/chat?embed=1","email":null,"secret":null}
```

## A bogus mobile credential does NOT get past the hub

The hub's mobile gate used to be presence-only: any `Authorization: Bearer `
prefix, verified by nobody, was enough to skip the auth wall and be proxied to
the box — which meant an unauthenticated caller could cold-start a stopped box
(known risk S1). The gate now verifies, so a syntactically valid but
cryptographically worthless credential is rejected here rather than downstream.

```ts continue
const bogusBearer = await fetch(`${hubBase}/test1/api/trpc/health.check`, {
  headers: { authorization: "Bearer not-a-real-device-token" },
});
bogusBearer.status
=> 401

const bogusCookie = await fetch(`${hubBase}/test1/api/trpc/health.check`, {
  headers: { cookie: "cb_mobile=forged.deadbeef" },
});
bogusCookie.status
=> 401
```

A real `cb_mobile` cookie does pass — this is the credential a WebSocket
upgrade carries, since the browser API cannot set headers on one.

```ts continue
const mobileCookie = signMobileSession(mobileBox.root, {
  deviceId: mobileRedeemed.deviceId,
  createdBy: null,
  ttlMs: MOBILE_SESSION_TTL_MS,
});
const cookieResponse = await fetch(`${hubBase}/test1/chat?embed=1`, {
  headers: { cookie: `${MOBILE_COOKIE_NAME}=${mobileCookie}` },
});
cookieResponse.status
=> 200
```

## A mobile bearer token can discover its paired box

```ts continue
const boxesWithoutMobileAuth = await fetch(`${hubBase}/api/boxes`);
JSON.stringify(await boxesWithoutMobileAuth.json())
=> {"boxes":[],"authRequired":true}

const boxesWithMobileAuth = await fetch(`${hubBase}/api/boxes`, {
  headers: { authorization: `Bearer ${mobileToken}` },
});
JSON.stringify(await boxesWithMobileAuth.json())
=> {"boxes":[{"slug":"test1","name":"test1"}]}
```

## Unauthenticated mobile pairing redemption proxies to the box

Pairing redemption is the one non-webhook API path that starts unauthenticated:
the box validates the short-lived pairing token itself, before creating a
device bearer token. The hub should pass the request through without injecting a
browser identity.

```ts continue
const pairingResponse = await fetch(`${hubBase}/test1/api/pairing/redeem`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ pairingToken: "test-token", deviceLabel: "test device" }),
});
const pairingBody = await pairingResponse.json();
JSON.stringify({
  status: pairingResponse.status,
  url: pairingBody.url,
  email: pairingBody.xCbAuthenticatedEmail,
  secret: pairingBody.xCbHubSecret,
})
=> {"status":200,"url":"/test1/api/pairing/redeem","email":null,"secret":null}
```

## A valid session cookie becomes `x-cb-authenticated-email` on the proxied request

```ts continue
const cookieValue = signSession({ email: "person@example.com", name: "Person" });
const authedResponse = await fetch(`${hubBase}/test1/browse/some-card`, {
  headers: { cookie: `${COOKIE_NAME}=${cookieValue}` },
});
authedResponse.status
=> 200

const authedBody = await authedResponse.json();
JSON.stringify({ email: authedBody.xCbAuthenticatedEmail, secret: authedBody.xCbHubSecret })
=> {"email":"person@example.com","secret":"test-hub-secret-for-auth-doctest"}
```

## `/healthz` stays open regardless of auth

```ts continue
const healthzResponse = await fetch(`${hubBase}/healthz`);
healthzResponse.status
=> 200
```

## A webhook path proxies through with NO session required, and no email attached

```ts continue
const webhookResponse = await fetch(`${hubBase}/webhook/test1/incoming`);
const webhookBody = await webhookResponse.json();
webhookResponse.status
=> 200

JSON.stringify({ email: webhookBody.xCbAuthenticatedEmail, secret: webhookBody.xCbHubSecret })
=> {"email":null,"secret":"test-hub-secret-for-auth-doctest"}
```

## An unauthenticated WebSocket upgrade is rejected with a raw 401 (no cookie fallback either)

```ts continue
function rawUpgradeRequest({ port, path, headers = {} }) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      const headerLines = Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join("");
      socket.write(
        `GET ${path} HTTP/1.1\r\n` +
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

const unauthedUpgrade = await rawUpgradeRequest({ port: hubServer.address().port, path: "/test1/ws" });
unauthedUpgrade.startsWith("HTTP/1.1 401")
=> true
```

## `gen`-revocation applies at the hub (FIX 1): a password change kills the old cookie

The hub verifies the cookie through the SAME `resolveRequestIdentity` a box uses,
so a cookie minted before a password change (stale `gen`) is rejected at the hub —
`decideHubAuth` no longer trusts an HMAC-valid-but-revoked cookie.

```ts continue
await createFirstUser({ email: "owner@example.com", name: "Owner", password: "pw-original" });
resetLocalUserCache();

// A cookie minted now carries the record's current gen (1) and proxies through.
const genCookie = signSession({ email: "owner@example.com", name: "Owner" });
const authedGen = await fetch(`${hubBase}/test1/browse/x`, { headers: { cookie: `${COOKIE_NAME}=${genCookie}` } });
authedGen.status
=> 200

// Change the password → gen bumps to 2 → the old cookie is now revoked.
await setPassword({ email: "owner@example.com", password: "pw-rotated" });
resetLocalUserCache();
const revoked = await fetch(`${hubBase}/test1/browse/x`, {
  headers: { cookie: `${COOKIE_NAME}=${genCookie}` },
  redirect: "manual",
});
revoked.status
=> 302

revoked.headers.get("location")
=> /auth/login?returnTo=%2Ftest1%2Fbrowse%2Fx
```

```ts cleanup
delete process.env.GOOGLE_OAUTH_CLIENT_ID;
delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
delete process.env.CB_SESSION_SECRET;
delete process.env.CB_AUTH_FILE;
delete process.env.CB_AUTH_SCRYPT_N;
await rm(authDir, { recursive: true, force: true });
await mobileBox.cleanup();
for (const socket of hubSockets) socket.destroy();
for (const socket of box.sockets) socket.destroy();
await new Promise((resolve) => hubServer.close(resolve));
await new Promise((resolve) => box.server.close(resolve));
```
