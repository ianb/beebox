# Hub-mode identity resolution (Track D, chunk D2)

`resolveRequestIdentity` (`src/webapp/auth.ts`) is the ONE place both the
box auth preHandler and the tRPC context creation ask "who is this
request." In hub mode (`CB_HUB_SECRET` set) it trusts ONLY the
secret-gated hub headers — never the session cookie, even when one is
present — because the cookie's signing secret is symmetric: a box that can
verify a session could also forge one for a sibling box. These are pure
unit tests against fake `FastifyRequest`-shaped objects — no server boot
needed to exercise the header logic itself.

```ts setup
import { resolveRequestIdentity, verifyHubSecret, isHubMode, signSession, COOKIE_NAME } from "../../src/webapp/auth.js";

/** Minimal fake FastifyRequest: just enough of the shape resolveRequestIdentity/verifyHubSecret read. */
function fakeRequest({ headers, cookies }) {
  return { headers: headers ?? {}, cookies: cookies ?? {} };
}

const ORIGINAL_HUB_SECRET = process.env.CB_HUB_SECRET;
const ORIGINAL_SESSION_SECRET = process.env.CB_SESSION_SECRET;
const ORIGINAL_AUTH_FILE = process.env.CB_AUTH_FILE;
process.env.CB_SESSION_SECRET = "test-session-secret-for-hub-identity-doctest";
// Track D: signSession + the resolver now consult the local credential store, so
// pin CB_AUTH_FILE at a nonexistent tmp path — none of these example emails have
// a record, keeping them gen-less (source "cookie"), independent of any real
// ~/.cb-auth.json on the host.
process.env.CB_AUTH_FILE = "/nonexistent/cb-auth-hub-identity-doctest.json";
```

## Outside hub mode, headers are ignored entirely — the cookie is the only source

```ts
delete process.env.CB_HUB_SECRET;
isHubMode()
=> false

const spoofed = fakeRequest({
  headers: { "x-cb-authenticated-email": "attacker@evil.com", "x-cb-hub-secret": "whatever" },
});
JSON.stringify(resolveRequestIdentity(spoofed, { openAccess: false }))
=> {"email":null,"name":null,"source":null}
```

```ts continue
const cookieValue = signSession({ email: "real@example.com", name: "Real User" });
const withCookie = fakeRequest({ cookies: { [COOKIE_NAME]: cookieValue } });
JSON.stringify(resolveRequestIdentity(withCookie, { openAccess: false }))
=> {"email":"real@example.com","name":"Real User","source":"cookie"}
```

## In hub mode, a request without the secret header is unauthenticated — no cookie fallback

```ts continue
process.env.CB_HUB_SECRET = "hub-secret-abc123";
isHubMode()
=> true

// Even carrying a perfectly valid session cookie AND a spoofed email header,
// with no (or a wrong) secret, the request is treated as unauthenticated.
// This is the core forgery-hole check: a hub-mode box must never fall back
// to verifying the cookie itself.
const cookieOnlyInHubMode = fakeRequest({ cookies: { [COOKIE_NAME]: cookieValue } });
JSON.stringify(resolveRequestIdentity(cookieOnlyInHubMode, { openAccess: false }))
=> {"email":null,"name":null,"source":null}

const wrongSecret = fakeRequest({
  headers: { "x-cb-hub-secret": "not-the-secret", "x-cb-authenticated-email": "someone@example.com" },
  cookies: { [COOKIE_NAME]: cookieValue },
});
verifyHubSecret(wrongSecret)
=> false

JSON.stringify(resolveRequestIdentity(wrongSecret, { openAccess: false }))
=> {"email":null,"name":null,"source":null}
```

## A valid secret + email header is honored as hub-sourced identity

```ts continue
const validHubRequest = fakeRequest({
  headers: { "x-cb-hub-secret": "hub-secret-abc123", "x-cb-authenticated-email": "person@example.com" },
});
verifyHubSecret(validHubRequest)
=> true

JSON.stringify(resolveRequestIdentity(validHubRequest, { openAccess: false }))
=> {"email":"person@example.com","name":"person@example.com","source":"hub"}

const mixedCaseHubRequest = fakeRequest({
  headers: { "x-cb-hub-secret": "hub-secret-abc123", "x-cb-authenticated-email": " Person@Example.COM " },
});
JSON.stringify(resolveRequestIdentity(mixedCaseHubRequest, { openAccess: false }))
=> {"email":"person@example.com","name":"person@example.com","source":"hub"}
```

## A valid secret + no email header is unauthenticated UNLESS `x-cb-hub-auth: off` is also set

```ts continue
const secretOnly = fakeRequest({ headers: { "x-cb-hub-secret": "hub-secret-abc123" } });
JSON.stringify(resolveRequestIdentity(secretOnly, { openAccess: false }))
=> {"email":null,"name":null,"source":null}

const secretPlusOff = fakeRequest({
  headers: { "x-cb-hub-secret": "hub-secret-abc123", "x-cb-hub-auth": "off" },
});
JSON.stringify(resolveRequestIdentity(secretPlusOff, { openAccess: false }))
=> {"email":null,"name":null,"source":"open"}
```

## No `CB_HUB_SECRET` configured server-side means the secret header can never verify

```ts continue
delete process.env.CB_HUB_SECRET;
const noServerSecret = fakeRequest({
  headers: { "x-cb-hub-secret": "anything", "x-cb-authenticated-email": "someone@example.com" },
});
verifyHubSecret(noServerSecret)
=> false
```

## Standalone open access: a cookieless request resolves to `source: "open"`

Outside hub mode, when the box was constructed with `openAccess: true` and the
request carries no session cookie, the resolver returns `source: "open"` — the
single place standalone openness is decided, so the openness-recomputing call
sites can just read `identity.source`. With auth required (`openAccess: false`),
the same cookieless request is `source: null` (unauthenticated).

```ts continue
delete process.env.CB_HUB_SECRET;
const openStandalone = fakeRequest({});
JSON.stringify(resolveRequestIdentity(openStandalone, { openAccess: true }))
=> {"email":null,"name":null,"source":"open"}

JSON.stringify(resolveRequestIdentity(openStandalone, { openAccess: false }))
=> {"email":null,"name":null,"source":null}
```

```ts cleanup
if (ORIGINAL_HUB_SECRET === undefined) delete process.env.CB_HUB_SECRET;
else process.env.CB_HUB_SECRET = ORIGINAL_HUB_SECRET;
if (ORIGINAL_SESSION_SECRET === undefined) delete process.env.CB_SESSION_SECRET;
else process.env.CB_SESSION_SECRET = ORIGINAL_SESSION_SECRET;
if (ORIGINAL_AUTH_FILE === undefined) delete process.env.CB_AUTH_FILE;
else process.env.CB_AUTH_FILE = ORIGINAL_AUTH_FILE;
```
