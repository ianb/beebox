# `scanTokens` tRPC procedures: mint once, list without secrets, revoke by name

The boxholder's surface for the scan upload credential. Owner-only, like the
mobile pairing procedures beside it: minting a credential is not something a box
member — let alone a machine credential — may do.

```ts setup
import { appRouter } from "../../src/webapp/trpc/router.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { verifyScanToken } from "../../src/core/scan/tokens.js";

const eventBus = {
  emit: () => 0,
  emitTransient: () => {},
  readSince: () => [],
  subscribe: () => ({ unsubscribe: () => {} }),
  prune: () => 0,
  close: () => {},
};

function caller(boxRoot, { isOwner }) {
  return appRouter.createCaller({
    boxRoot,
    boxSlug: "test",
    eventBus,
    services: {},
    user: { email: "owner@example.com", name: "Owner" },
    authed: true,
    isOwner,
  });
}
```

## create returns the secret once, and it really authenticates

```ts
const box = await makeTmpBox();
const owner = caller(box.root, { isOwner: true });
const created = await owner.scanTokens.create({ name: "laptop-scansnap" });

(await verifyScanToken(box.root, created.token))?.name
=> laptop-scansnap
```

## list never carries a secret or a hash

```ts continue
const listed = await owner.scanTokens.list();
JSON.stringify(listed.map((t) => [t.name, t.createdBy, t.revoked]))
=> [["laptop-scansnap","owner@example.com",false]]

JSON.stringify(listed).includes(created.token)
=> false
```

## revoke kills the credential; a second revoke reports NOT_FOUND

```ts continue
JSON.stringify(await owner.scanTokens.revoke({ name: "laptop-scansnap" }))
=> {"ok":true}

await verifyScanToken(box.root, created.token)
=> null

await owner.scanTokens.revoke({ name: "laptop-scansnap" }).then(() => "no error", (e) => e.code)
=> NOT_FOUND
```

## A duplicate name is a CONFLICT, not a silent second credential

Names are the revoke handle and the provenance string, so they stay unique.

```ts continue
await owner.scanTokens.create({ name: "desk-scanner" });
await owner.scanTokens.create({ name: "desk-scanner" }).then(() => "no error", (e) => e.code)
=> CONFLICT
```

An invalid name is rejected at the input schema, before any store write.

```ts continue
await owner.scanTokens.create({ name: "../../etc/passwd" }).then(() => "no error", (e) => e.code)
=> BAD_REQUEST
```

## Every procedure is owner-only

```ts continue
const member = caller(box.root, { isOwner: false });
const codes = await Promise.all([
  member.scanTokens.create({ name: "sneaky" }).then(() => "no error", (e) => e.code),
  member.scanTokens.list().then(() => "no error", (e) => e.code),
  member.scanTokens.revoke({ name: "desk-scanner" }).then(() => "no error", (e) => e.code),
]);
JSON.stringify(codes)
=> ["FORBIDDEN","FORBIDDEN","FORBIDDEN"]
```

```ts cleanup
await box.cleanup();
```
