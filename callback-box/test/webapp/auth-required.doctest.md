# Always-on auth gate: `authRequired()` / `openMode()` and the wall's edges

Authentication is the always-on default. `authRequired()` (`src/webapp/auth.ts`)
returns `true` unless a deliberate `CB_ALLOW_UNAUTHENTICATED` opt-out is set —
Google configuration no longer gates the wall. `openMode()` classifies the
opt-out into `"off"` / `"loopback"` / `"network"`, rejecting any other value at
startup. This doctest covers the gate's semantics, the tiered bind check, the
diagnostic-bypass batch-URL fix, and the two root-route edges (`/auth/me` open
shape, `/api/push/resubscribe` behind the wall).

```ts setup
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  openMode,
  authRequired,
  enforceOpenModeAtListen,
  isDiagnosticBypassRequest,
} from "../../src/webapp/auth.js";
import { makeTestServer } from "../helpers/doctest-server.js";

const ORIGINAL_OPT_OUT = process.env.CB_ALLOW_UNAUTHENTICATED;
const ORIGINAL_DIAG_KEY = process.env.CB_DIAG_API_KEY;

// Point the Tailscale exposure file at a clean per-run tmp path so the bind-tier
// checks above see "nothing exposed" (no file), and the exposure-guard section
// below can write/clear it hermetically.
const ORIGINAL_EXPOSURE_FILE = process.env.CB_TAILSCALE_EXPOSURE_FILE;
const exposureFile = path.join(os.tmpdir(), `cb-exposure-auth-test-${process.pid}-${Date.now()}.json`);
process.env.CB_TAILSCALE_EXPOSURE_FILE = exposureFile;

/** Call `enforceOpenModeAtListen` with the open-mode boot warning suppressed,
 *  returning `"ok"` or the thrown error's name — for the exposure-guard section. */
function listenResult({ host, port }) {
  const origWarn = console.warn;
  console.warn = function suppressed() { /* silence the open-mode boot warning */ };
  try {
    enforceOpenModeAtListen({ host, port });
    return "ok";
  } catch (e) {
    return e.name;
  } finally {
    console.warn = origWarn;
  }
}

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

## The exposure-intent guard: open mode refuses to start while a port is exposed

Once `cb tailscale setup` records a port in the exposure file
(`tailscale-exposure.ts`), `enforceOpenModeAtListen` refuses to bind that port in
open mode — the durable half of the auth-posture guard, so a restart into open
mode can't silently reopen a Tailscale-fronted box (the OpenClaw-#50630 analog).

```ts
delete process.env.CB_ALLOW_UNAUTHENTICATED;
fs.writeFileSync(
  exposureFile,
  JSON.stringify({ version: 1, targets: [{ port: 3210, dnsName: "box.tail1234.ts.net", configuredAt: "2026-07-20T00:00:00Z" }] }),
);

// Open mode + the recorded port ⇒ refuse to start (fail closed).
process.env.CB_ALLOW_UNAUTHENTICATED = "1";
listenResult({ host: "127.0.0.1", port: 3210 })
=> OpenModeExposureError

// Open mode but a DIFFERENT (unrecorded) port ⇒ no exposure conflict.
listenResult({ host: "127.0.0.1", port: 9999 })
=> ok

// Auth on (opt-out unset) ⇒ the exposure file is never consulted, even for the
// recorded port (zero cost on the normal path).
delete process.env.CB_ALLOW_UNAUTHENTICATED;
listenResult({ host: "127.0.0.1", port: 3210 })
=> ok
```

A corrupt/unparseable exposure file while open mode is requested also refuses —
distinct from the recorded-port error, never assumed-empty:

```ts
fs.writeFileSync(exposureFile, "{ this is not json");
process.env.CB_ALLOW_UNAUTHENTICATED = "1";
listenResult({ host: "127.0.0.1", port: 3210 })
=> ExposureFileUnreadableError
```

```ts cleanup
fs.rmSync(exposureFile, { force: true });
if (ORIGINAL_EXPOSURE_FILE === undefined) delete process.env.CB_TAILSCALE_EXPOSURE_FILE;
else process.env.CB_TAILSCALE_EXPOSURE_FILE = ORIGINAL_EXPOSURE_FILE;
if (ORIGINAL_OPT_OUT === undefined) delete process.env.CB_ALLOW_UNAUTHENTICATED;
else process.env.CB_ALLOW_UNAUTHENTICATED = ORIGINAL_OPT_OUT;
```
