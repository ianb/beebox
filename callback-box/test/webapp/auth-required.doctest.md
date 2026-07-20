# Always-on auth gate: `authRequired()` / `openMode()` and the wall's edges

Authentication is the always-on default. `authRequired()` (`src/webapp/auth.ts`)
returns `true` unless a deliberate `CB_ALLOW_UNAUTHENTICATED` opt-out is set —
Google configuration no longer gates the wall. `openMode()` classifies the
opt-out into `"off"` / `"loopback"` / `"network"`, rejecting any other value at
startup. This doctest covers the gate's semantics, the tiered bind check, the
diagnostic-bypass batch-URL fix, and the two root-route edges (`/auth/me` open
shape, `/api/push/resubscribe` behind the wall).

```ts setup
import {
  openMode,
  authRequired,
  enforceOpenModeAtListen,
  isDiagnosticBypassRequest,
} from "../../src/webapp/auth.js";
import { makeTestServer } from "../helpers/doctest-server.js";

const ORIGINAL_OPT_OUT = process.env.CB_ALLOW_UNAUTHENTICATED;
const ORIGINAL_DIAG_KEY = process.env.CB_DIAG_API_KEY;

/** Minimal fake FastifyRequest for the diagnostic-bypass check. */
function fakeRequest({ method, url, headers }) {
  return { method: method ?? "GET", url, headers: headers ?? {} };
}

/**
 * Exercise the non-throwing bind combinations of `enforceOpenModeAtListen`
 * (loopback `=1`, `network` on any bind, unset) with the open-mode boot warning
 * suppressed. Returns `"ok"` if none threw, else the thrown error's name. Lives
 * in setup because a multi-line try/finally doesn't belong in a `=>` example.
 */
function assertOpenModeListenOk() {
  const origWarn = console.warn;
  console.warn = function suppressed() { /* silence the open-mode boot warning */ };
  try {
    process.env.CB_ALLOW_UNAUTHENTICATED = "1";
    enforceOpenModeAtListen({ host: "127.0.0.1", port: 3210 });
    process.env.CB_ALLOW_UNAUTHENTICATED = "network";
    enforceOpenModeAtListen({ host: "0.0.0.0", port: 3210 });
    delete process.env.CB_ALLOW_UNAUTHENTICATED;
    enforceOpenModeAtListen({ host: "0.0.0.0", port: 3210 });
    return "ok";
  } catch (e) {
    return e.name;
  } finally {
    console.warn = origWarn;
  }
}
```

## `openMode()` / `authRequired()` classify the opt-out

```ts
delete process.env.CB_ALLOW_UNAUTHENTICATED;
JSON.stringify({ mode: openMode(), required: authRequired() })
=> {"mode":"off","required":true}

process.env.CB_ALLOW_UNAUTHENTICATED = "1";
JSON.stringify({ mode: openMode(), required: authRequired() })
=> {"mode":"loopback","required":false}

process.env.CB_ALLOW_UNAUTHENTICATED = "network";
JSON.stringify({ mode: openMode(), required: authRequired() })
=> {"mode":"network","required":false}
```

## An unrecognized opt-out value is rejected (fail closed, never coerced)

```ts continue
process.env.CB_ALLOW_UNAUTHENTICATED = "yes";
openMode()
=> throws InvalidOpenModeError

authRequired()
=> throws InvalidOpenModeError
```

## The bind tier: `=1` is loopback-only, `network` opens any bind

`enforceOpenModeAtListen` (called at listen time) throws `OpenModeBindError`
when the loopback-only opt-out (`=1`) is paired with a non-loopback bind — the
catastrophic "open on a public interface" config needs the explicit `network`
spelling. The throw happens before any warning is emitted.

```ts continue
process.env.CB_ALLOW_UNAUTHENTICATED = "1";
enforceOpenModeAtListen({ host: "0.0.0.0", port: 3210 })
=> throws OpenModeBindError

assertOpenModeListenOk()
=> ok
```

## Diagnostic bypass: EVERY batched tRPC procedure must be whitelisted

A single whitelisted procedure passes; a tRPC **batch** URL that also carries a
non-whitelisted procedure (e.g. `history.list`) does NOT — the fix for the old
substring match that let a diag-key holder read past the two allowed endpoints.

```ts continue
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

## `/auth/me` advertises open mode; `/api/push/resubscribe` sits behind the wall

```ts continue
delete process.env.CB_DIAG_API_KEY;
// makeTestServer sets CB_ALLOW_UNAUTHENTICATED=1 (open mode).
process.env.CB_ALLOW_UNAUTHENTICATED = "1";
const server = await makeTestServer();

// Open mode: /auth/me returns { open: true } (the banner signal), not null.
const meOpen = await server.rootRequest({ method: "GET", url: "/auth/me" });
JSON.stringify(meOpen)
=> {"statusCode":200,"body":{"open":true}}

// Open mode: resubscribe passes the wall (then 400s on the empty body — proof
// it reached the handler rather than being blanket-blocked).
const resubOpen = await server.rootRequest({ method: "POST", url: "/api/push/resubscribe", payload: {} });
resubOpen.statusCode
=> 400
```

```ts continue
// Auth required (opt-out cleared): /auth/me 401s and resubscribe 401s.
delete process.env.CB_ALLOW_UNAUTHENTICATED;

const meRequired = await server.rootRequest({ method: "GET", url: "/auth/me" });
meRequired.statusCode
=> 401

const resubRequired = await server.rootRequest({ method: "POST", url: "/api/push/resubscribe", payload: {} });
resubRequired.statusCode
=> 401
```

```ts cleanup
await server.cleanup();
if (ORIGINAL_OPT_OUT === undefined) delete process.env.CB_ALLOW_UNAUTHENTICATED;
else process.env.CB_ALLOW_UNAUTHENTICATED = ORIGINAL_OPT_OUT;
if (ORIGINAL_DIAG_KEY === undefined) delete process.env.CB_DIAG_API_KEY;
else process.env.CB_DIAG_API_KEY = ORIGINAL_DIAG_KEY;
```
