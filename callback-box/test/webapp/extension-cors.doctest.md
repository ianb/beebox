# Chrome-extension CORS for the clerk tRPC endpoints

The clerk browser extension calls the box's `clerk` tRPC procedures cross-origin
with `credentials: include`. Its `application/json` POST triggers a CORS
preflight, so an extension-origin `OPTIONS` must be answered with the origin
reflected + the method/header allowances — before Fastify's auto-generated
OPTIONS (which omits the origin reflection) can respond. `onSend` also reflects
the origin on the real request's response.

```ts setup
import Fastify from "fastify";
import { registerChromeExtensionCors } from "../../src/webapp/server-root.js";

async function makeServer() {
  const app = Fastify();
  registerChromeExtensionCors(app);
  // Stand in for a tRPC procedure route (POST). Its presence means Fastify
  // would auto-generate an OPTIONS without CORS — the hook must win.
  app.post("/api/trpc/clerk.commentary", async () => ({ result: { data: { ok: true } } }));
  return app;
}

const EXT = "chrome-extension://abcdefghijklmnop";
```

## Extension-origin preflight is answered with the origin reflected

```ts
const app = await makeServer();
const res = await app.inject({
  method: "OPTIONS",
  url: "/api/trpc/clerk.commentary",
  headers: { origin: EXT, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
});
print(`status: ${res.statusCode}`);
print(`allow-origin: ${res.headers["access-control-allow-origin"]}`);
print(`allow-credentials: ${res.headers["access-control-allow-credentials"]}`);
print(`methods include POST: ${String(res.headers["access-control-allow-methods"]).includes("POST")}`);
print(`allow-headers: ${res.headers["access-control-allow-headers"]}`);
=>
status: 204
allow-origin: chrome-extension://abcdefghijklmnop
allow-credentials: true
methods include POST: true
allow-headers: Content-Type
```

## The real POST response also reflects the extension origin

```ts continue
const post = await app.inject({
  method: "POST",
  url: "/api/trpc/clerk.commentary",
  headers: { origin: EXT, "content-type": "application/json" },
  payload: {},
});
print(`status: ${post.statusCode}`);
print(`allow-origin: ${post.headers["access-control-allow-origin"]}`);
=>
status: 200
allow-origin: chrome-extension://abcdefghijklmnop
```

## A non-extension origin gets no CORS grant

A normal cross-origin site's preflight falls through to default handling — no
`Access-Control-Allow-Origin`, so the browser blocks it.

```ts continue
const evil = await app.inject({
  method: "OPTIONS",
  url: "/api/trpc/clerk.commentary",
  headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
});
print(`allow-origin: ${evil.headers["access-control-allow-origin"] ?? "(none)"}`);
=>
allow-origin: (none)
```
