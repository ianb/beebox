# Login redirects carry a proxy-stripped path prefix (Track A of expose-dev-router)

A fronting proxy (the dev router in dev, the hub for its children) strips a
path prefix before the backend sees the request — the Vite dev-proxy removes
`/<worktree>` (`src/frontend/vite.config.ts`'s `stripBase`), so the backend
can't derive it from `request.url`. The proxy injects a trusted
`x-bbx-base-prefix` header instead, and `loginRedirect`
(`src/webapp/base-prefix.ts`) prepends that prefix to BOTH the login path and
the `returnTo`, so a browser behind the prefix reaches a working login page and
returns to where it was. The header is UNTRUSTED as a client value: it's
validated on read (fail-safe to "" = today's behavior) and stripped from client
requests by the hub.

```ts setup
import { validateBasePrefix, readBasePrefix } from "../../src/webapp/base-prefix.js";
import { makeTestServer } from "../helpers/doctest-server.js";
import http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { createHubServer } from "../../src/hub/hub-server.js";
import { staticEndpointProvider } from "../../src/hub/endpoints.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

// The box-scope redirect only fires OUTSIDE hub mode; keep this process
// non-hub for the standalone-box section below.
const ORIGINAL_HUB_SECRET = process.env.BBX_HUB_SECRET;
delete process.env.BBX_HUB_SECRET;
process.env.BBX_SESSION_SECRET = "test-session-secret-for-login-redirect-doctest";
```

## The prefix validator fails safe to "" for anything that isn't a single path segment

An absent, empty, multi-segment, traversal, or whitespace-bearing value all
collapse to "" (no prefix), so a bad header can only ever reproduce today's bare
redirect — never escape the origin or traverse. A clean single segment passes
through unchanged.

```ts
// Accepted: a single leading-slash segment.
validateBasePrefix("/main")
=> /main

validateBasePrefix("/my-worktree_2.0")
=> /my-worktree_2.0

// Rejected -> "" (fail-safe):
JSON.stringify([
  validateBasePrefix(undefined),   // absent
  validateBasePrefix(""),          // empty
  validateBasePrefix("main"),      // no leading slash
  validateBasePrefix("/a/b"),      // two segments
  validateBasePrefix("/../etc"),   // traversal
  validateBasePrefix("/.."),       // bare traversal (regex alone would pass)
  validateBasePrefix("/a b"),      // whitespace
  validateBasePrefix("//evil.com"),// protocol-relative escape attempt
])
=> ["","","","","","","",""]
```

`readBasePrefix` pulls the header (taking the first if duplicated) and validates.

```ts
readBasePrefix({ "x-bbx-base-prefix": "/main" })
=> /main

readBasePrefix({ "x-bbx-base-prefix": "/../etc" })
=>

readBasePrefix({})
=>
```

## A standalone box's login redirect carries the prefix from the header

With auth on and no cookie, a page navigation redirects to login. The box scope
(`server-box-scope.ts`'s `addBoxAuthHook`) does not strip `x-bbx-base-prefix` —
it trusts the dev router that fronts it — so the injected `/main` lands on BOTH
the login path and the `returnTo`. (`makeTestServer` mounts the box under
`/test`, so `request.url` is `/test/browse/some-card`.)

```ts
const box = await makeTestServer({ openAccess: false });

const prefixed = await box.rawRequest({
  method: "GET",
  url: "/browse/some-card",
  headers: { "x-bbx-base-prefix": "/main" },
});
print(`status: ${prefixed.statusCode}`);
print(`location: ${prefixed.headers.location}`);
"done"
=>
status: 302
location: /main/auth/login?returnTo=%2Fmain%2Ftest%2Fbrowse%2Fsome-card
done
```

With NO header the redirect stays exactly as it was before Track A: bare
`/auth/login` and an un-prefixed `returnTo`.

```ts continue
const bare = await box.rawRequest({ method: "GET", url: "/browse/some-card" });
bare.headers.location
=> /auth/login?returnTo=%2Ftest%2Fbrowse%2Fsome-card
```

A malicious prefix (traversal or whitespace) is rejected by the validator and
treated as empty — the redirect degrades to the bare form, never escaping the
origin.

```ts continue
const traversal = await box.rawRequest({
  method: "GET",
  url: "/browse/some-card",
  headers: { "x-bbx-base-prefix": "/../etc" },
});
traversal.headers.location
=> /auth/login?returnTo=%2Ftest%2Fbrowse%2Fsome-card

const whitespace = await box.rawRequest({
  method: "GET",
  url: "/browse/some-card",
  headers: { "x-bbx-base-prefix": "/a b" },
});
whitespace.headers.location
=> /auth/login?returnTo=%2Ftest%2Fbrowse%2Fsome-card
```

```ts cleanup
await box.cleanup();
```

## The hub's own login redirect ignores a client-supplied prefix (spoof wall)

The hub serves login at its own root and forwards `/<slug>/...` to the child
unchanged, so `request.url` already carries the slug and the correct prefix for
the hub's OWN redirect is empty. `stripHubHeaders` removes any client
`x-bbx-*` (including `x-bbx-base-prefix`) before the redirect, so a spoofed prefix
can't rewrite the login `Location`. The `/<slug>` the hub injects goes onto the
outgoing child request, not its own redirect.

```ts
const childBox = await makeTmpBox();
const child = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end("{}");
});
await new Promise((resolve) => child.listen(0, "127.0.0.1", resolve));
const childSockets = [];
child.on("connection", (s) => childSockets.push(s));
const endpoints = staticEndpointProvider([{ slug: "test1", origin: `http://127.0.0.1:${child.address().port}` }]);
const hub = await createHubServer({
  endpoints,
  getHealth: () => ({ status: "ok", boxes: [] }),
  hubSecret: "test-hub-secret-for-login-redirect-doctest",
  boxes: [{ slug: "test1", boxRoot: childBox.root }],
});
const hubSockets = [];
hub.on("connection", (s) => hubSockets.push(s));
await new Promise((resolve) => hub.listen(0, "127.0.0.1", resolve));
const hubBase = `http://127.0.0.1:${hub.address().port}`;

// Unauthenticated navigation: bare redirect, returnTo already carries /test1.
const nav = await fetch(`${hubBase}/test1/browse/some-card`, { redirect: "manual" });
print(`status: ${nav.status}`);
print(`location: ${nav.headers.get("location")}`);

// A spoofed x-bbx-base-prefix is stripped -> identical redirect, not /evil/....
const spoofed = await fetch(`${hubBase}/test1/browse/some-card`, {
  redirect: "manual",
  headers: { "x-bbx-base-prefix": "/evil" },
});
print(`spoofed: ${spoofed.headers.get("location")}`);
"done"
=>
status: 302
location: /auth/login?returnTo=%2Ftest1%2Fbrowse%2Fsome-card
spoofed: /auth/login?returnTo=%2Ftest1%2Fbrowse%2Fsome-card
done
```

```ts cleanup
for (const s of hubSockets) s.destroy();
for (const s of childSockets) s.destroy();
await new Promise((resolve) => hub.close(resolve));
await new Promise((resolve) => child.close(resolve));
await childBox.cleanup();
if (ORIGINAL_HUB_SECRET === undefined) delete process.env.BBX_HUB_SECRET;
else process.env.BBX_HUB_SECRET = ORIGINAL_HUB_SECRET;
```
