# A box behind a hub trusts ONLY hub-injected, secret-gated identity headers (Track D, chunk D2)

`CB_HUB_SECRET` set in a box's env switches it into hub mode
(`src/webapp/auth.ts`'s `isHubMode`): the box's own auth preHandler
(`server-box-scope.ts`'s `addBoxAuthHook`) stops trusting its session
cookie entirely and instead trusts `x-cb-authenticated-email` IFF
`x-cb-hub-secret` matches. The per-box `allowedEmails` ACL still runs
against whatever email that resolves to — auth (identity) and
authorization (per-box ACL) stay two separate checks. The box's own
`/auth/*` also goes dead (404) in hub mode, since the hub owns login.

```ts setup
import { makeTestServer } from "../helpers/doctest-server.js";
import { signSession, COOKIE_NAME } from "../../src/webapp/auth.js";

process.env.CB_HUB_SECRET = "test-hub-secret-xyz";
process.env.CB_SESSION_SECRET = "test-session-secret-for-hub-mode-auth-doctest";

const server = await makeTestServer();
await server.seed("config/box.json", JSON.stringify({ allowedEmails: ["allowed@example.com"] }));
```

## No hub headers at all -> 401 (fails closed, not open)

```ts
const noHeaders = await server.request({ method: "GET", url: "/api/trpc/health.check" });
noHeaders.statusCode
=> 401
```

## A spoofed email header without the secret is ignored -> still 401

```ts continue
const spoofedNoSecret = await server.request({
  method: "GET",
  url: "/api/trpc/health.check",
  headers: { "x-cb-authenticated-email": "attacker@evil.com" },
});
spoofedNoSecret.statusCode
=> 401
```

## A spoofed email header with the WRONG secret is also ignored -> 401

```ts continue
const spoofedWrongSecret = await server.request({
  method: "GET",
  url: "/api/trpc/health.check",
  headers: { "x-cb-authenticated-email": "attacker@evil.com", "x-cb-hub-secret": "not-the-real-secret" },
});
spoofedWrongSecret.statusCode
=> 401
```

## A session cookie presented directly to a hub-mode box is ignored -- no cookie fallback

The whole point of D2: a box that could still fall back to verifying its
own cookie would let anyone who reaches it directly (bypassing the hub)
back in with a self-issued or stolen cookie signed by the SAME symmetric
secret every sibling box would also accept.

```ts continue
const cookieValue = signSession({ email: "allowed@example.com", name: "Allowed User" });
const cookiePresented = await server.request({
  method: "GET",
  url: "/api/trpc/health.check",
  headers: { cookie: `${COOKIE_NAME}=${cookieValue}` },
});
cookiePresented.statusCode
=> 401
```

## Valid secret + email NOT on the box's allowedEmails -> 403 (identity ok, authorization denied)

```ts continue
const validButNotAllowed = await server.request({
  method: "GET",
  url: "/api/trpc/health.check",
  headers: { "x-cb-authenticated-email": "stranger@example.com", "x-cb-hub-secret": "test-hub-secret-xyz" },
});
validButNotAllowed.statusCode
=> 403
```

## Valid secret + an allowedEmails email -> 200

```ts continue
const validAndAllowed = await server.request({
  method: "GET",
  url: "/api/trpc/health.check",
  headers: { "x-cb-authenticated-email": "allowed@example.com", "x-cb-hub-secret": "test-hub-secret-xyz" },
});
validAndAllowed.statusCode
=> 200
```

## Valid secret + `x-cb-hub-auth: off` (hub-wide auth disabled) bypasses the ACL entirely

```ts continue
const hubAuthOff = await server.request({
  method: "GET",
  url: "/api/trpc/health.check",
  headers: { "x-cb-hub-secret": "test-hub-secret-xyz", "x-cb-hub-auth": "off" },
});
hubAuthOff.statusCode
=> 200
```

## The box's own `/auth/login` is dead in hub mode -- 404, not a redirect loop

```ts continue
const ownAuthLogin = await server.rootRequest({ method: "GET", url: "/auth/login" });
ownAuthLogin.statusCode
=> 404
```

```ts cleanup
delete process.env.CB_HUB_SECRET;
delete process.env.CB_SESSION_SECRET;
await server.cleanup();
```

## A box with no `CB_HUB_SECRET` (standalone / non-hub) ignores the hub headers entirely

Same headers that would grant access above do nothing here — the test-server
helper sets the `CB_ALLOW_UNAUTHENTICATED` opt-out (standalone open mode), so
the auth hook isn't even installed and every request passes through regardless
of what `x-cb-*` headers it carries.

```ts
const openServer = await makeTestServer();
const openWithSpoofedHeaders = await openServer.request({
  method: "GET",
  url: "/api/trpc/health.check",
  headers: { "x-cb-authenticated-email": "attacker@evil.com", "x-cb-hub-secret": "irrelevant" },
});
openWithSpoofedHeaders.statusCode
=> 200
```

```ts cleanup
await openServer.cleanup();
```
