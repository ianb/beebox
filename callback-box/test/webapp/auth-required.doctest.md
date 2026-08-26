# Always-on auth gate: the `openAccess` instance flag and the wall's edges

Authentication is the structurally always-on default. There is no operator
opt-out anymore: the only unauthenticated servers that can exist are
test-constructed ones, via the `openAccess` construction option (decorated onto
the fastify instance and consulted by `resolveRequestIdentity` — `src/webapp/auth.ts`).
No CLI path sets it. This doctest covers the gate's semantics (a server without
`openAccess` requires auth; `openAccess: true` resolves to `source: "open"`), the
diagnostic-bypass batch-URL fix, and the two root-route edges (`/auth/me` open
shape, `/api/push/resubscribe` behind the wall).

```ts setup
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRequestIdentity, isDiagnosticBypassRequest } from "../../src/webapp/auth.js";
import { assertOpenAccessNotListening, startServer } from "../../src/webapp/server.js";
import { makeTestServer } from "../helpers/doctest-server.js";

const ORIGINAL_DIAG_KEY = process.env.CB_DIAG_API_KEY;
const ORIGINAL_HUB_SECRET = process.env.CB_HUB_SECRET;
// The resolver's cookie path (not hub mode) is what these gate cases exercise.
delete process.env.CB_HUB_SECRET;

/** Minimal fake FastifyRequest for the diagnostic-bypass check. */
function fakeRequest({ method, url, headers }) {
  return { method: method ?? "GET", url, headers: headers ?? {} };
}
```

## A server without `openAccess` requires auth; `openAccess: true` resolves to `source: "open"`

Outside hub mode, a cookieless request is unauthenticated (`source: null`) when
the server was constructed auth-on, and `source: "open"` when it was constructed
with `openAccess: true` — the single place standalone openness is decided, which
the openness-recomputing call sites read as `identity.source` rather than
re-derive.

```ts
const cookieless = { headers: {}, cookies: {} };

JSON.stringify(resolveRequestIdentity(cookieless, { openAccess: false }))
=> {"email":null,"name":null,"source":null}

JSON.stringify(resolveRequestIdentity(cookieless, { openAccess: true }))
=> {"email":null,"name":null,"source":"open"}
```

## Diagnostic bypass: EVERY batched tRPC procedure must be whitelisted

A single whitelisted procedure passes; a tRPC **batch** URL that also carries a
non-whitelisted procedure (e.g. `history.list`) does NOT — the fix for the old
substring match that let a diag-key holder read past the two allowed endpoints.

```ts
process.env.CB_DIAG_API_KEY = "diag-key-for-auth-required-doctest";
const bearer = { authorization: "Bearer diag-key-for-auth-required-doctest" };

isDiagnosticBypassRequest(fakeRequest({ url: "/test/api/trpc/health.check", headers: bearer }))
=> true

isDiagnosticBypassRequest(fakeRequest({ url: "/test/api/trpc/debugLog.get?batch=1", headers: bearer }))
=> true

// The batch-URL privilege-widening, now closed:
isDiagnosticBypassRequest(fakeRequest({ url: "/test/api/trpc/health.check,history.list?batch=1", headers: bearer }))
=> false

// A whitelisted procedure but the wrong (or missing) key never bypasses:
isDiagnosticBypassRequest(fakeRequest({ url: "/test/api/trpc/health.check", headers: { authorization: "Bearer wrong" } }))
=> false

// A POST is never a bypass, even for a whitelisted read procedure:
isDiagnosticBypassRequest(fakeRequest({ method: "POST", url: "/test/api/trpc/health.check", headers: bearer }))
=> false
```

## An `openAccess` server is non-listenable

Open access bypasses the auth wall, so it must never bind a listening socket —
it exists only as a `.inject()`-based test seam. `startServer` fails closed
before any side effect when handed `openAccess: true` (which no typed caller can
pass — it's absent from the public `ServerOptions` — but a runtime caller could
smuggle in). A normal listen path (no `openAccess`) passes the guard. Injected
open-access servers are unaffected: `.inject()` never goes through listen (the
`{ open: true }` server above answered fine).

```ts
assertOpenAccessNotListening({ openAccess: true })
=> throws OpenAccessListenError

// The guard is a no-op for the production shape (no openAccess) and for an
// explicit false; nothing throws so these return undefined.
assertOpenAccessNotListening({})
=> undefined

assertOpenAccessNotListening({ openAccess: false })
=> undefined
```

The public entry point fails closed too, before touching disk or the network.
`startServer` is async, so read the rejection's error name.

```ts
const listenName = await startServer({ openAccess: true }).then(() => "did not throw", (e) => e.name);
listenName
=> OpenAccessListenError
```

