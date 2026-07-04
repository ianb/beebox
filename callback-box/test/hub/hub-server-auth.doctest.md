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
import { createHubServer } from "../../src/hub/hub-server.js";
import { staticEndpointProvider } from "../../src/hub/endpoints.js";
import { signSession, COOKIE_NAME } from "../../src/webapp/auth.js";

const HUB_SECRET = "test-hub-secret-for-auth-doctest";

process.env.CB_SESSION_SECRET = "test-session-secret-for-hub-server-auth-doctest";
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id-for-hub-server-auth-doctest";

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
const endpoints = staticEndpointProvider([{ slug: "test1", origin: box.origin }]);
const hubServer = await createHubServer({
  endpoints,
  getHealth: () => ({ status: "ok", boxes: [] }),
  hubSecret: HUB_SECRET,
  boxes: [{ slug: "test1", boxRoot: "/nonexistent/test1" }],
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

```ts cleanup
delete process.env.GOOGLE_OAUTH_CLIENT_ID;
delete process.env.CB_SESSION_SECRET;
for (const socket of hubSockets) socket.destroy();
for (const socket of box.sockets) socket.destroy();
await new Promise((resolve) => hubServer.close(resolve));
await new Promise((resolve) => box.server.close(resolve));
```
