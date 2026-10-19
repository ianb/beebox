// # Password login + first-run setup (route tier)
//
// The local login surface (`src/webapp/routes/auth/register.ts`): `POST /auth/login` verifies
// credentials and mints the session cookie; `POST /auth/setup` claims the owner
// account with a live setup token. These are ROOT routes (not box-scoped), so the
// doctest injects against the bare Fastify instance rather than the slug-prefixing
// helpers. `BBX_AUTH_SCRYPT_N` is lowered so scrypt is fast, and the server is
// constructed with `openAccess: false` so real auth is exercised.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { makeTestServer } from "../../helpers/test-route-server.js";
import { armSetupToken, clearSetupToken } from "../../../src/webapp/setup-token.js";
import { loginThrottle } from "../../../src/webapp/routes/auth/login-throttle.js";
import { createFirstUser, getLocalOwnerEmail } from "../../../src/webapp/local-users.js";

// Fast scrypt for the doctest (test-only work-factor seam).
process.env.BBX_AUTH_SCRYPT_N = "1024";
// Exercise REAL auth: clear any configured owner email that would constrain the
// first account (the server itself is constructed with openAccess: false below).
delete process.env.BBX_OWNER_EMAIL;

const authDir = await mkdtemp(path.join(os.tmpdir(), "bbx-auth-login-"));
const AUTH_FILE = path.join(authDir, "auth.json");
process.env.BBX_AUTH_FILE = AUTH_FILE;

const server = await makeTestServer({ openAccess: false });

// Root-level POST helper (JSON body). Returns the raw inject response so a 204
// (no body) is observable without trying to parse JSON.
function postAuth(url: string, body: object) {
  return server.server.inject({ method: "POST", url, payload: body });
}

