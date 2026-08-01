# The hub proxies a scan token to `/api/scan/…` and nowhere else

Scan-upload tokens are enforced at two independent boundaries. The hub is the
outer one, and it adds a restriction the box child cannot: the PATH. A scan
bearer aimed at `/<slug>/api/scan/…` verifies against that box's own store file
and proxies; the same bearer on any other path never reaches the child, never
cold-starts a box, and never earns hub-injected identity headers — it is a bare
401 (or a login redirect, for a page navigation) at the hub.

```ts setup
import http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { createHubServer } from "../../src/hub/hub-server.js";
import { staticEndpointProvider } from "../../src/hub/endpoints.js";
import { createScanToken, revokeScanToken } from "../../src/core/scan/tokens.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const HUB_SECRET = "test-hub-secret-for-scan-token-doctest";

process.env.CB_SESSION_SECRET = "test-session-secret-for-scan-token-doctest";
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id-for-scan-token-doctest";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret-for-scan-token-doctest";

const authDir = await mkdtemp(path.join(os.tmpdir(), "cb-hub-scan-auth-"));
process.env.CB_AUTH_FILE = path.join(authDir, "auth.json");
process.env.CB_AUTH_SCRYPT_N = "1024";

/** Echoes back what the child would see, so the test can assert that no
 *  hub-injected identity rides along with a scan-token request. */
async function startFakeBox() {
  const sockets = [];
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      url: req.url,
      authorization: req.headers["authorization"] ?? null,
      xCbAuthenticatedEmail: req.headers["x-cb-authenticated-email"] ?? null,
      xCbHubSecret: req.headers["x-cb-hub-secret"] ?? null,
    }));
  });
  server.on("connection", (socket) => sockets.push(socket));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, sockets, origin: `http://127.0.0.1:${server.address().port}` };
}

const box = await startFakeBox();
const scanBox = await makeTmpBox();
const scan = await createScanToken(scanBox.root, { name: "laptop-scansnap", createdBy: null });
const hubServer = await createHubServer({
  endpoints: staticEndpointProvider([{ slug: "test1", origin: box.origin }]),
  getHealth: () => ({ status: "ok", boxes: [] }),
  hubSecret: HUB_SECRET,
  boxes: [{ slug: "test1", boxRoot: scanBox.root }],
});
const hubSockets = [];
hubServer.on("connection", (socket) => hubSockets.push(socket));
await new Promise((resolve) => hubServer.listen(0, "127.0.0.1", resolve));
const hubBase = `http://127.0.0.1:${hubServer.address().port}`;
const scanAuth = { authorization: `Bearer ${scan.token}` };
```

## A verified scan bearer proxies on a scan path, carrying no identity

The bearer is forwarded untouched (the child verifies it again against the same
store), and the hub attaches neither an authenticated email nor its secret —
this credential is not a person and must not be able to impersonate one.

```ts
const accepted = await fetch(`${hubBase}/test1/api/scan/check`, { method: "POST", headers: scanAuth });
const body = await accepted.json();
JSON.stringify({
  status: accepted.status,
  url: body.url,
  forwarded: body.authorization === `Bearer ${scan.token}`,
  email: body.xCbAuthenticatedEmail,
  secret: body.xCbHubSecret,
})
=> {"status":200,"url":"/test1/api/scan/check","forwarded":true,"email":null,"secret":null}
```

The PUT path is covered too — with the hash in its contract form (64 lowercase
hex).

```ts continue
const hash = "a".repeat(64);
const put = await fetch(`${hubBase}/test1/api/scan/files/${hash}`, { method: "PUT", headers: scanAuth, body: "x" });
put.status
=> 200
```

Only those two shapes. The gate is not the `/api/scan/` subtree: a third route
under it, a subpath below a legal one, a trailing slash, and a malformed hash
are all just other protected surfaces, 401'd without waking the box.

```ts continue
const nonScan = ["/test1/api/scan/other", "/test1/api/scan", "/test1/api/scan/", "/test1/api/scan/check/", "/test1/api/scan/check/extra", `/test1/api/scan/files/${hash}/extra`, "/test1/api/scan/files/NOTAHASH", `/test1/api/scan/files/${"A".repeat(64)}`];
const others = await Promise.all(nonScan.map((p) => fetch(`${hubBase}${p}`, { method: "POST", headers: scanAuth })));
others.map((res) => res.status).join(" ")
=> 401 401 401 401 401 401 401 401
```

## The same token on any other path is 401'd at the hub

An API path gets a bare 401; a page navigation gets the ordinary login redirect.
Either way the request stops here — a scan token can never reach chat, tRPC, or
a WebSocket upgrade.

```ts continue
const trpc = await fetch(`${hubBase}/test1/api/trpc/health.check`, { headers: scanAuth });
trpc.status
=> 401

const events = await fetch(`${hubBase}/test1/events`, { headers: scanAuth });
events.status
=> 401

const nav = await fetch(`${hubBase}/test1/browse/some-card`, { headers: scanAuth, redirect: "manual" });
nav.status
=> 302
```

A near-miss path does not count as a scan path — the prefix must be a real path
segment boundary, so `/api/scanner` is just another protected surface.

```ts continue
const nearMiss = await fetch(`${hubBase}/test1/api/scanner/check`, { method: "POST", headers: scanAuth });
nearMiss.status
=> 401
```

## The hub verifies against the box's store, so bogus and revoked tokens stop here

A syntactically valid bearer that verifies against nothing is rejected before
the endpoint is resolved — the same no-enumeration, no-box-wake property the
mobile gate has.

```ts continue
const bogus = await fetch(`${hubBase}/test1/api/scan/check`, {
  method: "POST",
  headers: { authorization: "Bearer not-a-real-scan-token" },
});
bogus.status
=> 401

// A scan token minted for THIS box is worthless against a slug it doesn't own.
const wrongSlug = await fetch(`${hubBase}/nosuchbox/api/scan/check`, { method: "POST", headers: scanAuth });
wrongSlug.status
=> 401
```

Revocation takes effect at the hub immediately, because the hub reads the same
on-disk store the box child does.

```ts continue
await revokeScanToken(scanBox.root, "laptop-scansnap")
=> true

const afterRevoke = await fetch(`${hubBase}/test1/api/scan/check`, { method: "POST", headers: scanAuth });
afterRevoke.status
=> 401
```

```ts cleanup
delete process.env.GOOGLE_OAUTH_CLIENT_ID;
delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
delete process.env.CB_SESSION_SECRET;
delete process.env.CB_AUTH_FILE;
delete process.env.CB_AUTH_SCRYPT_N;
await rm(authDir, { recursive: true, force: true });
await scanBox.cleanup();
for (const socket of hubSockets) socket.destroy();
for (const socket of box.sockets) socket.destroy();
await new Promise((resolve) => hubServer.close(resolve));
await new Promise((resolve) => box.server.close(resolve));
```
