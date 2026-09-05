# Chat sends from a paired mobile device are attributed to a user

`getSessionUser` only reads the `bbx_session` cookie, but a paired mobile device
authenticates every native and mobile-web send with a bearer token (or a
`bbx_mobile` cookie) and carries no cookie session. Before this fix those sends
landed in the transcript with `user: null` — attributed to nobody.
`resolveMobileSender` closes that gap: it resolves the request's mobile identity
to the device record's `createdBy` (the email that paired it) so the send is
attributed to a real user.

```ts setup
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { createFirstUser } from "../../../src/webapp/local-users.js";
import { createMobilePairingTicket, redeemMobilePairingTicket } from "../../../src/core/mobile/pairing.js";
import { resolveMobileSender, injectUserAttr } from "../../../src/webapp/routes/chat-helpers.js";

// A throwaway credential store with a small scrypt work factor keeps the
// display-name lookup fast; BBX_AUTH_SCRYPT_N is a test-only seam.
process.env.BBX_AUTH_SCRYPT_N = String(2 ** 14);
const authDir = await mkdtemp(join(tmpdir(), "bbx-auth-sender-"));
process.env.BBX_AUTH_FILE = join(authDir, "auth.json");
delete process.env.BBX_OWNER_EMAIL;
```

## A bearer-authenticated send resolves to the pairing owner

Pair a device whose `createdBy` is the owner, then resolve a request that
carries only the durable device token in an `Authorization` header. The store
has a matching local user, so the sender gets that user's display name.

```ts
const box = await makeTmpBox();
await createFirstUser({ email: "ada@example.com", password: "correct-horse", name: "Ada Lovelace" });

const ticket = createMobilePairingTicket(box.root, { createdBy: "ada@example.com" });
const device = await redeemMobilePairingTicket(box.root, { pairingToken: ticket.token, deviceLabel: "iPhone" });
device !== null
=> true

const sender = await resolveMobileSender(box.root, { authorization: `Bearer ${device.deviceToken}` });
JSON.stringify(sender)
=> {"email":"ada@example.com","name":"Ada Lovelace"}
```

That identity is what flows into the message tag, so the transcript shows a real
sender instead of an unattributed `<typed>`:

```ts continue
injectUserAttr("<typed>hello from my phone</typed>", sender)
=> <typed user="Ada Lovelace" user-email="ada@example.com">hello from my phone</typed>
```

## Without a local record the email stands in for the name

A device paired against an identity that has no local-user record (e.g. a
Google-only login) still attributes — the display name degrades to the email
rather than failing.

```ts continue
const ticket2 = createMobilePairingTicket(box.root, { createdBy: "grace@example.com" });
const device2 = await redeemMobilePairingTicket(box.root, { pairingToken: ticket2.token, deviceLabel: "iPad" });
JSON.stringify(await resolveMobileSender(box.root, { authorization: `Bearer ${device2.deviceToken}` }))
=> {"email":"grace@example.com","name":"grace@example.com"}
```

## No identity to attribute returns null

A device paired in open mode carries no `createdBy`, so there is genuinely no
user — matching the cookie path's `null` for an unauthenticated request.

```ts continue
const openTicket = createMobilePairingTicket(box.root);
const openDevice = await redeemMobilePairingTicket(box.root, { pairingToken: openTicket.token, deviceLabel: "kiosk" });
await resolveMobileSender(box.root, { authorization: `Bearer ${openDevice.deviceToken}` })
=> null
```

A request with no mobile credentials at all is also null (nothing to resolve),
and a bogus bearer token never matches a device.

```ts continue
await resolveMobileSender(box.root, {})
=> null

await resolveMobileSender(box.root, { authorization: "Bearer not-a-real-token" })
=> null
```

```ts cleanup
await box.cleanup();
await rm(authDir, { recursive: true, force: true });
delete process.env.BBX_AUTH_FILE;
delete process.env.BBX_AUTH_SCRYPT_N;
```
</content>
</invoke>
