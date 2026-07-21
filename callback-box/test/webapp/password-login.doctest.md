# Password login + first-run setup (route tier)

The local login surface (`src/webapp/routes/auth.ts`): `POST /auth/login` verifies
credentials and mints the session cookie; `POST /auth/setup` claims the owner
account with a live setup token. These are ROOT routes (not box-scoped), so the
doctest injects against the bare Fastify instance rather than the slug-prefixing
helpers. `CB_AUTH_SCRYPT_N` is lowered so scrypt is fast, and the server is
constructed with `openAccess: false` so real auth is exercised.

```ts setup
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { makeTestServer } from "../helpers/doctest-server.js";
import { armSetupToken, clearSetupToken } from "../../src/webapp/setup-token.js";
import { loginThrottle } from "../../src/webapp/login-throttle.js";
import { createFirstUser, getLocalOwnerEmail } from "../../src/webapp/local-users.js";

// Fast scrypt for the doctest (test-only work-factor seam).
process.env.CB_AUTH_SCRYPT_N = "1024";
// Exercise REAL auth: clear any configured owner email that would constrain the
// first account (the server itself is constructed with openAccess: false below).
delete process.env.CB_OWNER_EMAIL;

const authDir = await mkdtemp(path.join(os.tmpdir(), "cb-auth-login-"));
const AUTH_FILE = path.join(authDir, "auth.json");
process.env.CB_AUTH_FILE = AUTH_FILE;

const server = await makeTestServer({ openAccess: false });

// Root-level POST helper (JSON body). Returns the raw inject response so a 204
// (no body) is observable without trying to parse JSON.
function postAuth(url, body) {
  return server.server.inject({ method: "POST", url, payload: body });
}

// A clean slate for a section: no auth file, no token, no throttle history.
async function resetAuth() {
  await rm(AUTH_FILE, { force: true });
  clearSetupToken();
  loginThrottle.reset();
}
```

## A correct password sets the session cookie and returns 204

```ts
await resetAuth();
await createFirstUser({ email: "owner@example.com", name: "Owner", password: "correct-horse-battery" });

const ok = await postAuth("/auth/login", { email: "owner@example.com", password: "correct-horse-battery" });
ok.statusCode
=> 204

ok.cookies.map((c) => c.name).join(",")
=> cb_session
```

## Wrong password and unknown user both answer an identical 401 (no enumeration)

```ts
await resetAuth();
await createFirstUser({ email: "owner@example.com", name: "Owner", password: "correct-horse-battery" });

const wrongPass = await postAuth("/auth/login", { email: "owner@example.com", password: "wrong" });
JSON.stringify({ status: wrongPass.statusCode, body: wrongPass.json() })
=> {"status":401,"body":{"error":"Invalid credentials"}}

// Reset the throttle so the second attempt is judged on its own merits (the
// first failure would otherwise cool-down this IP).
loginThrottle.reset();
const unknownUser = await postAuth("/auth/login", { email: "ghost@example.com", password: "anything" });
JSON.stringify({ status: unknownUser.statusCode, body: unknownUser.json() })
=> {"status":401,"body":{"error":"Invalid credentials"}}

// Byte-for-byte identical responses.
JSON.stringify(wrongPass.json()) === JSON.stringify(unknownUser.json())
=> true

// A parsed-but-non-object body (array/null/etc.) is rejected FAST as a 400 —
// it must not fall through to the raw-stream reader (whose events already
// fired) and stall until the read timeout. Regression guard for the
// `request.body !== undefined` body-detect fix.
loginThrottle.reset();
const arrayBody = await server.server.inject({ method: "POST", url: "/auth/login", payload: [] });
arrayBody.statusCode
=> 400
```

## Setup happy path: a live token creates the owner and mints a session

```ts
await resetAuth();
const token = armSetupToken({ now: Date.now() });

const setupOk = await postAuth("/auth/setup", {
  email: "Boss@Example.com",
  name: "Boss",
  password: "hunter2hunter2",
  token,
});
setupOk.statusCode
=> 204

setupOk.cookies.map((c) => c.name).join(",")
=> cb_session

// The owner was persisted (email canonicalized to lowercase).
getLocalOwnerEmail()
=> boss@example.com
```

## Setup rejects a wrong token (403) and an expired one (410)

```ts
await resetAuth();
armSetupToken({ now: Date.now() });

const wrongToken = await postAuth("/auth/setup", {
  email: "boss@example.com",
  name: "Boss",
  password: "hunter2hunter2",
  token: "not-the-real-token",
});
JSON.stringify({ status: wrongToken.statusCode, error: wrongToken.json().error })
=> {"status":403,"error":"Invalid setup token"}

// A token armed 20 minutes ago is past its 15-minute TTL → 410 Gone.
loginThrottle.reset();
const staleToken = armSetupToken({ now: Date.now() - 20 * 60 * 1000 });
const expired = await postAuth("/auth/setup", {
  email: "boss@example.com",
  name: "Boss",
  password: "hunter2hunter2",
  token: staleToken,
});
expired.statusCode
=> 410
```

## Setup answers 410 once an account exists

```ts
await resetAuth();
await createFirstUser({ email: "owner@example.com", name: "Owner", password: "correct-horse-battery" });
const lateToken = armSetupToken({ now: Date.now() });

const claimed = await postAuth("/auth/setup", {
  email: "other@example.com",
  name: "Other",
  password: "password1234",
  token: lateToken,
});
claimed.statusCode
=> 410
```

## Two concurrent setups race on O_EXCL — one wins (204), one loses (409)

```ts
await resetAuth();
const raceToken = armSetupToken({ now: Date.now() });
const body = { email: "first@example.com", name: "First", password: "password1234", token: raceToken };

const [a, b] = await Promise.all([postAuth("/auth/setup", body), postAuth("/auth/setup", body)]);
[a.statusCode, b.statusCode].sort((x, y) => x - y).join(",")
=> 204,409
```

```ts cleanup
await server.cleanup();
await rm(authDir, { recursive: true, force: true });
delete process.env.CB_AUTH_FILE;
delete process.env.CB_AUTH_SCRYPT_N;
```
