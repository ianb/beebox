# admin.boxConfig / updateBoxConfig parity

The `admin` tRPC procedures reached parity with the raw `/api/admin/box-config`
route so the raw route can retire: `boxConfig` returns `ownerEmail`, and
`updateBoxConfig` accepts `googleServices` (not just `allowedEmails`), commits
the change, and returns both fields.

```ts setup
import { appRouter } from "../../src/webapp/trpc/router.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { simpleGit } from "simple-git";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addUser, createFirstUser } from "../../src/webapp/local-users.js";

// Owner context (ownerProcedure requires ctx.isOwner).
function caller(boxRoot, user = { email: "owner@example.com", name: "Owner" }) {
  const ctx = {
    boxRoot,
    boxSlug: "test",
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {},
    user,
    authed: true,
    isOwner: true,
  };
  return appRouter.createCaller(ctx);
}
```

## Invite minting requires a concrete matching local owner

```ts
const inviteAuthDir = await mkdtemp(join(tmpdir(), "cb-admin-invite-"));
process.env.CB_AUTH_FILE = join(inviteAuthDir, "auth.json");
process.env.CB_AUTH_SCRYPT_N = "1024";
process.env.CB_OWNER_EMAIL = "owner@example.com";
await createFirstUser({ email: "owner@example.com", name: "Owner", password: "owner-password" });
const inviteBox = await makeTmpBox({ git: true });

const invite = await caller(inviteBox.root).admin.createInvite({ email: " Member@Example.COM " });
JSON.stringify({ path: invite.invitePath.startsWith("/auth/invite?token="), future: invite.expiresAt > Date.now() })
=> {"path":true,"future":true}
```

Open/test owner authorization without a human identity cannot mint a bearer
capability into the global credential store.

```ts continue
const openResult = await caller(inviteBox.root, null).admin.createInvite({}).then(
  () => "allowed",
  (error) => error.code,
);
openResult
=> UNAUTHORIZED
```

The owner can detect when an allowlist addition would grant an already-created
local account, including an identity previously claimed through an open invite.

```ts continue
await addUser({ email: "claimed@example.com", name: "Claimed", password: "claimed-password", role: "member" });
JSON.stringify(await caller(inviteBox.root).admin.localAccountStatus({ email: " Claimed@Example.COM " }))
=> {"exists":true}
```

Pinned invites cannot replace an existing local identity.

```ts continue
const pinnedConflict = await caller(inviteBox.root).admin.createInvite({ email: "claimed@example.com" }).then(
  () => "allowed",
  (error) => error.code,
);
pinnedConflict
=> CONFLICT
```

A corrupt capability store is a typed, generic precondition failure on the
owner surface; its filesystem path is not exposed in the error message.

```ts continue
await writeFile(`${process.env.CB_AUTH_FILE}.invites.json`, "not json", { mode: 0o600 });
const unavailableInvite = await caller(inviteBox.root).admin.createInvite({}).then(
  () => ({ code: "none", message: "" }),
  (error) => ({ code: error.code, message: error.message }),
);
JSON.stringify(unavailableInvite)
=> {"code":"PRECONDITION_FAILED","message":"The invite store is unavailable."}
```

```ts cleanup
await inviteBox.cleanup();
await rm(inviteAuthDir, { recursive: true, force: true });
delete process.env.CB_AUTH_FILE;
delete process.env.CB_AUTH_SCRYPT_N;
delete process.env.CB_OWNER_EMAIL;
```

Minting also fails before creating a capability when the deployment has no
matching local owner account.

```ts
const noOwnerAuthDir = await mkdtemp(join(tmpdir(), "cb-admin-no-owner-"));
process.env.CB_AUTH_FILE = join(noOwnerAuthDir, "auth.json");
process.env.CB_OWNER_EMAIL = "owner@example.com";
const noOwnerBox = await makeTmpBox({ git: true });
const noOwnerResult = await caller(noOwnerBox.root).admin.createInvite({}).then(
  () => "allowed",
  (error) => error.code,
);
noOwnerResult
=> PRECONDITION_FAILED
```