// The bare login/setup pages submit an `application/x-www-form-urlencoded` form
// instead of JSON — the handler detects the content-type and answers with a 302
// redirect rather than a JSON body.
function postForm(url: string, fields: Record<string, string>) {
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

// ## A correct password sets the session cookie and returns 204
void test("A correct password sets the session cookie and returns 204", async (t) => {
  // doctest:L60
  await resetAuth();
  await createFirstUser({ email: "owner@example.com", name: "Owner", password: "correct-horse-battery" });

  // doctest:L63
  const ok = await postAuth("/auth/login", { email: "owner@example.com", password: "correct-horse-battery" });
  t.check(
    { status: ok.statusCode, body: ok.body, cookies: ok.cookies.map((c) => c.name) },
    { status: 204, body: "", cookies: ["bbx_session"] },
  );
});

// ## Wrong password and unknown user both answer an identical 401 (no enumeration)
void test("Wrong password and unknown user both answer an identical 401 (no enumeration)", async (t) => {
  // doctest:L74
  await resetAuth();
  await createFirstUser({ email: "owner@example.com", name: "Owner", password: "correct-horse-battery" });

  // doctest:L77
  const wrongPass = await postAuth("/auth/login", { email: "owner@example.com", password: "wrong" });
  t.check({ status: wrongPass.statusCode, body: wrongPass.json() }, {
    status: 401,
    body: {
      error: "Invalid credentials",
    },
  });

  // doctest:L81
  // Reset the throttle so the second attempt is judged on its own merits (the
  // first failure would otherwise cool-down this IP).
  loginThrottle.reset();
  const unknownUser = await postAuth("/auth/login", { email: "ghost@example.com", password: "anything" });
  t.check({ status: unknownUser.statusCode, body: unknownUser.json() }, {
    status: 401,
    body: {
      error: "Invalid credentials",
    },
  });

  // doctest:L88
  t.check(
    // Byte-for-byte identical responses.
    unknownUser.json(),
    wrongPass.json(),
  );

  // doctest:L92
  // A parsed-but-non-object body (array/null/etc.) is rejected FAST as a 400 —
  // it must not fall through to the raw-stream reader (whose events already
  // fired) and stall until the read timeout. Regression guard for the
  // `request.body !== undefined` body-detect fix.
  loginThrottle.reset();
  const arrayBody = await server.server.inject({ method: "POST", url: "/auth/login", payload: [] });
  t.check({ status: arrayBody.statusCode, body: arrayBody.json() }, { status: 400, body: { error: "Invalid request" } });
});

// ## Setup happy path: a live token creates the owner and mints a session
void test("Setup happy path: a live token creates the owner and mints a session", async (t) => {
  // doctest:L105
  await resetAuth();
  const token = armSetupToken({ now: Date.now() });

  // doctest:L108
  const setupOk = await postAuth("/auth/setup", {
    email: "Boss@Example.com",
    name: "Boss",
    password: "hunter2hunter2",
    token,
  });
  t.check(
    { status: setupOk.statusCode, body: setupOk.body, cookies: setupOk.cookies.map((c) => c.name) },
    { status: 204, body: "", cookies: ["bbx_session"] },
  );

  // doctest:L120
  t.check(
    // The owner was persisted (email canonicalized to lowercase).
    getLocalOwnerEmail(),
    "boss@example.com",
  );
});

// ## Setup rejects a wrong token (403) and an expired one (410)
void test("Setup rejects a wrong token (403) and an expired one (410)", async (t) => {
  // doctest:L128
  await resetAuth();
  armSetupToken({ now: Date.now() });

  // doctest:L131
  const wrongToken = await postAuth("/auth/setup", {
    email: "boss@example.com",
    name: "Boss",
    password: "hunter2hunter2",
    token: "not-the-real-token",
  });
  t.check({ status: wrongToken.statusCode, body: wrongToken.json() }, {
    status: 403,
    body: { error: "Invalid setup token" },
  });

  // doctest:L140
  // A token armed 20 minutes ago is past its 15-minute TTL → 410 Gone.
  loginThrottle.reset();
  const staleToken = armSetupToken({ now: Date.now() - 20 * 60 * 1000 });
  const expired = await postAuth("/auth/setup", {
    email: "boss@example.com",
    name: "Boss",
    password: "hunter2hunter2",
    token: staleToken,
  });
  t.check({ status: expired.statusCode, body: expired.json() }, {
    status: 410,
    body: {
      error: "Setup token expired",
      message: "Restart the server to print a fresh setup link, or run `bbx engine auth create-user` on the host.",
    },
  });
});

// ## Setup answers 410 once an account exists
void test("Setup answers 410 once an account exists", async (t) => {
  // doctest:L156
  await resetAuth();
  await createFirstUser({ email: "owner@example.com", name: "Owner", password: "correct-horse-battery" });
  const lateToken = armSetupToken({ now: Date.now() });

  // doctest:L160
  const claimed = await postAuth("/auth/setup", {
    email: "other@example.com",
    name: "Other",
    password: "password1234",
    token: lateToken,
  });
  t.check({ status: claimed.statusCode, body: claimed.json() }, {
    status: 410,
    body: {
      error: "Setup already complete",
      message: "An account already exists; sign in at /auth/login.",
    },
  });
});

// An empty initialized store is a durable setup tombstone after the last member is
// removed.
void test("An empty initialized store is a durable setup tombstone after the last member...", async (t) => {
  // doctest:L174
  await resetAuth();
  await writeFile(AUTH_FILE, JSON.stringify({ version: 1, users: [] }), { mode: 0o600 });
  const tombstoneToken = armSetupToken({ now: Date.now() });
  const tombstoneSetup = await postAuth("/auth/setup", {
    email: "other@example.com",
    name: "Other",
    password: "password1234",
    token: tombstoneToken,
  });
  t.check({ status: tombstoneSetup.statusCode, body: tombstoneSetup.json() }, {
    status: 410,
    body: {
      error: "Setup already complete",
      message: "An account already exists; sign in at /auth/login.",
    },
  });
});

// ## Two concurrent setups race on the store lock — one wins (204), one loses (409)
void test("Two concurrent setups race on the store lock — one wins (204), one loses (409)", async (t) => {
  // doctest:L190
  await resetAuth();
  const raceToken = armSetupToken({ now: Date.now() });
  const body = { email: "first@example.com", name: "First", password: "password1234", token: raceToken };

  // doctest:L194
  const [a, b] = await Promise.all([postAuth("/auth/setup", body), postAuth("/auth/setup", body)]);
  t.check([a, b].map((res) => res.statusCode).toSorted((x, y) => x - y), [204, 409]);
});

// ## A form login redirects (302) to the sanitized returnTo and sets the cookie
void test("A form login redirects (302) to the sanitized returnTo and sets the cookie", async (t) => {
  // doctest:L202
  await resetAuth();
  await createFirstUser({ email: "owner@example.com", name: "Owner", password: "correct-horse-battery" });

  // doctest:L205
  const ok = await postForm("/auth/login", {
    email: "owner@example.com",
    password: "correct-horse-battery",
    returnTo: "/test/home",
  });
  t.check({ status: ok.statusCode, location: ok.headers.location, cookies: ok.cookies.map((c) => c.name) }, {
    status: 302,
    location: "/test/home",
    cookies: ["bbx_session"],
  });

  // doctest:L213
  // A malicious returnTo (protocol-relative escape) collapses to "/" — never off-origin.
  loginThrottle.reset();
  const evil = await postForm("/auth/login", {
    email: "owner@example.com",
    password: "correct-horse-battery",
    returnTo: "//evil.com/x",
  });
  t.check(evil.headers.location, "/");
});

// ## A failed form login redirects back to the bare page with a generic error, no cookie
void test("A failed form login redirects back to the bare page with a generic error, no cookie", async (t) => {
  // doctest:L227
  await resetAuth();
  await createFirstUser({ email: "owner@example.com", name: "Owner", password: "correct-horse-battery" });

  // doctest:L230
  const bad = await postForm("/auth/login", { email: "owner@example.com", password: "wrong", returnTo: "/test/home" });
  t.check({ status: bad.statusCode, location: bad.headers.location, cookies: bad.cookies.length }, {
    status: 302,
    location: "/auth/login?returnTo=%2Ftest%2Fhome&error=1",
    cookies: 0,
  });
});

// ## A form setup creates the owner, redirects to the root, and sets the cookie
void test("A form setup creates the owner, redirects to the root, and sets the cookie", async (t) => {
  // doctest:L238
  await resetAuth();
  const token = armSetupToken({ now: Date.now() });

  // doctest:L241
  const setup = await postForm("/auth/setup", {
    email: "boss@example.com",
    name: "Boss",
    password: "hunter2hunter2",
    confirmPassword: "hunter2hunter2",
    token,
  });
  t.check({ status: setup.statusCode, location: setup.headers.location, cookies: setup.cookies.map((c) => c.name) }, {
    status: 302,
    location: "/",
    cookies: ["bbx_session"],
  });
});

// ## A form setup with mismatched passwords redirects back with error=mismatch, no account created
void test("A form setup with mismatched passwords redirects back with error=mismatch, no account created", async (t) => {
  // doctest:L255
  await resetAuth();
  const mismatchToken = armSetupToken({ now: Date.now() });

  // doctest:L258
  const mm = await postForm("/auth/setup", {
    email: "boss@example.com",
    name: "Boss",
    password: "hunter2hunter2",
    confirmPassword: "different-pw-123",
    token: mismatchToken,
  });
  t.check(
    { status: mm.statusCode, location: mm.headers.location, cookies: mm.cookies, owner: getLocalOwnerEmail() },
    { status: 302, location: `/auth/setup?token=${mismatchToken}&error=mismatch`, cookies: [], owner: null },
  );
});

// ## A decoy content-type whose essence is JSON takes the JSON path (no form double-read)
//
// `isFormRequest` compares the exact MIME essence, not a substring — so
// `application/json; x=application/x-www-form-urlencoded` (which Fastify parses as
// JSON, consuming the stream) is treated as JSON. Were it substring-matched, the
// form path would call `readFormBody` on the drained stream and hang to the 10s
// timeout, breaking the "JSON callers unchanged" guarantee.
void test("isFormRequest compares the exact MIME essence, not a substring — so applicati...", async (t) => {
  t.teardown(async () => {
    try {
      await server.cleanup();
      await rm(authDir, { recursive: true, force: true });
      delete process.env.BBX_AUTH_FILE;
      delete process.env.BBX_AUTH_SCRYPT_N;
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L287
  await resetAuth();
  await createFirstUser({ email: "owner@example.com", name: "Owner", password: "correct-horse-battery" });
  loginThrottle.reset();

  // doctest:L291
  const decoy = await server.server.inject({
    method: "POST",
    url: "/auth/login",
    headers: { "content-type": "application/json; x=application/x-www-form-urlencoded" },
    payload: JSON.stringify({ email: "owner@example.com", password: "wrong" }),
  });
  t.check(
    // A JSON 401 (not a 302 redirect) proves the JSON path was taken.
    { status: decoy.statusCode, body: decoy.json() },
    { status: 401, body: { error: "Invalid credentials" } },
  );
});
