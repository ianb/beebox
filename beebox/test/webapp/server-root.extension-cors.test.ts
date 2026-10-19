// # Chrome-extension CORS for the clerk tRPC endpoints
//
// The clerk browser extension calls the box's `clerk` tRPC procedures cross-origin
// with `credentials: include`. Its `application/json` POST triggers a CORS
// preflight, so an extension-origin `OPTIONS` must be answered with the origin
// reflected + the method/header allowances — before Fastify's auto-generated
// OPTIONS (which omits the origin reflection) can respond. `onSend` also reflects
// the origin on the real request's response.

import { test } from "tap";
import "agent-doctest/tap";
import Fastify from "fastify";
import { registerChromeExtensionCors } from "../../src/webapp/server-root/root-routes.js";

async function makeServer() {
  const app = Fastify();
  registerChromeExtensionCors(app);
  // Stand in for a tRPC procedure route (POST). Its presence means Fastify
  // would auto-generate an OPTIONS without CORS — the hook must win.
  app.post("/api/trpc/clerk.commentary", async () => ({ result: { data: { ok: true } } }));
  return app;
}

const EXT = "chrome-extension://abcdefghijklmnop";

// ## Extension-origin preflight is answered with the origin reflected
void test("Extension-origin preflight is answered with the origin reflected", async (t) => {
  // doctest:L29
  const app = await makeServer();
  const res = await app.inject({
    method: "OPTIONS",
    url: "/api/trpc/clerk.commentary",
    headers: { origin: EXT, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
  });
  t.check({
    status: res.statusCode,
    origin: res.headers["access-control-allow-origin"],
    credentials: res.headers["access-control-allow-credentials"],
    methods: res.headers["access-control-allow-methods"],
    headers: res.headers["access-control-allow-headers"],
  }, {
    status: 204,
    origin: "chrome-extension://abcdefghijklmnop",
    credentials: "true",
    methods: "GET,POST,OPTIONS",
    headers: "Content-Type",
  });

  // ## The real POST response also reflects the extension origin

  // doctest:L51
  const post = await app.inject({
    method: "POST",
    url: "/api/trpc/clerk.commentary",
    headers: { origin: EXT, "content-type": "application/json" },
    payload: {},
  });
  t.check({ status: post.statusCode, origin: post.headers["access-control-allow-origin"] }, {
    status: 200,
    origin: "chrome-extension://abcdefghijklmnop",
  });

  // ## A non-extension origin gets no CORS grant
  //
  // A normal cross-origin site's preflight falls through to default handling — no
  // `Access-Control-Allow-Origin`, so the browser blocks it.

  // doctest:L70
  const evil = await app.inject({
    method: "OPTIONS",
    url: "/api/trpc/clerk.commentary",
    headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
  });
  t.check(evil.headers["access-control-allow-origin"], undefined);
});
