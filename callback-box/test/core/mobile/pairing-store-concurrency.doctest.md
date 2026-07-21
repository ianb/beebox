# Mobile device store: locked, crash-safe read-modify-write

The device store is written from more than one process — `cb hub` stamps
`lastUsedAt` when it verifies a bearer before proxying, and the per-box
`cb serve` child verifies it again and can revoke it. An unsynchronized
read-modify-write there is a genuine lost update: a verify that read the record
before a revoke could write the pre-revoke copy back and silently un-revoke the
device. Every mutation now runs through the cross-process `file-lock.ts`
primitive and lands via temp-file + fsync + atomic rename (mirroring the sibling
credential store `webapp/local-users.ts`).

```ts setup
import * as fs from "node:fs";
import * as path from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import {
  createMobilePairingTicket,
  redeemMobilePairingTicket,
  revokeMobileDevice,
  resolveMobileBearerIdentity,
  listMobileDevices,
} from "../../../src/core/mobile/pairing.js";

const STORE = ".callback-box/mobile-devices.secret.json";
```

## The async round-trip: pair, verify, revoke, re-verify

Verification returns the device identity and no longer un-revokes anything.

```ts
const box = await makeTmpBox();
const ticket = createMobilePairingTicket(box.root, { createdBy: "ada@example.com" });
const device = await redeemMobilePairingTicket(box.root, { pairingToken: ticket.token, deviceLabel: "phone" });

const identity = await resolveMobileBearerIdentity(box.root, `Bearer ${device.deviceToken}`);
identity?.createdBy
=> ada@example.com
```

A revoked device stops verifying, and stays revoked on the next verify attempt.

```ts continue
await revokeMobileDevice(box.root, device.deviceId)
=> true

await resolveMobileBearerIdentity(box.root, `Bearer ${device.deviceToken}`)
=> null
```

## A verify concurrent with a revoke cannot un-revoke the device

Fire the `lastUsedAt`-stamping verify and the revoke at the same time. Whichever
wins the lock, the device must end up revoked — the lock makes the verify read
the post-revoke record instead of clobbering it with a stale one.

```ts continue
const box2 = await makeTmpBox();
const ticket2 = createMobilePairingTicket(box2.root, { createdBy: "grace@example.com" });
const device2 = await redeemMobilePairingTicket(box2.root, { pairingToken: ticket2.token, deviceLabel: "phone2" });

// Verify (RMW: stamps lastUsedAt) racing revoke (RMW: sets revokedAt).
await Promise.all([
  resolveMobileBearerIdentity(box2.root, `Bearer ${device2.deviceToken}`),
  revokeMobileDevice(box2.root, device2.deviceId),
]);

const devices = listMobileDevices(box2.root);
typeof devices[0].revokedAt === "string"
=> true
```

The device no longer authenticates, and never will again from this token.

```ts continue
await resolveMobileBearerIdentity(box2.root, `Bearer ${device2.deviceToken}`)
=> null
```

## The store stays valid JSON and 0600, with no temp files left behind

The atomic rename means a reader never sees a half-written file, and the fsync'd
temp sibling is always renamed away — a concurrent burst leaves exactly one
`mode 600` store and no `.tmp-*` litter.

```ts continue
JSON.parse(fs.readFileSync(path.join(box2.root, STORE), "utf-8")).devices.length
=> 1

(fs.statSync(path.join(box2.root, STORE)).mode & 0o777).toString(8)
=> 600

fs.readdirSync(path.join(box2.root, ".callback-box")).filter((f) => f.startsWith("mobile-devices.secret.json.tmp")).length
=> 0
```

```ts cleanup
await box.cleanup();
await box2.cleanup();
```
</content>
</invoke>
