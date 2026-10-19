// # Login redirects carry a proxy-stripped path prefix (Track A of expose-dev-router)
//
// A fronting proxy (the dev router in dev, the hub for its children) strips a
// path prefix before the backend sees the request — the Vite dev-proxy removes
// `/<worktree>` (`src/frontend/vite.config.ts`'s `stripBase`), so the backend
// can't derive it from `request.url`. The proxy injects a trusted
// `x-bbx-base-prefix` header instead, and `loginRedirect`
// (`src/webapp/base-prefix.ts`) prepends that prefix to BOTH the login path and
// the `returnTo`, so a browser behind the prefix reaches a working login page and
// returns to where it was. The header is UNTRUSTED as a client value: it's
// validated on read (fail-safe to "" = today's behavior) and stripped from client
// requests by the hub.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { validateBasePrefix, readBasePrefix } from "../../src/webapp/base-prefix.js";
import { makeTestServer } from "../helpers/test-route-server.js";
import http from "node:http";
import type { Socket } from "node:net";
import { createHubServer } from "../../src/hub/server/core.js";
import { staticEndpointProvider } from "../../src/hub/endpoints.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

// The box-scope redirect only fires OUTSIDE hub mode; keep this process
// non-hub for the standalone-box section below.
const ORIGINAL_HUB_SECRET = process.env.BBX_HUB_SECRET;

// The TCP port a listening server bound.
function portOf(server: http.Server): number {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server is not listening on a TCP port");
  return address.port;
}
delete process.env.BBX_HUB_SECRET;
process.env.BBX_SESSION_SECRET = "test-session-secret-for-login-redirect-test";

// ## The prefix validator fails safe to "" for anything that isn't a single path segment
//
// An absent, empty, multi-segment, traversal, or whitespace-bearing value all
// collapse to "" (no prefix), so a bad header can only ever reproduce today's bare
// redirect — never escape the origin or traverse. A clean single segment passes
// through unchanged.
void test("An absent, empty, multi-segment, traversal, or whitespace-bearing value all c...", async (t) => {
  t.check(
    // Accepted: a single leading-slash segment.
    validateBasePrefix("/main"),
    "/main",
  );

  t.check(validateBasePrefix("/my-worktree_2.0"), "/my-worktree_2.0");

  t.check(
    // Rejected -> "" (fail-safe):
    [
      validateBasePrefix(undefined),   // absent
      validateBasePrefix(""),          // empty
      validateBasePrefix("main"),      // no leading slash
      validateBasePrefix("/a/b"),      // two segments
      validateBasePrefix("/../etc"),   // traversal
      validateBasePrefix("/.."),       // bare traversal (regex alone would pass)
      validateBasePrefix("/a b"),      // whitespace
      validateBasePrefix("//evil.com"),// protocol-relative escape attempt
    ],
    ["", "", "", "", "", "", "", ""],
  );
});

// `readBasePrefix` pulls the header (taking the first if duplicated) and validates.
void test("readBasePrefix pulls the header (taking the first if duplicated) and validates.", async (t) => {
  t.check(readBasePrefix({ "x-bbx-base-prefix": "/main" }), "/main");

  t.check(readBasePrefix({ "x-bbx-base-prefix": "/../etc" }), "");

  t.check(readBasePrefix({}), "");
});

