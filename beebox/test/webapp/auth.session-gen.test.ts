// # Session revocation via the `gen` claim (Track D)
//
// HMAC session cookies carry no server-side store, so they'd be irrevocable —
// changing a leaked password couldn't end the leak. Track D embeds the local
// record's session generation (`gen`) in the signed cookie and has
// `resolveRequestIdentity` (`src/webapp/auth.ts`) reject a cookie whose `gen`
// doesn't match the file. The rule set (one consistent one, per the plan):
//
// - a local record exists → the cookie MUST carry `gen === record.gen`; absent or
//   stale → unauthenticated;
// - no record, but the cookie carries a `gen` → dead (its record vanished — this
//   is how removing a local user revokes its sessions);
// - no record, no `gen` → valid (a Google-only identity);
// - a corrupt/unreadable auth store → the distinct `source: "unavailable"` outcome
//   (→ 503), never "no record" (which would fail OPEN for revoked sessions).
//
// These are fast pure checks against a tmp `BBX_AUTH_FILE`, plus one route-tier
// assertion that the corrupt-store outcome answers `503`, not `401`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { makeTestServer } from "../helpers/test-route-server.js";
import { signSession, verifySession, resolveRequestIdentity, COOKIE_NAME } from "../../src/webapp/auth.js";
import { createFirstUser, addUser, setPassword, removeUser } from "../../src/webapp/local-users.js";
import { resetLocalUserCache } from "../../src/webapp/local-users-cache.js";

// Fast scrypt (test-only work-factor seam); exercise REAL auth (clear any
// configured owner email / hub secret so the resolver takes its cookie path).
process.env.BBX_AUTH_SCRYPT_N = "1024";
delete process.env.BBX_HUB_SECRET;
delete process.env.BBX_OWNER_EMAIL;
process.env.BBX_SESSION_SECRET = "test-session-secret-for-session-gen-doctest";

const authDir = await mkdtemp(path.join(os.tmpdir(), "bbx-session-gen-"));
const AUTH_FILE = path.join(authDir, "auth.json");
process.env.BBX_AUTH_FILE = AUTH_FILE;

// `verifySession` returns `picture: undefined` as a present key, which its
// `picture?: string` type (exactOptionalPropertyTypes) cannot state in an
// expected value. This drops the key only when it is undefined.
function claimsOf(cookie: string) {
  const session = verifySession(cookie);
  if (session === null) return null;
  const { picture, ...rest } = session;
  return picture === undefined ? rest : { ...rest, picture };
}

// A minimal request carrying just the session cookie (the shape the resolver reads).
function reqWithCookie(cookieValue: string | undefined) {
  return { headers: {}, cookies: cookieValue ? { [COOKIE_NAME]: cookieValue } : {} };
}

// ## Session email is canonical across login methods
//
// New cookies canonicalize at signing, so password and Google identities use the
// same key even if the provider supplied mixed case and surrounding space.
void test("New cookies canonicalize at signing, so password and Google identities use th...", async (t) => {
  // doctest:L52
  const canonicalCookie = signSession({ email: " Person@Example.COM ", name: "Person" });
  t.check(claimsOf(canonicalCookie), { email: "person@example.com", name: "Person" });
});

