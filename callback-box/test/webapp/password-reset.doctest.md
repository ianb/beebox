# Operator-issued member password reset

The public reset page is authenticated only by its short-lived capability. It
names the pinned email so the member can confirm the target account, does not
request an email, and GET inspection does not consume the link or mutate login
throttles.

```ts setup
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTestServer } from "../helpers/doctest-server.js";
import { addUser, createFirstUser, getLocalUser, verifyPassword } from "../../src/webapp/local-users.js";
import { mintAuthInvite, mintAuthPasswordReset } from "../../src/webapp/auth-capabilities.js";
import { loginThrottle } from "../../src/webapp/login-throttle.js";
import { passwordResetThrottle } from "../../src/webapp/routes/auth-password-reset.js";

process.env.CB_AUTH_SCRYPT_N = "1024";
process.env.CB_SESSION_SECRET = "password-reset-route-test-secret";
delete process.env.CB_HUB_SECRET;

function resetForm(fields) {
  return {
    method: "POST",
    url: "/auth/reset-password",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams(fields).toString(),
  };
}
```

## A live link resets the pinned member and returns to ordinary login

```ts
const authDir = await mkdtemp(join(tmpdir(), "cb-password-reset-route-"));
process.env.CB_AUTH_FILE = join(authDir, "auth.json");
process.env.CB_OWNER_EMAIL = "owner@example.com";
await createFirstUser({ email: "owner@example.com", name: "Owner", password: "owner-password" });
await addUser({ email: "member@example.com", name: "Member", password: "old-password", role: "member" });
const ctx = await makeTestServer({ openAccess: false });
await ctx.seed("config/box.json", JSON.stringify({ allowedEmails: ["member@example.com"] }));
const reset = await mintAuthPasswordReset({
  boxRoot: ctx.boxRoot,
  createdBy: "owner@example.com",
  email: "member@example.com",
});

const login = await ctx.server.inject({
  method: "POST",
  url: "/auth/login",
  payload: { email: "member@example.com", password: "old-password" },
});
const oldCookie = String(login.headers["set-cookie"]).split(";", 1)[0];
login.statusCode
=> 204

let page;
for (let index = 0; index < 12; index += 1) {
  page = await ctx.server.inject({ method: "GET", url: `/auth/reset-password?token=${reset.token}` });
}
const pageResult = {
  status: page.statusCode,
  noStore: page.headers["cache-control"],
  referrer: page.headers["referrer-policy"],
  namesEmail: page.payload.includes("member@example.com"),
};
JSON.stringify(pageResult)
=> {"status":200,"noStore":"no-store","referrer":"no-referrer","namesEmail":true}
```

Wrong content types and invite-kind capabilities cannot enter the reset flow.

```ts continue
const wrongType = await ctx.server.inject({ method: "POST", url: "/auth/reset-password", payload: {} });
const invite = await mintAuthInvite({ boxRoot: ctx.boxRoot, createdBy: "owner@example.com" });
const originalKindWarn = console.warn;
console.warn = () => {};
const wrongKind = await ctx.server.inject(resetForm({
  token: invite.token,
  password: "new-password",
  confirmPassword: "new-password",
}));
console.warn = originalKindWarn;
`${wrongType.statusCode},${wrongKind.statusCode}`
=> 400,410

passwordResetThrottle.reset();
```

A validation error keeps the live token, allowing the member to correct the
form without asking the operator for another link.

```ts continue
const mismatch = await ctx.server.inject(resetForm({
  token: reset.token,
  password: "new-password",
  confirmPassword: "new-password-typo",
}));
JSON.stringify({ status: mismatch.statusCode, token: mismatch.payload.includes(`value="${reset.token}"`) })
=> {"status":400,"token":true}
```

```ts continue
loginThrottle.acquireHashSlot()
=> true

loginThrottle.acquireHashSlot()
=> true

const atCapacity = await ctx.server.inject(resetForm({
  token: reset.token,
  password: "new-password",
  confirmPassword: "new-password",
}));
loginThrottle.releaseHashSlot();
loginThrottle.releaseHashSlot();
JSON.stringify({ status: atCapacity.statusCode, retained: atCapacity.payload.includes(`value="${reset.token}"`) })
=> {"status":429,"retained":true}
```

