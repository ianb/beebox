# Auth capability store (`auth-capabilities.ts`)

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
  consumeAuthPasswordReset,
  inspectAuthInvite,
  inspectAuthPasswordReset,
  authCapabilityStorePath,
  mintAuthInvite,
  mintAuthPasswordReset,
} from "../../src/webapp/auth-capabilities.js";

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
  const code = `const { consumeAuthInvite } = await import("./src/webapp/auth-capabilities.ts"); console.log((await consumeAuthInvite({ token: process.env.TEST_INVITE_TOKEN })).status);`;
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
const dir = await mkdtemp(join(tmpdir(), "bbx-invites-"));
process.env.BBX_AUTH_FILE = join(dir, "auth.json");
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
const raw = await readFile(authCapabilityStorePath(), "utf-8");
JSON.stringify({ containsToken: raw.includes(minted.token), mode: ((await stat(authCapabilityStorePath())).mode & 0o777).toString(8) })
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
delete process.env.BBX_AUTH_FILE;
```

## Expired and malformed capabilities are indistinguishable

```ts
const dir2 = await mkdtemp(join(tmpdir(), "bbx-invites-expired-"));
process.env.BBX_AUTH_FILE = join(dir2, "auth.json");
const minted2 = await mintAuthInvite({ boxRoot: "/boxes/a", createdBy: "o@example.com", now: 1_000 });

(await inspectAuthInvite({ token: minted2.token, now: 1_000 + 15 * 60 * 1_000 })).status
=> invalid-or-gone

(await inspectAuthInvite({ token: "not-a-token", now: 1_001 })).status
=> invalid-or-gone
```

```ts cleanup
await rm(dir2, { recursive: true, force: true });
delete process.env.BBX_AUTH_FILE;
```

## Corruption and symlinks fail closed

```ts
const dir3 = await mkdtemp(join(tmpdir(), "bbx-invites-bad-"));
process.env.BBX_AUTH_FILE = join(dir3, "auth.json");
await writeFile(authCapabilityStorePath(), "{bad json", { mode: 0o600 });

await rejectionName(() => inspectAuthInvite({ token: "anything" }))
=> AuthCapabilityStoreError
```

```ts continue
await rm(authCapabilityStorePath());
const symlinkTarget = join(dir3, "invite-target.json");
await writeFile(symlinkTarget, JSON.stringify({ version: 1, invites: [] }), { mode: 0o600 });
await symlink(symlinkTarget, authCapabilityStorePath());

await rejectionName(() => inspectAuthInvite({ token: "anything" }))
=> AuthCapabilityStoreError
```

```ts cleanup
await rm(dir3, { recursive: true, force: true });
delete process.env.BBX_AUTH_FILE;
```

## The live-invite cap fails closed

```ts
const dir5 = await mkdtemp(join(tmpdir(), "bbx-invites-cap-"));
process.env.BBX_AUTH_FILE = join(dir5, "auth.json");
for (let index = 0; index < 100; index += 1) {
  await mintAuthInvite({ boxRoot: "/boxes/a", createdBy: "o@example.com" });
}

await rejectionName(() => mintAuthInvite({ boxRoot: "/boxes/a", createdBy: "o@example.com" }))
=> AuthCapabilityCapacityError
```

```ts cleanup
await rm(dir5, { recursive: true, force: true });
delete process.env.BBX_AUTH_FILE;
```

## Concurrent consumption has exactly one winner

```ts
const dir4 = await mkdtemp(join(tmpdir(), "bbx-invites-race-"));
process.env.BBX_AUTH_FILE = join(dir4, "auth.json");
const minted4 = await mintAuthInvite({ boxRoot: "/boxes/a", createdBy: "o@example.com" });
const raced = await Promise.all([consumeInChild(minted4.token), consumeInChild(minted4.token)]);
raced.sort().join(",")
=> consumed,invalid-or-gone
```

```ts cleanup
await rm(dir4, { recursive: true, force: true });
delete process.env.BBX_AUTH_FILE;
```

## Password resets are typed siblings and replace older links

```ts
const resetDir = await mkdtemp(join(tmpdir(), "bbx-password-resets-"));
process.env.BBX_AUTH_FILE = join(resetDir, "auth.json");
const firstReset = await mintAuthPasswordReset({
  boxRoot: "/boxes/family",
  createdBy: "Owner@Example.COM",
  email: "Member@Example.COM",
});

JSON.stringify({
  email: firstReset.email,
  inviteSeesReset: (await inspectAuthInvite({ token: firstReset.token })).status,
  resetSeesReset: (await inspectAuthPasswordReset({ token: firstReset.token })).status,
})
=> {"email":"member@example.com","inviteSeesReset":"invalid-or-gone","resetSeesReset":"valid"}
```

Minting a replacement invalidates the older link before capacity is checked.

```ts continue
for (let index = 0; index < 99; index += 1) {
  await mintAuthInvite({ boxRoot: `/boxes/${String(index)}`, createdBy: "owner@example.com" });
}
const replacement = await mintAuthPasswordReset({
  boxRoot: "/boxes/other",
  createdBy: "owner@example.com",
  email: "member@example.com",
});

`${(await inspectAuthPasswordReset({ token: firstReset.token })).status},${(await inspectAuthPasswordReset({ token: replacement.token })).status}`
=> invalid-or-gone,valid
```

Consumption invalidates every reset link for that account and cannot consume an
invite token.

```ts continue
const unrelatedInvite = await consumeAuthInvite({ token: replacement.token });
const consumedReset = await consumeAuthPasswordReset({ token: replacement.token });
JSON.stringify({ invite: unrelatedInvite.status, reset: consumedReset.status, replay: (await consumeAuthPasswordReset({ token: replacement.token })).status })
=> {"invite":"invalid-or-gone","reset":"consumed","replay":"invalid-or-gone"}
```

```ts cleanup
await rm(resetDir, { recursive: true, force: true });
delete process.env.BBX_AUTH_FILE;
```

## A v1 invite store upgrades on mutation without losing its invites

```ts
const migrationDir = await mkdtemp(join(tmpdir(), "bbx-capability-migration-"));
process.env.BBX_AUTH_FILE = join(migrationDir, "auth.json");
const legacyToken = "legacy-token";
const legacyHash = (await import("node:crypto")).createHash("sha256").update(legacyToken).digest("hex");
await writeFile(authCapabilityStorePath(), JSON.stringify({
  version: 1,
  invites: [{
    tokenHash: legacyHash,
    boxRoot: "/boxes/legacy",
    email: "legacy@example.com",
    createdBy: "owner@example.com",
    createdAt: 1,
    expiresAt: Date.now() + 60_000,
  }],
}), { mode: 0o600 });

(await inspectAuthInvite({ token: legacyToken })).status
=> valid

await mintAuthPasswordReset({ boxRoot: "/boxes/legacy", createdBy: "owner@example.com", email: "legacy@example.com" });
JSON.parse(await readFile(authCapabilityStorePath(), "utf-8")).version
=> 2

(await inspectAuthInvite({ token: legacyToken })).status
=> valid
```

```ts cleanup
await rm(migrationDir, { recursive: true, force: true });
delete process.env.BBX_AUTH_FILE;
```
