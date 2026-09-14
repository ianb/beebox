# Scan upload tokens: a store mobile auth can never read

The scan upload credential shares its *mechanics* with the mobile device store
(hashed tokens, cross-process locking, `lastUsedAt`, revocation — all in
`core/token-store.ts`) but lives in its own file behind its own `TokenStore`
instance. That separation is the security property: every mobile gate reduces
identity to a boolean, and any valid device bearer can mint a full session
cookie, so a "scope" field on one shared store could not be contained (see
`docs/plans/scanner-ingest.review.md` finding 1). Two stores, two files, no
cross-resolution.

```ts setup
import * as fs from "node:fs";
import * as path from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import {
  createScanToken,
  listScanTokens,
  revokeScanToken,
  verifyScanToken,
  resolveScanRequestAuth,
  DuplicateScanTokenNameError,
  InvalidScanTokenNameError,
} from "../../../src/core/scan/tokens.js";
import {
  createMobilePairingTicket,
  redeemMobilePairingTicket,
} from "../../../src/core/mobile/pairing.js";
import { resolveMobileRequestAuth } from "../../../src/core/mobile/request-auth.js";

const SCAN_STORE = ".beebox/scan-tokens.secret.json";
const MOBILE_STORE = ".beebox/mobile-devices.secret.json";
```

## Mint returns the secret once; the store keeps only a hash

```ts
const box = await makeTmpBox();
const minted = await createScanToken(box.root, { name: "laptop-scansnap", createdBy: "owner@example.com" });

minted.token.length > 20
=> true
```

The plaintext never lands on disk — the store holds a SHA-256 hash, so a lost
token is re-minted, never recovered.

```ts continue
const raw = fs.readFileSync(path.join(box.root, SCAN_STORE), "utf-8");
print(`stores plaintext: ${raw.includes(minted.token)}`);
print(`stores a hash: ${/"tokenHash": "[\da-f]{64}"/.test(raw)}`);
print(`mode: ${(fs.statSync(path.join(box.root, SCAN_STORE)).mode & 0o777).toString(8)}`);
=>
stores plaintext: false
stores a hash: true
mode: 600
```

## Verify returns the record; a wrong token returns null

```ts continue
(await verifyScanToken(box.root, minted.token))?.name
=> laptop-scansnap

await verifyScanToken(box.root, "not-a-real-token")
=> null

await verifyScanToken(box.root, undefined)
=> null
```

Bearer parsing is shared by the box preHandler and the hub gate, so it is
exercised directly: only a well-formed `Bearer <token>` resolves.

```ts continue
(await resolveScanRequestAuth(box.root, { authorization: `Bearer ${minted.token}` }))?.name
=> laptop-scansnap

await resolveScanRequestAuth(box.root, { authorization: minted.token })
=> null

await resolveScanRequestAuth(box.root, {})
=> null
```

## `list` shows names and usage, never secrets

Verifying stamped `lastUsedAt`, which is how the boxholder tells a live uploader
from an abandoned credential.

```ts continue
const listed = listScanTokens(box.root);
JSON.stringify({
  count: listed.length,
  name: listed[0].name,
  revoked: listed[0].revoked,
  usedRecently: typeof listed[0].lastUsedAt === "string",
  fields: Object.keys(listed[0]).sort().join(","),
})
=> {"count":1,"name":"laptop-scansnap","revoked":false,"usedRecently":true,"fields":"createdAt,createdBy,lastClient,lastUsedAt,name,revoked"}
```

## Revocation is immediate and one-way

```ts continue
await revokeScanToken(box.root, "laptop-scansnap")
=> true

await verifyScanToken(box.root, minted.token)
=> null
```

A second revoke reports false (nothing left to revoke), and the record stays
listed so the boxholder can see the credential existed.

```ts continue
await revokeScanToken(box.root, "laptop-scansnap")
=> false

await revokeScanToken(box.root, "never-existed")
=> false

JSON.stringify(listScanTokens(box.root).map((t) => [t.name, t.revoked]))
=> [["laptop-scansnap",true]]
```

## Names are the revoke handle, so they're unique and constrained

A name also travels into card provenance as `scan-upload/<name>`, so the
charset is conservative.

```ts continue
await createScanToken(box.root, { name: "desk-scanner", createdBy: null });
const nameError = (name) => createScanToken(box.root, { name, createdBy: null }).then(() => "no error", (e) => e.name);

await nameError("desk-scanner")
=> DuplicateScanTokenNameError

await nameError("../../etc/passwd")
=> InvalidScanTokenNameError

await nameError("")
=> InvalidScanTokenNameError
```

