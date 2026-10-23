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
import { resolveRequestIdentity, verifyHubSecret, signSession, COOKIE_NAME, type IdentityRequest } from "../../src/webapp/auth.js";

/** Minimal fake FastifyRequest: just enough of the shape resolveRequestIdentity/verifyHubSecret read. */
function fakeRequest({ headers, cookies }: Partial<IdentityRequest>): IdentityRequest {
  return { headers: headers ?? {}, cookies: cookies ?? {} };
}

const ORIGINAL_HUB_SECRET = process.env.BBX_HUB_SECRET;
const ORIGINAL_SESSION_SECRET = process.env.BBX_SESSION_SECRET;
const ORIGINAL_AUTH_FILE = process.env.BBX_AUTH_FILE;
process.env.BBX_SESSION_SECRET = "test-session-secret-for-hub-identity-test";
// Track D: signSession + the resolver now consult the local credential store, so
// pin BBX_AUTH_FILE at a nonexistent tmp path — none of these example emails have
// a record, keeping them gen-less (source "cookie"), independent of any real
// ~/.bbx-auth.json on the host.
process.env.BBX_AUTH_FILE = "/nonexistent/bbx-auth-hub-identity-test.json";

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
  delete process.env.BBX_HUB_SECRET;
  const spoofed = fakeRequest({
    headers: { "x-bbx-authenticated-email": "attacker@evil.com", "x-bbx-hub-secret": "whatever" },
  });
  t.check(resolveRequestIdentity(spoofed, { openAccess: false }), {
    email: null,
    name: null,
    source: null,
  });

  const cookieValue = signSession({ email: "real@example.com", name: "Real User" });
  const withCookie = fakeRequest({ cookies: { [COOKIE_NAME]: cookieValue } });
  t.check(resolveRequestIdentity(withCookie, { openAccess: false }), {
    email: "real@example.com",
    name: "Real User",
    source: "cookie",
  });

  // ## In hub mode, a request without the secret header is unauthenticated — no cookie fallback

  process.env.BBX_HUB_SECRET = "hub-secret-abc123";
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

  const wrongSecret = fakeRequest({
    headers: { "x-bbx-hub-secret": "not-the-secret", "x-bbx-authenticated-email": "someone@example.com" },
    cookies: { [COOKIE_NAME]: cookieValue },
  });
  t.check(resolveRequestIdentity(wrongSecret, { openAccess: false }), {
    email: null,
    name: null,
    source: null,
  });

  // ## A valid secret + email header is honored as hub-sourced identity

  const validHubRequest = fakeRequest({
    headers: { "x-bbx-hub-secret": "hub-secret-abc123", "x-bbx-authenticated-email": "person@example.com" },
  });
  t.check(resolveRequestIdentity(validHubRequest, { openAccess: false }), {
    email: "person@example.com",
    name: "person@example.com",
    source: "hub",
  });

  const mixedCaseHubRequest = fakeRequest({
    headers: { "x-bbx-hub-secret": "hub-secret-abc123", "x-bbx-authenticated-email": " Person@Example.COM " },
  });
  t.check(resolveRequestIdentity(mixedCaseHubRequest, { openAccess: false }), {
    email: "person@example.com",
    name: "person@example.com",
    source: "hub",
  });

  // ## A valid secret + no email header is unauthenticated UNLESS `x-bbx-hub-auth: off` is also set

  const secretOnly = fakeRequest({ headers: { "x-bbx-hub-secret": "hub-secret-abc123" } });
  t.check(resolveRequestIdentity(secretOnly, { openAccess: false }), {
    email: null,
    name: null,
    source: null,
  });

  const secretPlusOff = fakeRequest({
    headers: { "x-bbx-hub-secret": "hub-secret-abc123", "x-bbx-hub-auth": "off" },
  });
  t.check(resolveRequestIdentity(secretPlusOff, { openAccess: false }), {
    email: null,
    name: null,
    source: "open",
  });

  // ## No `BBX_HUB_SECRET` configured server-side means the secret header can never verify
  //
  // (Standalone `openAccess` resolution, outside hub mode, is pinned in
  // `auth.required.test.ts`, the gate's own file.)

  delete process.env.BBX_HUB_SECRET;
  const noServerSecret = fakeRequest({
    headers: { "x-bbx-hub-secret": "anything", "x-bbx-authenticated-email": "someone@example.com" },
  });
  t.check(verifyHubSecret(noServerSecret), false);
});