// ## Login mints a `gen`-bearing cookie for an email with a local record
void test("Login mints a `gen`-bearing cookie for an email with a local record", async (t) => {
  t.teardown(async () => {
    try {
      await rm(authDir, { recursive: true, force: true });
      delete process.env.BBX_AUTH_FILE;
      delete process.env.BBX_AUTH_SCRYPT_N;
      delete process.env.BBX_SESSION_SECRET;
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L60
  await createFirstUser({ email: "owner@example.com", name: "Owner", password: "pw-correct-1" });
  resetLocalUserCache();

  // doctest:L63
  const cookie1 = signSession({ email: "owner@example.com", name: "Owner" });
  t.check(
    // The signed payload carries the record's current generation (1).
    claimsOf(cookie1),
    { email: "owner@example.com", name: "Owner", gen: 1 },
  );

  // doctest:L68
  t.check(resolveRequestIdentity(reqWithCookie(cookie1), { openAccess: false }), {
    email: "owner@example.com",
    name: "Owner",
    source: "cookie",
  });

  // ## A cookie with a malformed signature returns null instead of throwing (FIX 7)
  //
  // `crypto.timingSafeEqual` THROWS on unequal-length buffers, so `verifySession`
  // must length-check the decoded signature before comparing — otherwise a cookie
  // like `bbx_session=e30.x` (valid base64url payload, 1-char signature) becomes a
  // logged 500 instead of a clean "no session."

  // doctest:L80
  t.check(
    // `e30` is base64url for `{}`; `x` is a 1-char signature (32 bytes expected).
    verifySession("e30.x"),
    null,
  );

  // doctest:L84
  t.check(
    // A signature of the right hex form but wrong length is also just invalid.
    verifySession("e30.abcd"),
    null,
  );

  // ## Changing the password bumps `gen`, so the old cookie is unauthenticated

  // doctest:L92
  await setPassword({ email: "owner@example.com", password: "pw-correct-2" });
  resetLocalUserCache();

  // doctest:L95
  t.check(
    // The pre-change cookie still carries gen 1; the record is now gen 2 → revoked.
    resolveRequestIdentity(reqWithCookie(cookie1), { openAccess: false }),
    { email: null, name: null, source: null },
  );

  // doctest:L99
  // A freshly minted cookie carries gen 2 and authenticates.
  const cookie2 = signSession({ email: "owner@example.com", name: "Owner" });
  t.check(resolveRequestIdentity(reqWithCookie(cookie2), { openAccess: false }), {
    email: "owner@example.com",
    name: "Owner",
    source: "cookie",
  });

  // ## Removing a local user makes its outstanding cookie unauthenticated

  // doctest:L108
  await addUser({ email: "member@example.com", name: "Member", password: "pw-member-1", role: "member" });
  resetLocalUserCache();

  // doctest:L111
  const memberCookie = signSession({ email: "member@example.com", name: "Member" });
  t.check(resolveRequestIdentity(reqWithCookie(memberCookie), { openAccess: false }), {
    email: "member@example.com",
    name: "Member",
    source: "cookie",
  });

  // doctest:L115
  await removeUser({ email: "member@example.com" });
  resetLocalUserCache();
  t.check(
    // Record gone, but the cookie still carries a gen → dead (removal revokes it).
    resolveRequestIdentity(reqWithCookie(memberCookie), { openAccess: false }),
    { email: null, name: null, source: null },
  );

  // ## A Google-only email (no record) with a `gen`-less cookie stays valid

  // doctest:L125
  const googleCookie = signSession({ email: "google@example.com", name: "Google Person", picture: "https://example.com/p.png" });
  t.check(
    // No local record for this email, so no gen is stamped.
    verifySession(googleCookie),
    { email: "google@example.com", name: "Google Person", picture: "https://example.com/p.png" },
  );

  // doctest:L130
  resetLocalUserCache();
  t.check(resolveRequestIdentity(reqWithCookie(googleCookie), { openAccess: false }), {
    email: "google@example.com",
    name: "Google Person",
    source: "cookie",
  });

  // ## Creating a record for a previously-`gen`-less email invalidates the old cookie

  // doctest:L138
  await addUser({ email: "google@example.com", name: "Google Person", password: "pw-google-1", role: "member" });
  resetLocalUserCache();
  t.check(
    // The old gen-less cookie predates the record; now a record exists and the
    // cookie carries no gen → mismatch → dead (one re-login required, intended).
    resolveRequestIdentity(reqWithCookie(googleCookie), { openAccess: false }),
    { email: null, name: null, source: null },
  );

  // ## A corrupt auth file yields the distinct `unavailable` outcome — not a plain 401

  // doctest:L149
  await writeFile(AUTH_FILE, "{ this is not valid json");
  resetLocalUserCache();

  // doctest:L152
  const corruptIdentity = resolveRequestIdentity(reqWithCookie(cookie2), { openAccess: false });
  t.check(
    // Distinct fail-closed outcome (→ 503), NOT source:null (which is the 401 case)
    // and NOT a fall-through to "no record" (which would fail OPEN for revoked sessions).
    corruptIdentity,
    { email: null, name: null, source: "unavailable" },
  );

  // At the request boundary that outcome answers `503`, not `401`: `GET /auth/me`
  // with a signature-valid cookie against the corrupt store returns 503.

  // doctest:L166
  const server = await makeTestServer({ openAccess: false });
  const me = await server.rootRequest({
    method: "GET",
    url: "/auth/me",
    headers: { cookie: `${COOKIE_NAME}=${cookie2}` },
  });
  t.check(me, { statusCode: 503, body: { error: "Authentication temporarily unavailable" } });

  // doctest:L175
  await server.cleanup();
});
