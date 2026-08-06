# Invite capability store (`auth-invites.ts`)

Invite URLs carry a random bearer token, but the machine-local store retains
only its SHA-256 hash. The store is shared by the box child that mints an invite
and the root auth process that consumes it.

```ts setup
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
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

const PACKAGE_ROOT = join(import.meta.dirname, "../..");

async function consumeInChild(token) {
  const code = `const { consumeAuthInvite } = await import("./src/webapp/auth-invites.ts"); console.log((await consumeAuthInvite({ token: process.env.TEST_INVITE_TOKEN })).status);`;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", code], {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, TEST_INVITE_TOKEN: token },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const codeResult = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (codeResult !== 0) throw new Error(`invite child failed (${codeResult}): ${stderr}`);
  return stdout.trim();
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

```ts continue
await rm(inviteStorePath());
const symlinkTarget = join(dir3, "invite-target.json");
await writeFile(symlinkTarget, JSON.stringify({ version: 1, invites: [] }), { mode: 0o600 });
await symlink(symlinkTarget, inviteStorePath());

await rejectionName(() => inspectAuthInvite({ token: "anything" }))
=> AuthInviteStoreError
```

```ts cleanup
await rm(dir3, { recursive: true, force: true });
delete process.env.CB_AUTH_FILE;
```

## The live-invite cap fails closed

```ts
const dir5 = await mkdtemp(join(tmpdir(), "cb-invites-cap-"));
process.env.CB_AUTH_FILE = join(dir5, "auth.json");
for (let index = 0; index < 100; index += 1) {
  await mintAuthInvite({ boxRoot: "/boxes/a", createdBy: "o@example.com" });
}

await rejectionName(() => mintAuthInvite({ boxRoot: "/boxes/a", createdBy: "o@example.com" }))
=> AuthInviteCapacityError
```

```ts cleanup
await rm(dir5, { recursive: true, force: true });
delete process.env.CB_AUTH_FILE;
```

## Concurrent consumption has exactly one winner

```ts
const dir4 = await mkdtemp(join(tmpdir(), "cb-invites-race-"));
process.env.CB_AUTH_FILE = join(dir4, "auth.json");
const minted4 = await mintAuthInvite({ boxRoot: "/boxes/a", createdBy: "o@example.com" });
const raced = await Promise.all([consumeInChild(minted4.token), consumeInChild(minted4.token)]);
raced.sort().join(",")
=> consumed,invalid-or-gone
```

```ts cleanup
await rm(dir4, { recursive: true, force: true });
delete process.env.CB_AUTH_FILE;
```
