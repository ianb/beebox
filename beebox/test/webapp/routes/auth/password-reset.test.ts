// # Operator-issued member password reset
//
// The public reset page is authenticated only by its short-lived capability. It
// names the pinned email so the member can confirm the target account, does not
// request an email, and GET inspection does not consume the link or mutate login
// throttles.

import { test } from "tap";
import "agent-doctest/tap";
import { any, isoDate, not } from "agent-doctest/check";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTestServer } from "../../../helpers/test-route-server.js";
import { addUser, createFirstUser, getLocalUser, verifyPassword } from "../../../../src/webapp/local-users.js";
import { mintAuthInvite, mintAuthPasswordReset } from "../../../../src/webapp/auth-capabilities.js";
import { loginThrottle } from "../../../../src/webapp/routes/auth/login-throttle.js";
import { passwordResetThrottle } from "../../../../src/webapp/routes/auth/password-reset.js";

process.env.BBX_AUTH_SCRYPT_N = "1024";
process.env.BBX_SESSION_SECRET = "password-reset-route-test-secret";
delete process.env.BBX_HUB_SECRET;

function resetForm(fields: Record<string, string>) {
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  return {
    method: "POST" as const,
    url: "/auth/reset-password",
    headers,
    payload: new URLSearchParams(fields).toString(),
  };
}

// ## A live link resets the pinned member and returns to ordinary login
void test("A live link resets the pinned member and returns to ordinary login", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
      await rm(authDir, { recursive: true, force: true });
      delete process.env.BBX_AUTH_FILE;
      delete process.env.BBX_OWNER_EMAIL;
      loginThrottle.reset();
      passwordResetThrottle.reset();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L36
  const authDir = await mkdtemp(join(tmpdir(), "bbx-password-reset-route-"));
  process.env.BBX_AUTH_FILE = join(authDir, "auth.json");
  process.env.BBX_OWNER_EMAIL = "owner@example.com";
  await createFirstUser({ email: "owner@example.com", name: "Owner", password: "owner-password" });
  await addUser({ email: "member@example.com", name: "Member", password: "old-password", role: "member" });
  const ctx = await makeTestServer({ openAccess: false });
  await ctx.seed("_config/box.json", JSON.stringify({ allowedEmails: ["member@example.com"] }));
  const reset = await mintAuthPasswordReset({
    boxRoot: ctx.boxRoot,
    createdBy: "owner@example.com",
    email: "member@example.com",
  });

  // doctest:L49
  const login = await ctx.server.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: "member@example.com", password: "old-password" },
  });
  const oldCookie = String(login.headers["set-cookie"]).split(";", 1)[0];
  t.check(login.statusCode, 204);

  // doctest:L58
  let page = await ctx.server.inject({ method: "GET", url: `/auth/reset-password?token=${reset.token}` });
  for (let index = 1; index < 12; index += 1) {
    page = await ctx.server.inject({ method: "GET", url: `/auth/reset-password?token=${reset.token}` });
  }
  t.check({
    status: page.statusCode,
    noStore: page.headers["cache-control"],
    referrer: page.headers["referrer-policy"],
  }, {
    status: 200,
    noStore: "no-store",
    referrer: "no-referrer",
  });
  t.check(page.payload, any(String).includes("member@example.com"));

  // Wrong content types and invite-kind capabilities cannot enter the reset flow.

  // doctest:L75
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
  t.check({ wrongType: wrongType.statusCode, wrongKind: wrongKind.statusCode }, { wrongType: 400, wrongKind: 410 });

  // doctest:L88
  passwordResetThrottle.reset();

  // A validation error keeps the live token, allowing the member to correct the
  // form without asking the operator for another link.

  // doctest:L95
  const mismatch = await ctx.server.inject(resetForm({
    token: reset.token,
    password: "new-password",
    confirmPassword: "new-password-typo",
  }));
  t.check(mismatch.statusCode, 400);
  t.check(mismatch.payload, any(String).includes(`value="${reset.token}"`));

  // doctest:L105
  t.check(loginThrottle.acquireHashSlot(), true);

  // doctest:L108
  t.check(loginThrottle.acquireHashSlot(), true);

  // doctest:L111
  const atCapacity = await ctx.server.inject(resetForm({
    token: reset.token,
    password: "new-password",
    confirmPassword: "new-password",
  }));
  loginThrottle.releaseHashSlot();
  loginThrottle.releaseHashSlot();
  t.check(atCapacity.statusCode, 429);
  t.check(atCapacity.payload, any(String).includes(`value="${reset.token}"`));

  // doctest:L123
  const beforeGen = getLocalUser("member@example.com")?.gen;
  const acceptedRequest = resetForm({ token: reset.token, password: "new-password", confirmPassword: "new-password" });
  acceptedRequest.headers["x-bbx-base-prefix"] = "/worktree";
  const accepted = await ctx.server.inject(acceptedRequest);
  t.check({
    status: accepted.statusCode,
    location: accepted.headers.location,
    cookie: accepted.headers["set-cookie"] ?? null,
    gen: { before: beforeGen, after: getLocalUser("member@example.com")?.gen },
  }, {
    status: 302,
    location: "/worktree/auth/login?returnTo=%2Fworktree%2Ftest%2F&passwordReset=1",
    cookie: null,
    gen: { before: 1, after: 2 },
  });

  // doctest:L136
  const oldSession = await ctx.server.inject({
    method: "GET",
    url: "/auth/me",
    headers: { cookie: oldCookie },
  });
  t.check(oldSession.statusCode, 401);

  // doctest:L144
  t.check(await verifyPassword({ email: "member@example.com", password: "old-password" }), null);

  // doctest:L147
  t.check(await verifyPassword({ email: "member@example.com", password: "new-password" }), {
    email: "member@example.com",
    name: "Member",
    role: "member",
    gen: 2,
    created: isoDate(),
  });

  // The login page confirms the update without signing the member in, and replay is
  // the same generic dead-link response as any unknown token.

  // doctest:L155
  const loginPage = await ctx.server.inject({ method: "GET", url: "/auth/login?passwordReset=1" });
  t.check(loginPage.payload, any(String).includes("Password reset. Sign in with your new password."));

  // doctest:L159
  const originalWarn = console.warn;
  console.warn = () => {};
  const replay = await ctx.server.inject(resetForm({
    token: reset.token,
    password: "another-password",
    confirmPassword: "another-password",
  }));
  console.warn = originalWarn;
  t.check(replay.statusCode, 410);

  // Reset-specific token/IP backoff rejects an immediate repeated dead-token POST
  // without coupling the attempt to ordinary login state.

  // doctest:L175
  passwordResetThrottle.reset();
  const deadForm = resetForm({ token: "unknown-token", password: "new-password", confirmPassword: "new-password" });
  console.warn = () => {};
  const firstDead = await ctx.server.inject(deadForm);
  const repeatedDead = await ctx.server.inject(deadForm);
  console.warn = originalWarn;
  t.check({ first: firstDead.statusCode, repeated: repeatedDead.statusCode }, {
    first: 410,
    repeated: 429,
  });
});

