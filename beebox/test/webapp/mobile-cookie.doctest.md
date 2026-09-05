# Issuing and renewing the `bbx_mobile` cookie

A paired device authenticates with its durable token in an `Authorization`
header; the box answers with a short-lived `bbx_mobile` cookie that carries
everything after — including the WebSocket upgrade, which the browser API
cannot attach headers to.

The renewal rules are what make the short TTL safe rather than merely annoying,
so they get the most coverage here: a signed cookie cannot be revoked before it
expires, so renewal is the only place revocation can take effect.

```ts setup
import Fastify from "fastify";
import * as fs from "node:fs";
import * as path from "node:path";
import fastifyCookie from "@fastify/cookie";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { createMobilePairingTicket, redeemMobilePairingTicket, revokeMobileDevice } from "../../src/core/mobile/pairing.js";
import { MOBILE_COOKIE_NAME, MOBILE_SESSION_TTL_MS, signMobileSession, verifyMobileSession } from "../../src/core/mobile/mobile-session.js";
import { resolveMobileRequestAuth } from "../../src/core/mobile/request-auth.js";
import { renewMobileSessionCookie } from "../../src/webapp/mobile-cookie.js";
import { registerPairingRoutes } from "../../src/webapp/routes/pairing.js";

/** Captures what a handler did to the reply's cookies. */
function fakeReply() {
  const calls: string[] = [];
  return {
    calls,
    setCookie(name: string, value: string, opts: Record<string, unknown>) {
      calls.push(`set ${name} path=${String(opts.path)} httpOnly=${String(opts.httpOnly)} sameSite=${String(opts.sameSite)}`);
      calls.push(`value ${value}`);
      return this;
    },
    clearCookie(name: string, opts: Record<string, unknown>) {
      calls.push(`clear ${name} path=${String(opts.path)}`);
      return this;
    },
  };
}
```

## The mint endpoint trades a device token for a cookie

```ts
const box = await makeTmpBox();
const server = Fastify();
await server.register(fastifyCookie);
registerPairingRoutes(server, { boxRoot: box.root, boxSlug: "test" });

const ticket = createMobilePairingTicket(box.root);
const redeemed = await redeemMobilePairingTicket(box.root, { pairingToken: ticket.token, deviceLabel: "doctest" });
if (!redeemed) throw new Error("pairing failed");

const minted = await server.inject({
  method: "POST",
  url: "/api/pairing/session",
  headers: { authorization: `Bearer ${redeemed.deviceToken}` },
});
minted.statusCode
=> 204
```

The cookie it sets is scoped to this box's path and unreadable from page JS —
`HttpOnly` is what keeps the iframe/XSS exfiltration route that the old
localStorage channel had from reappearing.

```ts continue
const setCookie = String(minted.headers["set-cookie"]);
[setCookie.includes("HttpOnly"), setCookie.includes("Path=/test"), setCookie.includes("SameSite=Lax")].join(" ")
=> true true true
```

And it verifies back to the device that minted it.

```ts continue
const value = setCookie.split(";")[0]?.split("=").slice(1).join("=") ?? "";
verifyMobileSession(box.root, decodeURIComponent(value))?.deviceId === redeemed.deviceId
=> true
```

## A bad or absent token mints nothing

```ts continue
(await server.inject({ method: "POST", url: "/api/pairing/session" })).statusCode
=> 401

(await server.inject({
  method: "POST",
  url: "/api/pairing/session",
  headers: { authorization: "Bearer not-a-real-token" },
})).statusCode
=> 401
```

A revoked device can no longer mint, which is what stops it renewing its way
past the TTL bound.

```ts continue
await revokeMobileDevice(box.root, redeemed.deviceId)
=> true

(await server.inject({
  method: "POST",
  url: "/api/pairing/session",
  headers: { authorization: `Bearer ${redeemed.deviceToken}` },
})).statusCode
=> 401
```

```ts cleanup
await server.close();
await box.cleanup();
```

## Both credentials resolve to the same identity

The cookie carries `createdBy`, not just the device id — `capture-request-owner.ts`
uses it as the authenticated email for capture-session ownership, so a cookie
that dropped it would silently weaken cross-user isolation.

```ts
const box2 = await makeTmpBox();
const ticket2 = createMobilePairingTicket(box2.root, { createdBy: "ada@example.com" });
const device = await redeemMobilePairingTicket(box2.root, { pairingToken: ticket2.token, deviceLabel: "doctest" });
if (!device) throw new Error("pairing failed");

const viaBearer = await resolveMobileRequestAuth(box2.root, { authorization: `Bearer ${device.deviceToken}` });
JSON.stringify({ deviceId: viaBearer?.deviceId === device.deviceId, createdBy: viaBearer?.createdBy, source: viaBearer?.source })
=> {"deviceId":true,"createdBy":"ada@example.com","source":"bearer"}

const cookie = signMobileSession(box2.root, { deviceId: device.deviceId, createdBy: "ada@example.com", ttlMs: MOBILE_SESSION_TTL_MS });
const viaCookie = await resolveMobileRequestAuth(box2.root, { cookie: `${MOBILE_COOKIE_NAME}=${cookie}` });
JSON.stringify({ deviceId: viaCookie?.deviceId === device.deviceId, createdBy: viaCookie?.createdBy, source: viaCookie?.source })
=> {"deviceId":true,"createdBy":"ada@example.com","source":"cookie"}
```

