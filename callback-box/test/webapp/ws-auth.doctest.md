# Cookie-authed WS upgrade resolves identity from the raw `Cookie` header (Track D)

The tRPC WebSocket adapter (`useWSS` on the per-box plugin) hands
`createContext` a raw `http.IncomingMessage` — NOT a `@fastify/cookie`-decorated
`FastifyRequest`, so `request.cookies` is `undefined` on that path. Before
Track D, `resolveRequestIdentity` read only `request.cookies`, so a
cookie-authenticated subscription silently lost its identity at context creation;
harmless while standalone+auth was rare, a live bug once auth is the default-on
wall. The fix: when the cookie decoration is absent, the resolver falls back to
parsing the raw `Cookie` header via `getSessionUserFromCookieHeader`.

There is no existing socket-level harness that drives a real tRPC subscription
through `createContext` and asserts its resolved auth (the `rawUpgradeRequest`
helpers in `test/hub/` only assert the HTTP upgrade *status*, which the box
preHandler gates using the *decorated* request — so they don't exercise the raw
`IncomingMessage` path at all, and would pass with or without this fix). Rather
than invent a fragile one, this tests the exact resolver behavior the WS
`createContext` depends on: identity resolved from a request shaped like that raw
`IncomingMessage` — headers only, no `.cookies` — matches the decorated path.

```ts setup
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { signSession, resolveRequestIdentity, COOKIE_NAME } from "../../src/webapp/auth.js";
import { createFirstUser } from "../../src/webapp/local-users.js";
import { resetLocalUserCache } from "../../src/webapp/local-users-cache.js";

process.env.CB_AUTH_SCRYPT_N = "1024";
delete process.env.CB_HUB_SECRET; // standalone (non-hub)
delete process.env.CB_OWNER_EMAIL;
process.env.CB_SESSION_SECRET = "test-session-secret-for-ws-auth-doctest";

const authDir = await mkdtemp(path.join(os.tmpdir(), "cb-ws-auth-"));
process.env.CB_AUTH_FILE = path.join(authDir, "auth.json");

await createFirstUser({ email: "owner@example.com", name: "Owner", password: "pw-correct-1" });
resetLocalUserCache();
const cookie = signSession({ email: "owner@example.com", name: "Owner" });

// The decorated HTTP request the preHandler sees (`@fastify/cookie` populated `.cookies`).
const decoratedRequest = { headers: {}, cookies: { [COOKIE_NAME]: cookie } };
// The raw IncomingMessage the tRPC WS upgrade hands `createContext` — a Cookie
// header, and NO `.cookies` decoration.
const rawUpgradeRequest = { headers: { cookie: `${COOKIE_NAME}=${cookie}` } };
```

## The raw-header (WS) path resolves the same identity as the decorated (HTTP) path

```ts
JSON.stringify(resolveRequestIdentity(decoratedRequest, { openAccess: false }))
=> {"email":"owner@example.com","name":"Owner","source":"cookie"}

// Without the raw-header fallback this would be `source: null` — the authed WS
// dying at context creation. With it, the cookie-authed upgrade keeps its identity.
JSON.stringify(resolveRequestIdentity(rawUpgradeRequest, { openAccess: false }))
=> {"email":"owner@example.com","name":"Owner","source":"cookie"}
```

## A raw upgrade with no `Cookie` header is unauthenticated (auth required, fails closed)

```ts
JSON.stringify(resolveRequestIdentity({ headers: {} }, { openAccess: false }))
=> {"email":null,"name":null,"source":null}
```

## Hub mode still ignores the raw cookie — the fallback doesn't reopen the forgery hole

```ts
process.env.CB_HUB_SECRET = "hub-secret-xyz";
// A hub-mode box trusts ONLY secret-gated headers; a raw session cookie on a WS
// upgrade must NOT authenticate (the cookie secret is symmetric — a box that
// could verify one could forge one for a sibling).
JSON.stringify(resolveRequestIdentity(rawUpgradeRequest, { openAccess: false }))
=> {"email":null,"name":null,"source":null}

delete process.env.CB_HUB_SECRET;
```

```ts cleanup
await rm(authDir, { recursive: true, force: true });
delete process.env.CB_AUTH_FILE;
delete process.env.CB_AUTH_SCRYPT_N;
delete process.env.CB_SESSION_SECRET;
```
