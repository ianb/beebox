# Invite capability store (`auth-invites.ts`)

Invite URLs carry a random bearer token, but the machine-local store retains
only its SHA-256 hash. The store is shared by the box child that mints an invite
and the root auth process that consumes it.

```ts setup
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  consumeAuthInvite,
  inspectAuthInvite,
  inviteStorePath,
  mintAuthInvite,
} from "../../src/webapp/auth-invites.js";

async function rejectionName(fn) {
  try {
    await fn();
    return "no-throw";
  } catch (error) {
    return error.name;
  }
}
```

## Minted tokens are short-lived, hashed, canonical, and mode 0600

```ts
const dir = await mkdtemp(join(tmpdir(), "cb-invites-"));
process.env.CB_AUTH_FILE = join(dir, "auth.json");
const now = Date.UTC(2026, 7, 6, 12);

const minted = await mintAuthInvite({
  boxRoot: "/boxes/family",
  createdBy: " Owner@Example.COM ",
  email: " Invitee@Example.COM ",
  now,
});
JSON.stringify({ email: minted.email, lifetime: minted.expiresAt - now, tokenLength: minted.token.length })
=> {"email":"invitee@example.com","lifetime":900000,"tokenLength":43}
```

The clear token is absent from disk and the file is private.

```ts continue
const raw = await readFile(inviteStorePath(), "utf-8");
JSON.stringify({ containsToken: raw.includes(minted.token), mode: ((await stat(inviteStorePath())).mode & 0o777).toString(8) })
=> {"containsToken":false,"mode":"600"}
```

Inspection does not consume. Consumption returns trusted stored metadata once.

```ts continue
JSON.stringify(await inspectAuthInvite({ token: minted.token, now: now + 1 }))
=> {"status":"valid","invite":{"boxRoot":"/boxes/family","email":"invitee@example.com","createdBy":"owner@example.com","expiresAt":1786018500000}}

JSON.stringify(await consumeAuthInvite({ token: minted.token, now: now + 2 }))
=> {"status":"consumed","invite":{"boxRoot":"/boxes/family","email":"invitee@example.com","createdBy":"owner@example.com","expiresAt":1786018500000}}

(await consumeAuthInvite({ token: minted.token, now: now + 3 })).status
=> invalid-or-gone
```

```ts cleanup
await rm(dir, { recursive: true, force: true });
delete process.env.CB_AUTH_FILE;
```

## Expired and malformed capabilities are indistinguishable

```ts
const dir2 = await mkdtemp(join(tmpdir(), "cb-invites-expired-"));
process.env.CB_AUTH_FILE = join(dir2, "auth.json");
const minted2 = await mintAuthInvite({ boxRoot: "/boxes/a", createdBy: "o@example.com", now: 1_000 });

(await inspectAuthInvite({ token: minted2.token, now: 1_000 + 15 * 60 * 1_000 })).status
=> invalid-or-gone

(await inspectAuthInvite({ token: "not-a-token", now: 1_001 })).status
=> invalid-or-gone
```

```ts cleanup
await rm(dir2, { recursive: true, force: true });
delete process.env.CB_AUTH_FILE;
```

## Corruption and symlinks fail closed

```ts
const dir3 = await mkdtemp(join(tmpdir(), "cb-invites-bad-"));
process.env.CB_AUTH_FILE = join(dir3, "auth.json");
await writeFile(inviteStorePath(), "{bad json", { mode: 0o600 });

await rejectionName(() => inspectAuthInvite({ token: "anything" }))
=> AuthInviteStoreError
```

```ts cleanup
await rm(dir3, { recursive: true, force: true });
delete process.env.CB_AUTH_FILE;
```

## Concurrent consumption has exactly one winner

```ts
const dir4 = await mkdtemp(join(tmpdir(), "cb-invites-race-"));
process.env.CB_AUTH_FILE = join(dir4, "auth.json");
const minted4 = await mintAuthInvite({ boxRoot: "/boxes/a", createdBy: "o@example.com" });
const raced = await Promise.all([
  consumeAuthInvite({ token: minted4.token }),
  consumeAuthInvite({ token: minted4.token }),
]);
raced.map((result) => result.status).sort().join(",")
=> consumed,invalid-or-gone
```

```ts cleanup
await rm(dir4, { recursive: true, force: true });
delete process.env.CB_AUTH_FILE;
```
