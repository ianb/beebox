# Mobile session cookie — signing, verification, and every way it fails closed

`cb_mobile` is the short-lived credential that lets a paired mobile device
authenticate a navigation or a WebSocket upgrade without putting its durable
device token in a URL. Verification is pure HMAC over a per-box secret, so it
costs no filesystem access on the request path — and because the whole cookie
is attacker-controlled input, every malformed shape must return `null` rather
than throw.

```ts setup
import * as fs from "node:fs";
import * as path from "node:path";
import {
  MOBILE_COOKIE_NAME,
  MOBILE_SESSION_TTL_MS,
  clearMobileSessionSecretCache,
  signMobileSession,
  verifyMobileSession,
} from "../../../src/core/mobile/mobile-session.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
```

## The constants are the mirrored contract

`docs/mobile-contract.md` §8 pins the cookie name; a rename here is a contract
break that must move both sides together.

```ts
MOBILE_COOKIE_NAME
=> cb_mobile

MOBILE_SESSION_TTL_MS
=> 3600000
```

## Round-trip: a minted cookie verifies back to its device

```ts
const box = await makeTmpBox();
clearMobileSessionSecretCache();

const cookie = signMobileSession(box.root, { deviceId: "device-1", createdBy: "ada@example.com", ttlMs: MOBILE_SESSION_TTL_MS });
const session = verifyMobileSession(box.root, cookie);
session?.deviceId
=> device-1
```

The payload carries the whole mobile identity, not just the device id.
`createdBy` is what `capture-request-owner.ts` uses to enforce capture
cross-user isolation, so a cookie that dropped it would silently weaken that
check.

```ts continue
session?.createdBy
=> ada@example.com
```

The secret is created on first use, inside the box's `.callback-box/` directory
and readable only by the box owner — the same placement and mode as the device
store it complements.

```ts continue
const secretFile = path.join(box.root, ".callback-box/mobile-session.secret");
fs.existsSync(secretFile)
=> true

(fs.statSync(secretFile).mode & 0o777).toString(8)
=> 600
```

A second mint reuses that secret rather than rotating it, so cookies minted
across requests stay mutually valid.

```ts continue
verifyMobileSession(box.root, signMobileSession(box.root, { deviceId: "device-2", createdBy: null, ttlMs: 60_000 }))?.deviceId
=> device-2

verifyMobileSession(box.root, cookie)?.deviceId
=> device-1
```

## An expired cookie is rejected

`exp` is stamped at mint time, so a zero TTL is already in the past.

```ts continue
verifyMobileSession(box.root, signMobileSession(box.root, { deviceId: "device-1", createdBy: null, ttlMs: 0 }))
=> null

verifyMobileSession(box.root, signMobileSession(box.root, { deviceId: "device-1", createdBy: null, ttlMs: -60_000 }))
=> null
```

## A tampered payload is rejected

Flipping the payload while keeping the signature is the obvious forgery: the
HMAC no longer matches.

```ts continue
const [payloadB64, signature] = cookie.split(".");
const forgedPayload = Buffer.from(JSON.stringify({ deviceId: "attacker", exp: Date.now() + 60_000 })).toString("base64url");
verifyMobileSession(box.root, `${forgedPayload}.${signature}`)
=> null
```

Flipping the signature fails too — including a signature of a *different
length*, which matters because `crypto.timingSafeEqual` throws on a length
mismatch rather than returning false.

```ts continue
verifyMobileSession(box.root, `${payloadB64}.${signature}00`)
=> null

verifyMobileSession(box.root, `${payloadB64}.`)
=> null

verifyMobileSession(box.root, `${payloadB64}.notevenhex`)
=> null
```

## A cookie from another box is rejected

The per-box secret is what makes the cookie safe to hold inside a box at all:
box B cannot verify — and therefore could never forge — box A's cookie.

```ts continue
const otherBox = await makeTmpBox();
verifyMobileSession(otherBox.root, cookie)
=> null
```

The reverse also holds, so this is mutual rather than an artifact of which box
was created first.

```ts continue
const otherCookie = signMobileSession(otherBox.root, { deviceId: "device-1", createdBy: null, ttlMs: 60_000 });
verifyMobileSession(box.root, otherCookie)
=> null

verifyMobileSession(otherBox.root, otherCookie)?.deviceId
=> device-1
```

## Garbage input returns null instead of throwing

Every one of these can arrive from a hostile client; none may reach a `catch`
in a caller.

```ts continue
verifyMobileSession(box.root, undefined)
=> null

verifyMobileSession(box.root, "")
=> null

verifyMobileSession(box.root, "no-dot-at-all")
=> null

verifyMobileSession(box.root, ".")
=> null

verifyMobileSession(box.root, "!!!not-base64!!!.abc")
=> null
```

A signature-valid payload that is not the expected shape is still rejected —
the schema runs after the HMAC, so a payload we somehow signed but cannot
parse fails closed rather than being trusted for having a good signature.

```ts continue
verifyMobileSession(box.root, signMobileSession(box.root, { deviceId: "", createdBy: null, ttlMs: 60_000 }))
=> null
```

```ts cleanup
await box.cleanup();
await otherBox.cleanup();
clearMobileSessionSecretCache();
```