// ## A standalone box's login redirect carries the prefix from the header
//
// With auth on and no cookie, a page navigation redirects to login. The box scope
// (`server-box-scope.ts`'s `addBoxAuthHook`) does not strip `x-bbx-base-prefix` —
// it trusts the dev router that fronts it — so the injected `/main` lands on BOTH
// the login path and the `returnTo`. (`makeTestServer` mounts the box under
// `/test`, so `request.url` is `/test/browse/some-card`.)
void test("With auth on and no cookie, a page navigation redirects to login.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTestServer({ openAccess: false });

  const prefixed = await box.rawRequest({
    method: "GET",
    url: "/browse/some-card",
    headers: { "x-bbx-base-prefix": "/main" },
  });
  t.check(
    { status: prefixed.statusCode, location: prefixed.headers.location },
    { status: 302, location: "/main/auth/login?returnTo=%2Fmain%2Ftest%2Fbrowse%2Fsome-card" },
  );

  // With NO header the redirect stays exactly as it was before Track A: bare
  // `/auth/login` and an un-prefixed `returnTo`.

  const bare = await box.rawRequest({ method: "GET", url: "/browse/some-card" });
  t.check(bare.headers.location, "/auth/login?returnTo=%2Ftest%2Fbrowse%2Fsome-card");

  // A malicious prefix (traversal or whitespace) is rejected by the validator and
  // treated as empty — the redirect degrades to the bare form, never escaping the
  // origin.

  const traversal = await box.rawRequest({
    method: "GET",
    url: "/browse/some-card",
    headers: { "x-bbx-base-prefix": "/../etc" },
  });
  t.check(traversal.headers.location, "/auth/login?returnTo=%2Ftest%2Fbrowse%2Fsome-card");

  const whitespace = await box.rawRequest({
    method: "GET",
    url: "/browse/some-card",
    headers: { "x-bbx-base-prefix": "/a b" },
  });
  t.check(whitespace.headers.location, "/auth/login?returnTo=%2Ftest%2Fbrowse%2Fsome-card");
});

// ## The hub's own login redirect ignores a client-supplied prefix (spoof wall)
//
// The hub serves login at its own root and forwards `/<slug>/...` to the child
// unchanged, so `request.url` already carries the slug and the correct prefix for
// the hub's OWN redirect is empty. `stripHubHeaders` removes any client
// `x-bbx-*` (including `x-bbx-base-prefix`) before the redirect, so a spoofed prefix
// can't rewrite the login `Location`. The `/<slug>` the hub injects goes onto the
// outgoing child request, not its own redirect.
void test("The hub serves login at its own root and forwards /<slug>/... to the child un...", async (t) => {
  t.teardown(async () => {
    try {
      for (const s of hubSockets) s.destroy();
      for (const s of childSockets) s.destroy();
      await new Promise((resolve) => hub.close(resolve));
      await new Promise((resolve) => child.close(resolve));
      await childBox.cleanup();
      if (ORIGINAL_HUB_SECRET === undefined) delete process.env.BBX_HUB_SECRET;
      else process.env.BBX_HUB_SECRET = ORIGINAL_HUB_SECRET;
    } catch (error) {
      t.error(error);
    }
  });
  const childBox = await makeTmpBox();
  const child = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise<void>((resolve) => child.listen(0, "127.0.0.1", () => resolve()));
  const childSockets: Socket[] = [];
  child.on("connection", (s) => childSockets.push(s));
  const endpoints = staticEndpointProvider([{ slug: "test1", origin: `http://127.0.0.1:${portOf(child)}` }]);
  const hub = await createHubServer({
    endpoints,
    getHealth: () => ({ status: "ok", boxes: [] }),
    hubSecret: "test-hub-secret-for-login-redirect-test",
    baseUrl: "http://127.0.0.1",
    boxes: [{ slug: "test1", boxRoot: childBox.root }],
  });
  const hubSockets: Socket[] = [];
  hub.on("connection", (s) => hubSockets.push(s));
  await new Promise<void>((resolve) => hub.listen(0, "127.0.0.1", () => resolve()));
  const hubBase = `http://127.0.0.1:${portOf(hub)}`;

  // Unauthenticated navigation: bare redirect, returnTo already carries /test1.
  const nav = await fetch(`${hubBase}/test1/browse/some-card`, { redirect: "manual" });

  // A spoofed x-bbx-base-prefix is stripped -> identical redirect, not /evil/....
  const spoofed = await fetch(`${hubBase}/test1/browse/some-card`, {
    redirect: "manual",
    headers: { "x-bbx-base-prefix": "/evil" },
  });
  t.check(
    {
      status: nav.status,
      location: nav.headers.get("location"),
      spoofedStatus: spoofed.status,
      spoofedLocation: spoofed.headers.get("location"),
    },
    {
      status: 302,
      location: "/auth/login?returnTo=%2Ftest1%2Fbrowse%2Fsome-card",
      spoofedStatus: 302,
      spoofedLocation: "/auth/login?returnTo=%2Ftest1%2Fbrowse%2Fsome-card",
    },
  );
});
