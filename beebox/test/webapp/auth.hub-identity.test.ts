// # Hub-mode identity resolution (Track D, chunk D2)
//
// `resolveRequestIdentity` (`src/webapp/auth.ts`) is the ONE place both the
// box auth preHandler and the tRPC context creation ask "who is this
// request." In hub mode (`BBX_HUB_SECRET` set) it trusts ONLY the
// secret-gated hub headers — never the session cookie, even when one is
// present — because the cookie's signing secret is symmetric: a box that can
// verify a session could also forge one for a sibling box. These are pure
// unit tests against fake `FastifyRequest`-shaped objects — no server boot
// needed to exercise the header logic itself.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { resolveRequestIdentity, verifyHubSecret, isHubMode, signSession, COOKIE_NAME, type IdentityRequest } from "../../src/webapp/auth.js";

/** Minimal fake FastifyRequest: just enough of the shape resolveRequestIdentity/verifyHubSecret read. */
function fakeRequest({ headers, cookies }: Partial<IdentityRequest>): IdentityRequest {
  return { headers: headers ?? {}, cookies: cookies ?? {} };
}

const ORIGINAL_HUB_SECRET = process.env.BBX_HUB_SECRET;
const ORIGINAL_SESSION_SECRET = process.env.BBX_SESSION_SECRET;
const ORIGINAL_AUTH_FILE = process.env.BBX_AUTH_FILE;
process.env.BBX_SESSION_SECRET = "test-session-secret-for-hub-identity-doctest";
// Track D: signSession + the resolver now consult the local credential store, so
// pin BBX_AUTH_FILE at a nonexistent tmp path — none of these example emails have
// a record, keeping them gen-less (source "cookie"), independent of any real
// ~/.bbx-auth.json on the host.
process.env.BBX_AUTH_FILE = "/nonexistent/bbx-auth-hub-identity-doctest.json";

// ## Outside hub mode, headers are ignored entirely — the cookie is the only source
void test("Outside hub mode, headers are ignored entirely — the cookie is the only source", async (t) => {
  t.teardown(async () => {
    try {
      if (ORIGINAL_HUB_SECRET === undefined) delete process.env.BBX_HUB_SECRET;
      else process.env.BBX_HUB_SECRET = ORIGINAL_HUB_SECRET;
      if (ORIGINAL_SESSION_SECRET === undefined) delete process.env.BBX_SESSION_SECRET;
      else process.env.BBX_SESSION_SECRET = ORIGINAL_SESSION_SECRET;
      if (ORIGINAL_AUTH_FILE === undefined) delete process.env.BBX_AUTH_FILE;
      else process.env.BBX_AUTH_FILE = ORIGINAL_AUTH_FILE;
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L34
  delete process.env.BBX_HUB_SECRET;
  t.check(isHubMode(), false);

  // doctest:L38
  const spoofed = fakeRequest({
    headers: { "x-bbx-authenticated-email": "attacker@evil.com", "x-bbx-hub-secret": "whatever" },
  });
  t.check(resolveRequestIdentity(spoofed, { openAccess: false }), {
    email: null,
    name: null,
    source: null,
  });

  // doctest:L46
  const cookieValue = signSession({ email: "real@example.com", name: "Real User" });
  const withCookie = fakeRequest({ cookies: { [COOKIE_NAME]: cookieValue } });
  t.check(resolveRequestIdentity(withCookie, { openAccess: false }), {
    email: "real@example.com",
    name: "Real User",
    source: "cookie",
  });

  // ## In hub mode, a request without the secret header is unauthenticated — no cookie fallback

  // doctest:L55
  process.env.BBX_HUB_SECRET = "hub-secret-abc123";
  t.check(isHubMode(), true);

  // doctest:L59
  // Even carrying a perfectly valid session cookie AND a spoofed email header,
  // with no (or a wrong) secret, the request is treated as unauthenticated.
  // This is the core forgery-hole check: a hub-mode box must never fall back
  // to verifying the cookie itself.
  const cookieOnlyInHubMode = fakeRequest({ cookies: { [COOKIE_NAME]: cookieValue } });
  t.check(resolveRequestIdentity(cookieOnlyInHubMode, { openAccess: false }), {
    email: null,
    name: null,
    source: null,
  });

  // doctest:L67
  const wrongSecret = fakeRequest({
    headers: { "x-bbx-hub-secret": "not-the-secret", "x-bbx-authenticated-email": "someone@example.com" },
    cookies: { [COOKIE_NAME]: cookieValue },
  });
  t.check(verifyHubSecret(wrongSecret), false);

  // doctest:L74
  t.check(resolveRequestIdentity(wrongSecret, { openAccess: false }), {
    email: null,
    name: null,
    source: null,
  });

  // ## A valid secret + email header is honored as hub-sourced identity

  // doctest:L81
  const validHubRequest = fakeRequest({
    headers: { "x-bbx-hub-secret": "hub-secret-abc123", "x-bbx-authenticated-email": "person@example.com" },
  });
  t.check(verifyHubSecret(validHubRequest), true);

  // doctest:L87
  t.check(resolveRequestIdentity(validHubRequest, { openAccess: false }), {
    email: "person@example.com",
    name: "person@example.com",
    source: "hub",
  });

  // doctest:L90
  const mixedCaseHubRequest = fakeRequest({
    headers: { "x-bbx-hub-secret": "hub-secret-abc123", "x-bbx-authenticated-email": " Person@Example.COM " },
  });
  t.check(resolveRequestIdentity(mixedCaseHubRequest, { openAccess: false }), {
    email: "person@example.com",
    name: "person@example.com",
    source: "hub",
  });

  // ## A valid secret + no email header is unauthenticated UNLESS `x-bbx-hub-auth: off` is also set

  // doctest:L100
  const secretOnly = fakeRequest({ headers: { "x-bbx-hub-secret": "hub-secret-abc123" } });
  t.check(resolveRequestIdentity(secretOnly, { openAccess: false }), {
    email: null,
    name: null,
    source: null,
  });

  // doctest:L104
  const secretPlusOff = fakeRequest({
    headers: { "x-bbx-hub-secret": "hub-secret-abc123", "x-bbx-hub-auth": "off" },
  });
  t.check(resolveRequestIdentity(secretPlusOff, { openAccess: false }), {
    email: null,
    name: null,
    source: "open",
  });

  // ## No `BBX_HUB_SECRET` configured server-side means the secret header can never verify

  // doctest:L114
  delete process.env.BBX_HUB_SECRET;
  const noServerSecret = fakeRequest({
    headers: { "x-bbx-hub-secret": "anything", "x-bbx-authenticated-email": "someone@example.com" },
  });
  t.check(verifyHubSecret(noServerSecret), false);

  // ## Standalone open access: a cookieless request resolves to `source: "open"`
  //
  // Outside hub mode, when the box was constructed with `openAccess: true` and the
  // request carries no session cookie, the resolver returns `source: "open"` — the
  // single place standalone openness is decided, so the openness-recomputing call
  // sites can just read `identity.source`. With auth required (`openAccess: false`),
  // the same cookieless request is `source: null` (unauthenticated).

  // doctest:L131
  delete process.env.BBX_HUB_SECRET;
  const openStandalone = fakeRequest({});
  t.check(resolveRequestIdentity(openStandalone, { openAccess: true }), {
    email: null,
    name: null,
    source: "open",
  });

  // doctest:L136
  t.check(resolveRequestIdentity(openStandalone, { openAccess: false }), {
    email: null,
    name: null,
    source: null,
  });
});
