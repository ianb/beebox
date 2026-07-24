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

// The bare login/setup pages submit an `application/x-www-form-urlencoded` form
// instead of JSON — the handler detects the content-type and answers with a 302
// redirect rather than a JSON body.
function postForm(url, fields) {
  return server.server.inject({
    method: "POST",
    url,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams(fields).toString(),
  });
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

## A form login redirects (302) to the sanitized returnTo and sets the cookie

```ts
await resetAuth();
await createFirstUser({ email: "owner@example.com", name: "Owner", password: "correct-horse-battery" });

const ok = await postForm("/auth/login", {
  email: "owner@example.com",
  password: "correct-horse-battery",
  returnTo: "/test/home",
});
JSON.stringify({ status: ok.statusCode, location: ok.headers.location, cookie: ok.cookies.map((c) => c.name).join(",") })
=> {"status":302,"location":"/test/home","cookie":"cb_session"}

// A malicious returnTo (protocol-relative escape) collapses to "/" — never off-origin.
loginThrottle.reset();
const evil = await postForm("/auth/login", {
  email: "owner@example.com",
  password: "correct-horse-battery",
  returnTo: "//evil.com/x",
});
evil.headers.location
=> /
```

## A failed form login redirects back to the bare page with a generic error, no cookie

```ts
await resetAuth();
await createFirstUser({ email: "owner@example.com", name: "Owner", password: "correct-horse-battery" });

const bad = await postForm("/auth/login", { email: "owner@example.com", password: "wrong", returnTo: "/test/home" });
JSON.stringify({ status: bad.statusCode, location: bad.headers.location, cookies: bad.cookies.length })
=> {"status":302,"location":"/auth/login?returnTo=%2Ftest%2Fhome&error=1","cookies":0}
```

## A form setup creates the owner, redirects to the root, and sets the cookie

```ts
await resetAuth();
const token = armSetupToken({ now: Date.now() });

const setup = await postForm("/auth/setup", {
  email: "boss@example.com",
  name: "Boss",
  password: "hunter2hunter2",
  confirmPassword: "hunter2hunter2",
  token,
});
JSON.stringify({ status: setup.statusCode, location: setup.headers.location, cookie: setup.cookies.map((c) => c.name).join(",") })
=> {"status":302,"location":"/","cookie":"cb_session"}
```

## A form setup with mismatched passwords redirects back with error=mismatch, no account created

```ts
await resetAuth();
const mismatchToken = armSetupToken({ now: Date.now() });

const mm = await postForm("/auth/setup", {
  email: "boss@example.com",
  name: "Boss",
  password: "hunter2hunter2",
  confirmPassword: "different-pw-123",
  token: mismatchToken,
});
print(`status: ${mm.statusCode}`);
print(`error=mismatch: ${mm.headers.location.includes("error=mismatch")}`);
print(`no cookie: ${mm.cookies.length === 0}`);
print(`no owner created: ${getLocalOwnerEmail() === null}`);
"done"
=>
status: 302
error=mismatch: true
no cookie: true
no owner created: true
done
```

## A decoy content-type whose essence is JSON takes the JSON path (no form double-read)

`isFormRequest` compares the exact MIME essence, not a substring — so
`application/json; x=application/x-www-form-urlencoded` (which Fastify parses as
JSON, consuming the stream) is treated as JSON. Were it substring-matched, the
form path would call `readFormBody` on the drained stream and hang to the 10s
timeout, breaking the "JSON callers unchanged" guarantee.

```ts
await resetAuth();
await createFirstUser({ email: "owner@example.com", name: "Owner", password: "correct-horse-battery" });
loginThrottle.reset();

const decoy = await server.server.inject({
  method: "POST",
  url: "/auth/login",
  headers: { "content-type": "application/json; x=application/x-www-form-urlencoded" },
  payload: JSON.stringify({ email: "owner@example.com", password: "wrong" }),
});
// A JSON 401 (not a 302 redirect) proves the JSON path was taken.
JSON.stringify({ status: decoy.statusCode, body: decoy.json() })
=> {"status":401,"body":{"error":"Invalid credentials"}}
```

```ts cleanup
await server.cleanup();
await rm(authDir, { recursive: true, force: true });
delete process.env.CB_AUTH_FILE;
delete process.env.CB_AUTH_SCRYPT_N;
```