```ts continue
const beforeGen = getLocalUser("member@example.com").gen;
const acceptedRequest = resetForm({ token: reset.token, password: "new-password", confirmPassword: "new-password" });
acceptedRequest.headers["x-cb-base-prefix"] = "/worktree";
const accepted = await ctx.server.inject(acceptedRequest);
const acceptedResult = {
  status: accepted.statusCode,
  location: accepted.headers.location,
  cookie: accepted.headers["set-cookie"] ?? null,
  gen: `${beforeGen}->${getLocalUser("member@example.com").gen}`,
};
JSON.stringify(acceptedResult)
=> {"status":302,"location":"/worktree/auth/login?returnTo=%2Fworktree%2Ftest%2F&passwordReset=1","cookie":null,"gen":"1->2"}

const oldSession = await ctx.server.inject({
  method: "GET",
  url: "/auth/me",
  headers: { cookie: oldCookie },
});
oldSession.statusCode
=> 401

await verifyPassword({ email: "member@example.com", password: "old-password" })
=> null

(await verifyPassword({ email: "member@example.com", password: "new-password" }))?.email
=> member@example.com
```

The login page confirms the update without signing the member in, and replay is
the same generic dead-link response as any unknown token.

```ts continue
const loginPage = await ctx.server.inject({ method: "GET", url: "/auth/login?passwordReset=1" });
loginPage.payload.includes("Password reset. Sign in with your new password.")
=> true

const originalWarn = console.warn;
console.warn = () => {};
const replay = await ctx.server.inject(resetForm({
  token: reset.token,
  password: "another-password",
  confirmPassword: "another-password",
}));
console.warn = originalWarn;
replay.statusCode
=> 410
```

Reset-specific token/IP backoff rejects an immediate repeated dead-token POST
without coupling the attempt to ordinary login state.

```ts continue
passwordResetThrottle.reset();
const deadForm = resetForm({ token: "unknown-token", password: "new-password", confirmPassword: "new-password" });
console.warn = () => {};
const firstDead = await ctx.server.inject(deadForm);
const repeatedDead = await ctx.server.inject(deadForm);
console.warn = originalWarn;
JSON.stringify({ first: firstDead.statusCode, repeated: repeatedDead.statusCode })
=> {"first":410,"repeated":429}
```

```ts cleanup
await ctx.cleanup();
await rm(authDir, { recursive: true, force: true });
delete process.env.CB_AUTH_FILE;
delete process.env.CB_OWNER_EMAIL;
loginThrottle.reset();
passwordResetThrottle.reset();
```

## Access removal and store failures fail closed

```ts
const staleDir = await mkdtemp(join(tmpdir(), "cb-password-reset-stale-"));
process.env.CB_AUTH_FILE = join(staleDir, "auth.json");
process.env.CB_OWNER_EMAIL = "owner@example.com";
await createFirstUser({ email: "owner@example.com", name: "Owner", password: "owner-password" });
await addUser({ email: "member@example.com", name: "Member", password: "old-password", role: "member" });
const staleCtx = await makeTestServer({ openAccess: false });
await staleCtx.seed("config/box.json", JSON.stringify({ allowedEmails: [] }));
const staleReset = await mintAuthPasswordReset({
  boxRoot: staleCtx.boxRoot,
  createdBy: "owner@example.com",
  email: "member@example.com",
});
const stale = await staleCtx.server.inject({ method: "GET", url: `/auth/reset-password?token=${staleReset.token}` });
stale.statusCode
=> 410
```

```ts continue
await staleCtx.seed("config/box.json", JSON.stringify({ allowedEmails: ["member@example.com"] }));
const savedAuth = await readFile(process.env.CB_AUTH_FILE, "utf8");
await writeFile(process.env.CB_AUTH_FILE, "not json", { mode: 0o600 });
const credentialUnavailable = await staleCtx.server.inject({
  method: "GET",
  url: `/auth/reset-password?token=${staleReset.token}`,
});
await writeFile(process.env.CB_AUTH_FILE, savedAuth, { mode: 0o600 });
JSON.stringify({ status: credentialUnavailable.statusCode, html: credentialUnavailable.headers["content-type"] })
=> {"status":503,"html":"text/html"}
```

```ts continue
await writeFile(`${process.env.CB_AUTH_FILE}.invites.json`, "not json", { mode: 0o600 });
const unavailable = await staleCtx.server.inject({ method: "GET", url: `/auth/reset-password?token=${staleReset.token}` });
JSON.stringify({ status: unavailable.statusCode, leaksPath: unavailable.payload.includes(process.env.CB_AUTH_FILE) })
=> {"status":503,"leaksPath":false}
```

```ts cleanup
await staleCtx.cleanup();
await rm(staleDir, { recursive: true, force: true });
delete process.env.CB_AUTH_FILE;
delete process.env.CB_OWNER_EMAIL;
delete process.env.CB_AUTH_SCRYPT_N;
delete process.env.CB_SESSION_SECRET;
loginThrottle.reset();
passwordResetThrottle.reset();
```
