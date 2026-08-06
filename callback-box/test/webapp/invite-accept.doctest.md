# Invite acceptance routes

The root invite page is public because the short-lived token is its credential.
Acceptance creates one global member, grants one box, sets the normal session
cookie, and consumes the token exactly once.

```ts setup
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTestServer } from "../helpers/doctest-server.js";
import { createFirstUser, listUsers } from "../../src/webapp/local-users.js";
import { mintAuthInvite } from "../../src/webapp/auth-invites.js";
import { loginThrottle } from "../../src/webapp/login-throttle.js";

process.env.CB_AUTH_SCRYPT_N = "1024";
process.env.CB_SESSION_SECRET = "invite-route-test-secret";
delete process.env.CB_HUB_SECRET;

function inviteForm(fields) {
  return {
    method: "POST",
    url: "/auth/invite",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams(fields).toString(),
  };
}
```

## A pinned invite creates a member and grants only its target box

```ts
const authDir = await mkdtemp(join(tmpdir(), "cb-invite-route-"));
process.env.CB_AUTH_FILE = join(authDir, "auth.json");
process.env.CB_OWNER_EMAIL = "Owner@Example.COM";
await createFirstUser({ email: "owner@example.com", name: "Owner", password: "owner-password" });
const ctx = await makeTestServer({ openAccess: false });
const minted = await mintAuthInvite({
  boxRoot: ctx.boxRoot,
  createdBy: "owner@example.com",
  email: "Member@Example.COM",
});

const page = await ctx.server.inject({ method: "GET", url: `/auth/invite?token=${minted.token}` });
JSON.stringify({ status: page.statusCode, noStore: page.headers["cache-control"], referrer: page.headers["referrer-policy"], pinned: page.payload.includes("member@example.com") })
=> {"status":200,"noStore":"no-store","referrer":"no-referrer","pinned":true}
```

```ts continue
const accepted = await ctx.server.inject(inviteForm({
  token: minted.token,
  email: "attacker-change@example.com",
  name: "Member",
  password: "member-password",
  confirmPassword: "member-password",
}));
JSON.stringify({ status: accepted.statusCode, location: accepted.headers.location, cookie: typeof accepted.headers["set-cookie"] === "string" })
=> {"status":302,"location":"/test/","cookie":true}

listUsers().map((user) => `${user.email}:${user.role}`).join(",")
=> owner@example.com:owner,member@example.com:member

JSON.parse(await ctx.read("config/box.json")).allowedEmails.join(",")
=> member@example.com
```

Replay has the same dead-link response as an expired or unknown token.

```ts continue
const replay = await ctx.server.inject(inviteForm({
  token: minted.token,
  name: "Again",
  password: "member-password",
  confirmPassword: "member-password",
}));
replay.statusCode
=> 410
```

A corrupt capability store fails closed with an unavailable response rather
than exposing a generic server error or treating the token as valid.

```ts continue
await writeFile(`${process.env.CB_AUTH_FILE}.invites.json`, "not json", { mode: 0o600 });
const corruptStore = await ctx.server.inject({ method: "GET", url: `/auth/invite?token=${minted.token}` });
corruptStore.statusCode
=> 503
```

```ts cleanup
await ctx.cleanup();
await rm(authDir, { recursive: true, force: true });
delete process.env.CB_AUTH_FILE;
delete process.env.CB_OWNER_EMAIL;
loginThrottle.reset();
```

## Open invites cannot claim an owner or an already-authorized identity

```ts
const authDir2 = await mkdtemp(join(tmpdir(), "cb-invite-collision-"));
process.env.CB_AUTH_FILE = join(authDir2, "auth.json");
process.env.CB_OWNER_EMAIL = "owner@example.com";
await createFirstUser({ email: "owner@example.com", name: "Owner", password: "owner-password" });
const ctx2 = await makeTestServer({ openAccess: false });
await ctx2.seed("config/box.json", JSON.stringify({ allowedEmails: ["GoogleOnly@Example.COM"] }));
const openOwner = await mintAuthInvite({ boxRoot: ctx2.boxRoot, createdBy: "owner@example.com" });

const ownerClaim = await ctx2.server.inject(inviteForm({
  token: openOwner.token,
  email: " OWNER@EXAMPLE.COM ",
  name: "Not owner",
  password: "attacker-password",
  confirmPassword: "attacker-password",
}));
ownerClaim.statusCode
=> 400
```

The collision failure does not consume the capability, but another privileged
identity is rejected identically.

```ts continue
loginThrottle.reset();
const allowlistedClaim = await ctx2.server.inject(inviteForm({
  token: openOwner.token,
  email: "googleonly@example.com",
  name: "Not Google user",
  password: "attacker-password",
  confirmPassword: "attacker-password",
}));
allowlistedClaim.statusCode
=> 400

listUsers().length
=> 1
```

```ts cleanup
await ctx2.cleanup();
await rm(authDir2, { recursive: true, force: true });
delete process.env.CB_AUTH_FILE;
delete process.env.CB_OWNER_EMAIL;
delete process.env.CB_AUTH_SCRYPT_N;
delete process.env.CB_SESSION_SECRET;
loginThrottle.reset();
```