```ts cleanup
await noOwnerBox.cleanup();
await rm(noOwnerAuthDir, { recursive: true, force: true });
delete process.env.CB_AUTH_FILE;
delete process.env.CB_OWNER_EMAIL;
```

## updateBoxConfig writes googleServices and commits

```ts
const box = await makeTmpBox({ git: true });
const res = await caller(box.root).admin.updateBoxConfig({ googleServices: { calendar: true, gmail: false } });
print(`ok: ${res.success}`);
print(`services: ${JSON.stringify(res.googleServices)}`);
// The change was committed (a new commit exists on top of the box's initial one).
const subject = (await simpleGit(box.root).log({ maxCount: 1 })).latest.message;
print(`commit: ${subject}`);
=>
ok: true
services: {"calendar":true,"gmail":false}
commit: Update box config: googleServices
```

## boxConfig round-trips googleServices and exposes ownerEmail

```ts continue
const cfg = await caller(box.root).admin.boxConfig();
print(`services: ${JSON.stringify(cfg.googleServices)}`);
print(`hasOwnerEmailField: ${"ownerEmail" in cfg}`);
=>
services: {"calendar":true,"gmail":false}
hasOwnerEmailField: true
```

## updateBoxConfig still accepts allowedEmails and filters non-emails

```ts continue
const res2 = await caller(box.root).admin.updateBoxConfig({
  allowedEmails: [" A@Example.COM ", "a@example.com", "not-an-email"],
});
print(JSON.stringify(res2.allowedEmails));
=>
["a@example.com"]
```

Only allowed local members are exposed as password-reset targets. The owner and
allowed addresses without a local account are excluded.

```ts continue
const memberAuthDir = await mkdtemp(join(tmpdir(), "cb-admin-members-"));
process.env.CB_AUTH_FILE = join(memberAuthDir, "auth.json");
process.env.CB_AUTH_SCRYPT_N = "1024";
await createFirstUser({ email: "owner@example.com", name: "Owner", password: "owner-password" });
await addUser({ email: "member@example.com", name: "Member", password: "member-password", role: "member" });
await caller(box.root).admin.updateBoxConfig({
  allowedEmails: ["member@example.com", "invited@example.com", "owner@example.com"],
});
const memberConfig = await caller(box.root).admin.boxConfig();
JSON.stringify(memberConfig.passwordResetEligibleEmails)
=> ["member@example.com"]
```

The owner can mint a reset only for that eligible member; the returned link is
root-auth-relative and never contains the email address.

```ts continue
const reset = await caller(box.root).admin.createPasswordReset({ email: " MEMBER@EXAMPLE.COM " });
JSON.stringify({
  path: reset.resetPath.startsWith("/auth/reset-password?token="),
  leaksEmail: reset.resetPath.includes("member@example.com"),
  future: reset.expiresAt > Date.now(),
})
=> {"path":true,"leaksEmail":false,"future":true}

await caller(box.root).admin.createPasswordReset({ email: "invited@example.com" }).then(
  () => "allowed",
  (error) => error.code,
)
=> NOT_FOUND
```

```ts cleanup
await rm(memberAuthDir, { recursive: true, force: true });
delete process.env.CB_AUTH_FILE;
delete process.env.CB_AUTH_SCRYPT_N;
```

## empty input is rejected

```ts continue
const err = await caller(box.root).admin.updateBoxConfig({}).then(() => "none", (e) => e.code);
print(err);
=>
BAD_REQUEST
```

## A Git failure does not falsely report that the saved config rolled back

```ts
const noGitBox = await makeTmpBox();
const originalConsoleError = console.error;
const commitErrors = [];
console.error = (...args) => commitErrors.push(args);
const degraded = await caller(noGitBox.root).admin.updateBoxConfig({
  allowedEmails: ["member@example.com"],
});
console.error = originalConsoleError;
const savedWithoutGit = JSON.parse(await noGitBox.read("config/box.json"));
JSON.stringify({
  success: degraded.success,
  warning: degraded.commitWarning,
  saved: savedWithoutGit.allowedEmails,
  logged: commitErrors.length,
})
=> {"success":true,"warning":"Saved, but the Git commit failed.","saved":["member@example.com"],"logged":1}
```

```ts cleanup
await noGitBox.cleanup();
```
