# Self-service password change

A signed-in local user must prove the current password. Success revokes every
old cookie through the generation counter and returns a fresh cookie in the same
response.

```ts setup
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTestServer } from "../helpers/doctest-server.js";
import { createFirstUser, verifyPassword } from "../../src/webapp/local-users.js";
import { signSession, COOKIE_NAME } from "../../src/webapp/auth.js";
import { loginThrottle } from "../../src/webapp/login-throttle.js";

process.env.CB_AUTH_SCRYPT_N = "1024";
process.env.CB_SESSION_SECRET = "password-change-test-secret";
delete process.env.CB_HUB_SECRET;

function cookieValue(header) {
  return String(header).split(";", 1)[0];
}
```

## Success renews this browser and revokes the old cookie

```ts
const authDir = await mkdtemp(join(tmpdir(), "cb-password-change-"));
process.env.CB_AUTH_FILE = join(authDir, "auth.json");
process.env.CB_OWNER_EMAIL = "owner@example.com";
await createFirstUser({ email: "owner@example.com", name: "Owner", password: "old-password" });
const ctx = await makeTestServer({ openAccess: false });

const login = await ctx.server.inject({
  method: "POST",
  url: "/auth/login",
  payload: { email: "OWNER@EXAMPLE.COM", password: "old-password" },
});
const oldCookie = cookieValue(login.headers["set-cookie"]);
login.statusCode
=> 204
```

```ts continue
const changed = await ctx.server.inject({
  method: "POST",
  url: "/auth/password",
  headers: { cookie: oldCookie },
  payload: {
    currentPassword: "old-password",
    newPassword: "new-password",
    confirmPassword: "new-password",
  },
});
const newCookie = cookieValue(changed.headers["set-cookie"]);
JSON.stringify({ status: changed.statusCode, renewed: newCookie !== oldCookie })
=> {"status":204,"renewed":true}
```

```ts continue
const oldMe = await ctx.server.inject({ method: "GET", url: "/auth/me", headers: { cookie: oldCookie } });
const newMe = await ctx.server.inject({ method: "GET", url: "/auth/me", headers: { cookie: newCookie } });
JSON.stringify({ oldStatus: oldMe.statusCode, newStatus: newMe.statusCode, hasPassword: newMe.json().hasPassword })
=> {"oldStatus":401,"newStatus":200,"hasPassword":true}
```

The old password no longer verifies; the new one does.

```ts continue
loginThrottle.reset();
const oldVerified = await verifyPassword({ email: "owner@example.com", password: "old-password" });
const newVerified = await verifyPassword({ email: "owner@example.com", password: "new-password" });
`${oldVerified === null},${newVerified?.email}`
=> true,owner@example.com
```

## Wrong proof and Google-only identities share the public failure

```ts continue
loginThrottle.reset();
const wrong = await ctx.server.inject({
  method: "POST",
  url: "/auth/password",
  headers: { cookie: newCookie },
  payload: { currentPassword: "wrong", newPassword: "another-password", confirmPassword: "another-password" },
});
wrong.statusCode
=> 401

loginThrottle.reset();
const googleCookie = `${COOKIE_NAME}=${signSession({ email: "google@example.com", name: "Google" })}`;
const googleOnly = await ctx.server.inject({
  method: "POST",
  url: "/auth/password",
  headers: { cookie: googleCookie },
  payload: { currentPassword: "anything", newPassword: "another-password", confirmPassword: "another-password" },
});
googleOnly.statusCode
=> 401
```

Malformed input and a caller without a human cookie never mutate credentials.

```ts continue
const mismatch = await ctx.server.inject({
  method: "POST",
  url: "/auth/password",
  headers: { cookie: newCookie },
  payload: { currentPassword: "new-password", newPassword: "another-password", confirmPassword: "different-password" },
});
const anonymous = await ctx.server.inject({
  method: "POST",
  url: "/auth/password",
  payload: { currentPassword: "new-password", newPassword: "another-password", confirmPassword: "another-password" },
});
`${mismatch.statusCode},${anonymous.statusCode}`
=> 400,401
```

```ts cleanup
await ctx.cleanup();
await rm(authDir, { recursive: true, force: true });
delete process.env.CB_AUTH_FILE;
delete process.env.CB_OWNER_EMAIL;
delete process.env.CB_AUTH_SCRYPT_N;
delete process.env.CB_SESSION_SECRET;
loginThrottle.reset();
```