## `/auth/me` advertises open access; `/api/push/resubscribe` sits behind the wall

An `openAccess: true` server advertises `{ open: true }` on `/auth/me` (the
open-mode signal read by `/healthz` and `/api/build-info`) and passes
`/api/push/resubscribe` through the wall (then 400s on the empty body — proof it
reached the handler rather than being blanket-blocked).

```ts
delete process.env.CB_DIAG_API_KEY;
const openServer = await makeTestServer({ openAccess: true });

const meOpen = await openServer.rootRequest({ method: "GET", url: "/auth/me" });
JSON.stringify(meOpen)
=> {"statusCode":200,"body":{"open":true}}

const resubOpen = await openServer.rootRequest({ method: "POST", url: "/api/push/resubscribe", payload: {} });
resubOpen.statusCode
=> 400

await openServer.cleanup();
```

An auth-on server (`openAccess: false`, the production default) 401s both.

```ts
const authServer = await makeTestServer({ openAccess: false });

const meRequired = await authServer.rootRequest({ method: "GET", url: "/auth/me" });
meRequired.statusCode
=> 401

const resubRequired = await authServer.rootRequest({ method: "POST", url: "/api/push/resubscribe", payload: {} });
resubRequired.statusCode
=> 401

await authServer.cleanup();
```

## The browse key in the tRPC context: an owner on an opted-in box, `authed` elsewhere

`createContext` (`server-box-scope.ts`) resolves identity through
`resolveBoxIdentity`, so on a box that declares `agentBrowsing: "owner"` the
machine-wide browse key arrives as a `user` and clears `ownerProcedure`. The one
owner surface it must NOT clear is the machine-level secret store: its grants are
shared across every box on the machine, so one test box's opt-in cannot unlock
them (`docs/plans/secret-custody.md`) — `authenticatedOwnerProcedure` excludes
`source: "browse"`.

```ts
const BROWSE_KEY = "browse-key-for-auth-required-doctest";
const ORIGINAL_OWNER = process.env.CB_OWNER_EMAIL;
process.env.CB_BROWSE_API_KEY = BROWSE_KEY;
process.env.CB_OWNER_EMAIL = "owner@example.com";
// Keep the owner's display-name lookup off the machine's real ~/.cb-auth.json.
const authDir = await mkdtemp(join(tmpdir(), "cb-auth-required-browse-"));
process.env.CB_AUTH_FILE = join(authDir, "no-such-auth.json");
const browseHeaders = { authorization: `Bearer ${BROWSE_KEY}` };

const optedIn = await makeTestServer({ openAccess: false });
await optedIn.seed("config/box.json", JSON.stringify({ agentBrowsing: "owner" }));

const asOwner = await optedIn.request({ method: "GET", url: "/api/trpc/pairing.devices", headers: browseHeaders });
const atSecrets = await optedIn.request({ method: "GET", url: "/api/trpc/secrets.formatHints", headers: browseHeaders });

print(`ownerProcedure: ${asOwner.statusCode}`);
print(`authenticatedOwnerProcedure: ${atSecrets.statusCode} ${atSecrets.body.error.data.code}`);
=>
ownerProcedure: 200
authenticatedOwnerProcedure: 403 FORBIDDEN
```

On a box that never opted in, the key means what it always did: it clears the
wall and reaches an authenticated procedure, and nothing owner-gated.

```ts continue
const plain = await makeTestServer({ openAccess: false });

const authedCall = await plain.request({ method: "GET", url: "/api/trpc/inventory.summary", headers: browseHeaders });
const ownerCall = await plain.request({ method: "GET", url: "/api/trpc/pairing.devices", headers: browseHeaders });

print(`authedProcedure: ${authedCall.statusCode}`);
print(`ownerProcedure: ${ownerCall.statusCode} ${ownerCall.body.error.data.code}`);
=>
authedProcedure: 200
ownerProcedure: 403 FORBIDDEN
```

```ts cleanup
await optedIn.cleanup();
await plain.cleanup();
await rm(authDir, { recursive: true, force: true });
delete process.env.CB_BROWSE_API_KEY;
delete process.env.CB_AUTH_FILE;
if (ORIGINAL_OWNER === undefined) delete process.env.CB_OWNER_EMAIL;
else process.env.CB_OWNER_EMAIL = ORIGINAL_OWNER;
```

```ts cleanup
if (ORIGINAL_DIAG_KEY === undefined) delete process.env.CB_DIAG_API_KEY;
else process.env.CB_DIAG_API_KEY = ORIGINAL_DIAG_KEY;
if (ORIGINAL_HUB_SECRET === undefined) delete process.env.CB_HUB_SECRET;
else process.env.CB_HUB_SECRET = ORIGINAL_HUB_SECRET;
```
