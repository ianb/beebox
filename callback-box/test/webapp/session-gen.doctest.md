# Session revocation via the `gen` claim (Track D)

HMAC session cookies carry no server-side store, so they'd be irrevocable —
changing a leaked password couldn't end the leak. Track D embeds the local
record's session generation (`gen`) in the signed cookie and has
`resolveRequestIdentity` (`src/webapp/auth.ts`) reject a cookie whose `gen`
doesn't match the file. The rule set (one consistent one, per the plan):

- a local record exists → the cookie MUST carry `gen === record.gen`; absent or
  stale → unauthenticated;
- no record, but the cookie carries a `gen` → dead (its record vanished — this
  is how removing a local user revokes its sessions);
- no record, no `gen` → valid (a Google-only identity);
- a corrupt/unreadable auth store → the distinct `source: "unavailable"` outcome
  (→ 503), never "no record" (which would fail OPEN for revoked sessions).

These are fast pure checks against a tmp `CB_AUTH_FILE`, plus one route-tier
assertion that the corrupt-store outcome answers `503`, not `401`.

```ts setup
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { makeTestServer } from "../helpers/doctest-server.js";
import { signSession, verifySession, resolveRequestIdentity, COOKIE_NAME } from "../../src/webapp/auth.js";
import { createFirstUser, addUser, setPassword, removeUser } from "../../src/webapp/local-users.js";
import { resetLocalUserCache } from "../../src/webapp/local-users-cache.js";

// Fast scrypt (test-only work-factor seam); exercise REAL auth (undo the test
// helper's blanket open-mode opt-out and any configured owner email).
process.env.CB_AUTH_SCRYPT_N = "1024";
delete process.env.CB_ALLOW_UNAUTHENTICATED;
delete process.env.CB_HUB_SECRET;
delete process.env.CB_OWNER_EMAIL;
process.env.CB_SESSION_SECRET = "test-session-secret-for-session-gen-doctest";

const authDir = await mkdtemp(path.join(os.tmpdir(), "cb-session-gen-"));
const AUTH_FILE = path.join(authDir, "auth.json");
process.env.CB_AUTH_FILE = AUTH_FILE;

// A minimal request carrying just the session cookie (the shape the resolver reads).
function reqWithCookie(cookieValue) {
  return { headers: {}, cookies: cookieValue ? { [COOKIE_NAME]: cookieValue } : {} };
}
```

## Login mints a `gen`-bearing cookie for an email with a local record

```ts
await createFirstUser({ email: "owner@example.com", name: "Owner", password: "pw-correct-1" });
resetLocalUserCache();

const cookie1 = signSession({ email: "owner@example.com", name: "Owner" });
// The signed payload carries the record's current generation (1).
JSON.stringify(verifySession(cookie1))
=> {"email":"owner@example.com","name":"Owner","gen":1}

JSON.stringify(resolveRequestIdentity(reqWithCookie(cookie1)))
=> {"email":"owner@example.com","name":"Owner","source":"cookie"}
```

## A cookie with a malformed signature returns null instead of throwing (FIX 7)

`crypto.timingSafeEqual` THROWS on unequal-length buffers, so `verifySession`
must length-check the decoded signature before comparing — otherwise a cookie
like `cb_session=e30.x` (valid base64url payload, 1-char signature) becomes a
logged 500 instead of a clean "no session."

```ts continue
// `e30` is base64url for `{}`; `x` is a 1-char signature (32 bytes expected).
JSON.stringify(verifySession("e30.x"))
=> null

// A signature of the right hex form but wrong length is also just invalid.
JSON.stringify(verifySession("e30.abcd"))
=> null
```

## Changing the password bumps `gen`, so the old cookie is unauthenticated

```ts continue
await setPassword({ email: "owner@example.com", password: "pw-correct-2" });
resetLocalUserCache();

// The pre-change cookie still carries gen 1; the record is now gen 2 → revoked.
JSON.stringify(resolveRequestIdentity(reqWithCookie(cookie1)))
=> {"email":null,"name":null,"source":null}

// A freshly minted cookie carries gen 2 and authenticates.
const cookie2 = signSession({ email: "owner@example.com", name: "Owner" });
JSON.stringify(resolveRequestIdentity(reqWithCookie(cookie2)))
=> {"email":"owner@example.com","name":"Owner","source":"cookie"}
```

## Removing a local user makes its outstanding cookie unauthenticated

```ts continue
await addUser({ email: "member@example.com", name: "Member", password: "pw-member-1", role: "member" });
resetLocalUserCache();

const memberCookie = signSession({ email: "member@example.com", name: "Member" });
JSON.stringify(resolveRequestIdentity(reqWithCookie(memberCookie)))
=> {"email":"member@example.com","name":"Member","source":"cookie"}

await removeUser({ email: "member@example.com" });
resetLocalUserCache();
// Record gone, but the cookie still carries a gen → dead (removal revokes it).
JSON.stringify(resolveRequestIdentity(reqWithCookie(memberCookie)))
=> {"email":null,"name":null,"source":null}
```

## A Google-only email (no record) with a `gen`-less cookie stays valid

```ts continue
const googleCookie = signSession({ email: "google@example.com", name: "Google Person", picture: "https://example.com/p.png" });
// No local record for this email, so no gen is stamped.
JSON.stringify(verifySession(googleCookie))
=> {"email":"google@example.com","name":"Google Person","picture":"https://example.com/p.png"}

resetLocalUserCache();
JSON.stringify(resolveRequestIdentity(reqWithCookie(googleCookie)))
=> {"email":"google@example.com","name":"Google Person","source":"cookie"}
```

## Creating a record for a previously-`gen`-less email invalidates the old cookie

```ts continue
await addUser({ email: "google@example.com", name: "Google Person", password: "pw-google-1", role: "member" });
resetLocalUserCache();
// The old gen-less cookie predates the record; now a record exists and the
// cookie carries no gen → mismatch → dead (one re-login required, intended).
JSON.stringify(resolveRequestIdentity(reqWithCookie(googleCookie)))
=> {"email":null,"name":null,"source":null}
```

## A corrupt auth file yields the distinct `unavailable` outcome — not a plain 401

```ts continue
await writeFile(AUTH_FILE, "{ this is not valid json");
resetLocalUserCache();

const corruptIdentity = resolveRequestIdentity(reqWithCookie(cookie2));
// Distinct fail-closed outcome (→ 503), NOT source:null (which is the 401 case)
// and NOT a fall-through to "no record" (which would fail OPEN for revoked sessions).
corruptIdentity.source
=> unavailable

corruptIdentity.source === null
=> false
```

At the request boundary that outcome answers `503`, not `401`: `GET /auth/me`
with a signature-valid cookie against the corrupt store returns 503.

```ts continue
const server = await makeTestServer();
const me = await server.rootRequest({
  method: "GET",
  url: "/auth/me",
  headers: { cookie: `${COOKIE_NAME}=${cookie2}` },
});
me.statusCode
=> 503

await server.cleanup();
```

```ts cleanup
await rm(authDir, { recursive: true, force: true });
delete process.env.CB_AUTH_FILE;
delete process.env.CB_AUTH_SCRYPT_N;
delete process.env.CB_SESSION_SECRET;
```