// ## Access removal and store failures fail closed
void test("Access removal and store failures fail closed", async (t) => {
  t.teardown(async () => {
    try {
      await staleCtx.cleanup();
      await rm(staleDir, { recursive: true, force: true });
      delete process.env.BBX_AUTH_FILE;
      delete process.env.BBX_OWNER_EMAIL;
      delete process.env.BBX_AUTH_SCRYPT_N;
      delete process.env.BBX_SESSION_SECRET;
      loginThrottle.reset();
      passwordResetThrottle.reset();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L197
  const staleDir = await mkdtemp(join(tmpdir(), "bbx-password-reset-stale-"));
  process.env.BBX_AUTH_FILE = join(staleDir, "auth.json");
  process.env.BBX_OWNER_EMAIL = "owner@example.com";
  await createFirstUser({ email: "owner@example.com", name: "Owner", password: "owner-password" });
  await addUser({ email: "member@example.com", name: "Member", password: "old-password", role: "member" });
  const staleCtx = await makeTestServer({ openAccess: false });
  await staleCtx.seed("_config/box.json", JSON.stringify({ allowedEmails: [] }));
  const staleReset = await mintAuthPasswordReset({
    boxRoot: staleCtx.boxRoot,
    createdBy: "owner@example.com",
    email: "member@example.com",
  });
  const stale = await staleCtx.server.inject({ method: "GET", url: `/auth/reset-password?token=${staleReset.token}` });
  t.check(stale.statusCode, 410);

  // doctest:L215
  await staleCtx.seed("_config/box.json", JSON.stringify({ allowedEmails: ["member@example.com"] }));
  const savedAuth = await readFile(process.env.BBX_AUTH_FILE, "utf8");
  await writeFile(process.env.BBX_AUTH_FILE, "not json", { mode: 0o600 });
  const credentialUnavailable = await staleCtx.server.inject({
    method: "GET",
    url: `/auth/reset-password?token=${staleReset.token}`,
  });
  await writeFile(process.env.BBX_AUTH_FILE, savedAuth, { mode: 0o600 });
  t.check({ status: credentialUnavailable.statusCode, html: credentialUnavailable.headers["content-type"] }, {
    status: 503,
    html: "text/html",
  });

  // doctest:L228
  await writeFile(`${process.env.BBX_AUTH_FILE}.invites.json`, "not json", { mode: 0o600 });
  const unavailable = await staleCtx.server.inject({ method: "GET", url: `/auth/reset-password?token=${staleReset.token}` });
  t.check(unavailable.statusCode, 503);
  t.check(unavailable.payload, not(any(String).includes(process.env.BBX_AUTH_FILE)));
});