## The two stores cannot resolve each other's credentials

This is the structural claim Track 1 rests on. A mobile device token is not a
scan token, and a scan token resolves to no mobile identity — not because a
check rejects it, but because each resolver reads a different file.

```ts continue
const ticket = createMobilePairingTicket(box.root, { createdBy: "owner@example.com" });
const device = await redeemMobilePairingTicket(box.root, { pairingToken: ticket.token, deviceLabel: "phone" });
const scan = await createScanToken(box.root, { name: "uploader", createdBy: null });

// A mobile device token is worthless against the scan store...
await verifyScanToken(box.root, device.deviceToken)
=> null

// ...and a scan token is worthless against every mobile gate.
await resolveMobileRequestAuth(box.root, { authorization: `Bearer ${scan.token}` })
=> null
```

The files themselves are disjoint: neither store's bytes mention the other's
tokens or hashes.

```ts continue
const scanBytes = fs.readFileSync(path.join(box.root, SCAN_STORE), "utf-8");
const mobileBytes = fs.readFileSync(path.join(box.root, MOBILE_STORE), "utf-8");
print(`scan store holds only scan names: ${scanBytes.includes("uploader") && !scanBytes.includes("phone")}`);
print(`mobile store holds only devices: ${mobileBytes.includes("phone") && !mobileBytes.includes("uploader")}`);
=>
scan store holds only scan names: true
mobile store holds only devices: true
```

## A concurrent verify and revoke cannot un-revoke the token

Both are read-modify-writes on the same file from possibly different processes
(the hub verifies before proxying; the box child revokes). The shared lock makes
the verify read the post-revoke record instead of clobbering it.

```ts continue
const racy = await createScanToken(box.root, { name: "racy", createdBy: null });
await Promise.all([
  verifyScanToken(box.root, racy.token),
  revokeScanToken(box.root, "racy"),
]);

await verifyScanToken(box.root, racy.token)
=> null

fs.readdirSync(path.join(box.root, ".beebox")).filter((f) => f.startsWith("scan-tokens.secret.json.tmp")).length
=> 0
```

## The request path records what the uploader said it was

An uploader volunteers its contract version and build on every request. The box
records them and never acts on them at the gate — an old uploader is reported,
not refused — so this is provenance, not a credential check.

```ts continue
const idBox = await makeTmpBox();
const idToken = await createScanToken(idBox.root, { name: "scansnap-laptop", createdBy: null });
await resolveScanRequestAuth(idBox.root, {
  authorization: `Bearer ${idToken.token}`,
  "x-scan-contract": "1",
  "x-scan-client-build": "16e177c0",
  "x-scan-client-built-at": "2026-09-14T18:46:01.243Z",
});
JSON.stringify(listScanTokens(idBox.root)[0].lastClient)
=> {"contract":"1","build":"16e177c0","builtAt":"2026-09-14T18:46:01.243Z"}
```

A checkout reports `source` instead of a build, which is the honest answer: it
runs current source every sweep and cannot drift.

```ts continue
await resolveScanRequestAuth(idBox.root, {
  authorization: `Bearer ${idToken.token}`,
  "x-scan-contract": "1",
  "x-scan-client-build": "source",
});
JSON.stringify(listScanTokens(idBox.root)[0].lastClient)
=> {"contract":"1","build":"source","builtAt":null}
```

An uploader too old to send the headers leaves `lastClient` null rather than
recording a blank. "Not reported" and "reported as nothing" have to stay
distinct, because the freshness health check treats the first as no opinion and
would otherwise call every pre-existing uploader stale.

```ts continue
const oldBox = await makeTmpBox();
const oldToken = await createScanToken(oldBox.root, { name: "older-uploader", createdBy: null });
await resolveScanRequestAuth(oldBox.root, { authorization: `Bearer ${oldToken.token}` });
JSON.stringify(listScanTokens(oldBox.root)[0].lastClient)
=> null
```

Untrusted header text is capped, so a hostile or broken client cannot bloat the
credential store:

```ts continue
await resolveScanRequestAuth(oldBox.root, {
  authorization: `Bearer ${oldToken.token}`,
  "x-scan-client-build": "x".repeat(5000),
});
listScanTokens(oldBox.root)[0].lastClient?.build?.length
=> 100
```

```ts cleanup
await idBox.cleanup();
await oldBox.cleanup();
```

```ts cleanup
await box.cleanup();
```
