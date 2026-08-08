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
import { mintAuthInvite } from "../../src/webapp/auth-capabilities.js";
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
  boxRoot: `${ctx.boxRoot}/`,
  createdBy: "owner@example.com",
  email: "Member@Example.COM",
});

const page = await ctx.server.inject({ method: "GET", url: `/auth/invite?token=${minted.token}` });
JSON.stringify({ status: page.statusCode, noStore: page.headers["cache-control"], referrer: page.headers["referrer-policy"], pinned: page.payload.includes("member@example.com") })
=> {"status":200,"noStore":"no-store","referrer":"no-referrer","pinned":true}
```

Wrong content types are rejected immediately, before reading or throttling the
public form body.

```ts continue
const wrongType = await ctx.server.inject({
  method: "POST",
  url: "/auth/invite",
  headers: { "content-type": "application/json" },
  payload: { token: minted.token },
});
wrongType.statusCode
=> 400
```

A confirmation typo preserves the live token and pinned identity, so correcting
the form can still accept the same invitation.

```ts continue
const mismatch = await ctx.server.inject(inviteForm({
  token: minted.token,
  name: "Member",
  password: "member-password",
  confirmPassword: "member-typo",
}));
JSON.stringify({ status: mismatch.statusCode, token: mismatch.payload.includes(`value="${minted.token}"`), pinned: mismatch.payload.includes("member@example.com") })
=> {"status":400,"token":true,"pinned":true}
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
const originalReplayWarn = console.warn;
const replayWarnings = [];
console.warn = (...args) => replayWarnings.push(args);
const replay = await ctx.server.inject(inviteForm({
  token: minted.token,
  name: "Again",
  password: "member-password",
  confirmPassword: "member-password",
}));
console.warn = originalReplayWarn;
JSON.stringify({ status: replay.statusCode, category: String(replayWarnings[0]?.[0]).includes("dead-token") })
=> {"status":410,"category":true}
```

Malformed open-invite email input does not consume the bearer capability.

```ts continue
loginThrottle.reset();
const retryableInvite = await mintAuthInvite({ boxRoot: ctx.boxRoot, createdBy: "owner@example.com" });
const badEmail = await ctx.server.inject(inviteForm({
  token: retryableInvite.token,
  email: "",
  name: "Retryable",
  password: "member-password",
  confirmPassword: "member-password",
}));
const retried = await ctx.server.inject(inviteForm({
  token: retryableInvite.token,
  email: "retryable@example.com",
  name: "Retryable",
  password: "member-password",
  confirmPassword: "member-password",
}));
JSON.stringify({ bad: badEmail.statusCode, retried: retried.statusCode, cookie: typeof retried.headers["set-cookie"] === "string" })
=> {"bad":400,"retried":302,"cookie":true}
```

Credential-store failures during account creation are sanitized and fail
closed without leaking the store path or burning through Fastify's default
error response.

```ts continue
const authFailureInvite = await mintAuthInvite({ boxRoot: ctx.boxRoot, createdBy: "owner@example.com" });
await writeFile(process.env.CB_AUTH_FILE, "not json", { mode: 0o600 });
loginThrottle.reset();
const originalConsoleError = console.error;
const acceptanceErrors = [];
console.error = (...args) => acceptanceErrors.push(args);
const corruptAuth = await ctx.server.inject(inviteForm({
  token: authFailureInvite.token,
  email: "second@example.com",
  name: "Second",
  password: "member-password",
  confirmPassword: "member-password",
}));
console.error = originalConsoleError;
JSON.stringify({
  status: corruptAuth.statusCode,
  leaksPath: corruptAuth.payload.includes(process.env.CB_AUTH_FILE),
  leaksCorruption: corruptAuth.payload.includes("corrupt"),
  logged: acceptanceErrors.length,
})
=> {"status":503,"leaksPath":false,"leaksCorruption":false,"logged":1}
```

A corrupt capability store fails closed with an unavailable response rather
than exposing a generic server error or treating the token as valid.

```ts continue
await writeFile(`${process.env.CB_AUTH_FILE}.invites.json`, "not json", { mode: 0o600 });
const corruptStore = await ctx.server.inject({ method: "GET", url: `/auth/invite?token=${minted.token}` });
corruptStore.statusCode
=> 503
```

```ts continue
loginThrottle.reset();
const corruptPost = await ctx.server.inject(inviteForm({
  token: minted.token,
  name: "Member",
  password: "member-password",
  confirmPassword: "member-password",
}));
JSON.stringify({
  status: corruptPost.statusCode,
  leaksPath: corruptPost.payload.includes(process.env.CB_AUTH_FILE),
  leaksCorruption: corruptPost.payload.includes("corrupt"),
})
=> {"status":503,"leaksPath":false,"leaksCorruption":false}
```

```ts cleanup
await ctx.cleanup();
await rm(authDir, { recursive: true, force: true });
delete process.env.CB_AUTH_FILE;
delete process.env.CB_OWNER_EMAIL;
loginThrottle.reset();
```

## A box-config failure leaves an explicit, signed-out partial account

```ts
const partialAuthDir = await mkdtemp(join(tmpdir(), "cb-invite-partial-"));
process.env.CB_AUTH_FILE = join(partialAuthDir, "auth.json");
process.env.CB_OWNER_EMAIL = "owner@example.com";
await createFirstUser({ email: "owner@example.com", name: "Owner", password: "owner-password" });
const partialCtx = await makeTestServer({ openAccess: false });
await partialCtx.seed("config/box.json", "not json");
const partialInvite = await mintAuthInvite({
  boxRoot: partialCtx.boxRoot,
  createdBy: "owner@example.com",
  email: "partial@example.com",
});
const originalPartialError = console.error;
const partialErrors = [];
console.error = (...args) => partialErrors.push(args);
const partial = await partialCtx.server.inject(inviteForm({
  token: partialInvite.token,
  name: "Partial",
  password: "partial-password",
  confirmPassword: "partial-password",
}));
console.error = originalPartialError;
JSON.stringify({
  status: partial.statusCode,
  namesEmail: partial.payload.includes("partial@example.com"),
  cookie: partial.headers["set-cookie"] ?? null,
  account: listUsers().some((user) => user.email === "partial@example.com"),
  logged: partialErrors.length,
})
=> {"status":503,"namesEmail":true,"cookie":null,"account":true,"logged":1}
```

```ts cleanup
await partialCtx.cleanup();
await rm(partialAuthDir, { recursive: true, force: true });
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