A request carrying neither resolves to nothing, and a bogus cookie does not
fall through to some laxer check.

```ts continue
await resolveMobileRequestAuth(box2.root, {})
=> null

await resolveMobileRequestAuth(box2.root, { cookie: `${MOBILE_COOKIE_NAME}=forged` })
=> null
```

## A shadowing cookie from a sibling box cannot lock the real one out

Boxes are path siblings on one origin, so a script under box A can set
`bbx_mobile=junk; Path=/` and the browser will send that value alongside box B's
real `Path=/<slug>` cookie on every request to B. Checking only the first value
would make that a one-line cross-box denial of service.

It was never an escalation risk — the signature is per-box, so a forged value
can't authenticate — but crowding out the real cookie is enough to break a
sibling.

```ts continue
const shadowed = await resolveMobileRequestAuth(box2.root, {
  cookie: `${MOBILE_COOKIE_NAME}=junk-from-a-sibling-box; ${MOBILE_COOKIE_NAME}=${cookie}`,
});
shadowed?.deviceId === device.deviceId
=> true
```

Order doesn't matter — the real cookie wins from either side.

```ts continue
const shadowedAfter = await resolveMobileRequestAuth(box2.root, {
  cookie: `${MOBILE_COOKIE_NAME}=${cookie}; ${MOBILE_COOKIE_NAME}=junk-from-a-sibling-box`,
});
shadowedAfter?.deviceId === device.deviceId
=> true
```

And a pile of junk with no real cookie among it still authenticates nothing.

```ts continue
await resolveMobileRequestAuth(box2.root, {
  cookie: `${MOBILE_COOKIE_NAME}=junk-one; ${MOBILE_COOKIE_NAME}=junk-two`,
})
=> null
```

## Verification never creates a signing secret

The box and the hub both verify these cookies, in separate processes with
separate caches and no way to invalidate each other's. If verifying could
generate a secret, whichever process first saw a missing file would mint one
and cache it while the other kept signing with the old value — every cookie
would verify in one process and fail in the other, indefinitely and silently.

```ts continue
const untouchedBox = await makeTmpBox();
const secretFile = path.join(untouchedBox.root, ".beebox/mobile-session.secret");

verifyMobileSession(untouchedBox.root, cookie)
=> null

fs.existsSync(secretFile)
=> false
```

Minting is the only thing that creates one.

```ts continue
signMobileSession(untouchedBox.root, { deviceId: "d", createdBy: null, ttlMs: 60_000 }).length > 0
=> true

fs.existsSync(secretFile)
=> true

await untouchedBox.cleanup();
```

## Renewal only re-reads the device store past the halfway point

A fresh cookie is left alone, so an active session costs no filesystem access
per request.

```ts continue
const fresh = await resolveMobileRequestAuth(box2.root, { cookie: `${MOBILE_COOKIE_NAME}=${cookie}` });
if (!fresh) throw new Error("expected a session");
const untouched = fakeReply();
renewMobileSessionCookie(untouched, { boxRoot: box2.root, boxSlug: "test", auth: fresh });
untouched.calls.length
=> 0
```

Past halfway it re-issues.

```ts continue
const agedCookie = signMobileSession(box2.root, { deviceId: device.deviceId, createdBy: null, ttlMs: MOBILE_SESSION_TTL_MS / 4 });
const aged = await resolveMobileRequestAuth(box2.root, { cookie: `${MOBILE_COOKIE_NAME}=${agedCookie}` });
if (!aged) throw new Error("expected a session");
const renewed = fakeReply();
renewMobileSessionCookie(renewed, { boxRoot: box2.root, boxSlug: "test", auth: aged });
renewed.calls[0]
=> set bbx_mobile path=/test httpOnly=true sameSite=lax
```

A bearer-authenticated request always (re)issues — verifying the bearer already
read the device store, so there's nothing to save by waiting.

```ts continue
const bearerAuth = await resolveMobileRequestAuth(box2.root, { authorization: `Bearer ${device.deviceToken}` });
if (!bearerAuth) throw new Error("expected a session");
const issued = fakeReply();
renewMobileSessionCookie(issued, { boxRoot: box2.root, boxSlug: "test", auth: bearerAuth });
issued.calls[0]
=> set bbx_mobile path=/test httpOnly=true sameSite=lax
```

## A revoked device is cleared, not merely denied a renewal

This is the bound the design claims: revocation takes effect within one TTL,
and on the next renewal attempt the stale cookie is actively cleared rather
than left to run out.

```ts continue
await revokeMobileDevice(box2.root, device.deviceId)
=> true

const afterRevoke = fakeReply();
renewMobileSessionCookie(afterRevoke, { boxRoot: box2.root, boxSlug: "test", auth: aged });
afterRevoke.calls.join(" | ")
=> clear bbx_mobile path=/test
```

The already-issued cookie still verifies until it expires — that IS the
revocation latency, stated rather than hidden.

```ts continue
verifyMobileSession(box2.root, agedCookie)?.deviceId === device.deviceId
=> true
```

```ts cleanup
await box2.cleanup();
```