const originalCollisionWarn = console.warn;
const collisionWarnings = [];
console.warn = (...args) => collisionWarnings.push(args);
const ownerClaim = await ctx2.server.inject(inviteForm({
  token: openOwner.token,
  email: " OWNER@EXAMPLE.COM ",
  name: "Not owner",
  password: "attacker-password",
  confirmPassword: "attacker-password",
}));
console.warn = originalCollisionWarn;
JSON.stringify({ status: ownerClaim.statusCode, logged: collisionWarnings.length, category: String(collisionWarnings[0]?.[0]).includes("collision"), leakedToken: collisionWarnings.some((args) => args.some((value) => String(value).includes(openOwner.token))) })
=> {"status":410,"logged":1,"category":true,"leakedToken":false}
```

The collision burns the capability, so it cannot be reused to probe another
address or claim a valid one.

```ts continue
loginThrottle.reset();
const originalReuseWarn = console.warn;
console.warn = () => {};
const reuseAfterCollision = await ctx2.server.inject(inviteForm({
  token: openOwner.token,
  email: "new-member@example.com",
  name: "Not owner",
  password: "attacker-password",
  confirmPassword: "attacker-password",
}));
console.warn = originalReuseWarn;
reuseAfterCollision.statusCode
=> 410
```

A separate capability rejects an already-authorized identity with the same
dead-link response and is likewise consumed.

```ts continue
loginThrottle.reset();
const openAllowlisted = await mintAuthInvite({ boxRoot: ctx2.boxRoot, createdBy: "owner@example.com" });
const originalAllowlistedWarn = console.warn;
console.warn = () => {};
const allowlistedClaim = await ctx2.server.inject(inviteForm({
  token: openAllowlisted.token,
  email: "googleonly@example.com",
  name: "Not Google user",
  password: "attacker-password",
  confirmPassword: "attacker-password",
}));
console.warn = originalAllowlistedWarn;
allowlistedClaim.statusCode
=> 410

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
