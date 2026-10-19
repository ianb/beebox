// # Invite acceptance routes
//
// The root invite page is public because the short-lived token is its credential.
// Acceptance creates one global member, grants one box, sets the normal session
// cookie, and consumes the token exactly once.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate, not, str } from "@ianbicking/tap-check/check";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InjectOptions } from "fastify";
import { makeTestServer } from "../../helpers/test-route-server.js";
import { createFirstUser, listUsers } from "../../../src/webapp/local-users.js";
import { mintAuthInvite } from "../../../src/webapp/auth-capabilities.js";
import { loginThrottle } from "../../../src/webapp/routes/auth/login-throttle.js";

process.env.BBX_AUTH_SCRYPT_N = "1024";
process.env.BBX_SESSION_SECRET = "invite-route-test-secret";
delete process.env.BBX_HUB_SECRET;

/** The invite pages are large generated HTML; the title tells them apart. */
function inviteTitle(title: string) {
  return any(String).includes(`<title>Bee Box — ${title}</title>`);
}

/** A public user record as the credential store returns it. */
function storedUser(fields: { email: string; name: string; role: "owner" | "member" }) {
  return { ...fields, gen: 1, created: isoDate() };
}

/** The sanitized failure page, and the line the server logs for a corrupt credential store. */
const UNAVAILABLE_PAGE = inviteTitle("Invite unavailable");
function corruptStoreLog(authFile: string) {
  return [
    [
      "[auth-invite] acceptance failed closed:",
      { name: "AuthFileCorruptError", message: str`Auth file at ${authFile} is corrupt: ${any(String)}`, filePath: authFile },
    ],
  ];
}

function inviteForm(fields: Record<string, string>): InjectOptions {
  return {
    method: "POST",
    url: "/auth/invite",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams(fields).toString(),
  };
}

// ## A pinned invite creates a member and grants only its target box
void test("A pinned invite creates a member and grants only its target box", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
      await rm(authDir, { recursive: true, force: true });
      delete process.env.BBX_AUTH_FILE;
      delete process.env.BBX_OWNER_EMAIL;
      loginThrottle.reset();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L34
  const authDir = await mkdtemp(join(tmpdir(), "bbx-invite-route-"));
  process.env.BBX_AUTH_FILE = join(authDir, "auth.json");
  process.env.BBX_OWNER_EMAIL = "Owner@Example.COM";
  const ctx = await makeTestServer({ openAccess: false });
  const minted = await mintAuthInvite({
    boxRoot: `${ctx.boxRoot}/`,
    createdBy: "owner@example.com",
    email: "Member@Example.COM",
  });

  // doctest:L44
  const page = await ctx.server.inject({ method: "GET", url: `/auth/invite?token=${minted.token}` });
  t.check({ status: page.statusCode, noStore: page.headers["cache-control"], referrer: page.headers["referrer-policy"], pinned: page.payload.includes("member@example.com") }, {
    status: 200,
    noStore: "no-store",
    referrer: "no-referrer",
    pinned: true,
  });

  // Wrong content types are rejected immediately, before reading or throttling the
  // public form body.

  // doctest:L53
  const wrongType = await ctx.server.inject({
    method: "POST",
    url: "/auth/invite",
    headers: { "content-type": "application/json" },
    payload: { token: minted.token },
  });
  t.check({ status: wrongType.statusCode, payload: wrongType.payload }, { status: 400, payload: inviteTitle("Accept invite") });

  // A confirmation typo preserves the live token and pinned identity, so correcting
  // the form can still accept the same invitation.

  // doctest:L67
  const mismatch = await ctx.server.inject(inviteForm({
    token: minted.token,
    name: "Member",
    password: "member-password",
    confirmPassword: "member-typo",
  }));
  t.check({ status: mismatch.statusCode, token: mismatch.payload.includes(`value="${minted.token}"`), pinned: mismatch.payload.includes("member@example.com") }, {
    status: 400,
    token: true,
    pinned: true,
  });

  // If the configured owner disappears before acceptance, the route fails closed
  // before consuming the capability. Restoring the owner configuration makes the
  // same link usable again.

  // doctest:L82
  delete process.env.BBX_OWNER_EMAIL;
  const missingOwner = await ctx.server.inject(inviteForm({
    token: minted.token,
    name: "Member",
    password: "member-password",
    confirmPassword: "member-password",
  }));
  t.check({ status: missingOwner.statusCode, payload: missingOwner.payload }, { status: 503, payload: UNAVAILABLE_PAGE });

  // doctest:L92
  process.env.BBX_OWNER_EMAIL = "Owner@Example.COM";

  // doctest:L96
  const accepted = await ctx.server.inject(inviteForm({
    token: minted.token,
    email: "attacker-change@example.com",
    name: "Member",
    password: "member-password",
    confirmPassword: "member-password",
  }));
  t.check({ status: accepted.statusCode, location: accepted.headers.location, cookie: typeof accepted.headers["set-cookie"] === "string" }, {
    status: 302,
    location: "/test/",
    cookie: true,
  });

  // doctest:L106
  t.check(listUsers(), [storedUser({ email: "member@example.com", name: "Member", role: "member" })]);

  // doctest:L109
  t.check(JSON.parse(await ctx.read("_config/box.json")), { allowedEmails: ["member@example.com"] });

  // Replay has the same dead-link response as an expired or unknown token.

  // doctest:L116
  const originalReplayWarn = console.warn;
  const replayWarnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => replayWarnings.push(args);
  const replay = await ctx.server.inject(inviteForm({
    token: minted.token,
    name: "Again",
    password: "member-password",
    confirmPassword: "member-password",
  }));
  console.warn = originalReplayWarn;
  t.check(
    { status: replay.statusCode, payload: replay.payload, warned: replayWarnings },
    {
      status: 410,
      payload: UNAVAILABLE_PAGE,
      warned: [["[auth-invite] rejected: category=dead-token ip=127.0.0.1"]],
    },
  );

  // Malformed open-invite email input does not consume the bearer capability.

  // doctest:L133
  loginThrottle.reset();
  const retryableInvite = await mintAuthInvite({ boxRoot: ctx.boxRoot, createdBy: "owner@example.com" });
  const badEmail = await ctx.server.inject(inviteForm({
    token: retryableInvite.token,
    email: "",
    name: "Retryable",
    password: "member-password",
    confirmPassword: "member-password",
  }));
  const retried = await ctx.server.inject(inviteForm({
    token: retryableInvite.token,
    email: "retryable@example.com",
    name: "Retryable",
    password: "member-password",
    confirmPassword: "member-password",
  }));
  t.check({ bad: badEmail.statusCode, retried: retried.statusCode, cookie: typeof retried.headers["set-cookie"] === "string" }, {
    bad: 400,
    retried: 302,
    cookie: true,
  });

  // Credential-store failures during account creation are sanitized and fail
  // closed without leaking the store path or burning through Fastify's default
  // error response.

  // doctest:L158
  const authFailureInvite = await mintAuthInvite({ boxRoot: ctx.boxRoot, createdBy: "owner@example.com" });
  await writeFile(process.env.BBX_AUTH_FILE, "not json", { mode: 0o600 });
  loginThrottle.reset();
  const originalConsoleError = console.error;
  const acceptanceErrors: unknown[][] = [];
  console.error = (...args) => acceptanceErrors.push(args);
  const corruptAuth = await ctx.server.inject(inviteForm({
    token: authFailureInvite.token,
    email: "second@example.com",
    name: "Second",
    password: "member-password",
    confirmPassword: "member-password",
  }));
  console.error = originalConsoleError;
  const authFile = join(authDir, "auth.json");
  t.check(
    { status: corruptAuth.statusCode, payload: corruptAuth.payload, logged: acceptanceErrors },
    {
      status: 503,
      payload: UNAVAILABLE_PAGE,
      logged: corruptStoreLog(authFile),
    },
  );
  // The sanitized page names neither the store path nor the corruption.
  t.check(corruptAuth.payload, not(any(String).includes(authFile)));
  t.check(corruptAuth.payload, not(any(String).includes("corrupt")));

  // A corrupt capability store fails closed with an unavailable response rather
  // than exposing a generic server error or treating the token as valid.

  // doctest:L185
  await writeFile(`${process.env.BBX_AUTH_FILE}.invites.json`, "not json", { mode: 0o600 });
  const corruptStore = await ctx.server.inject({ method: "GET", url: `/auth/invite?token=${minted.token}` });
  t.check({ status: corruptStore.statusCode, payload: corruptStore.payload }, { status: 503, payload: UNAVAILABLE_PAGE });

  // doctest:L192
  loginThrottle.reset();
  const corruptPost = await ctx.server.inject(inviteForm({
    token: minted.token,
    name: "Member",
    password: "member-password",
    confirmPassword: "member-password",
  }));
  t.check({ status: corruptPost.statusCode, payload: corruptPost.payload }, { status: 503, payload: UNAVAILABLE_PAGE });
  t.check(corruptPost.payload, not(any(String).includes(authFile)));
  t.check(corruptPost.payload, not(any(String).includes("corrupt")));
});

// ## A box-config failure leaves an explicit, signed-out partial account
void test("A box-config failure leaves an explicit, signed-out partial account", async (t) => {
  t.teardown(async () => {
    try {
      await partialCtx.cleanup();
      await rm(partialAuthDir, { recursive: true, force: true });
      delete process.env.BBX_AUTH_FILE;
      delete process.env.BBX_OWNER_EMAIL;
      loginThrottle.reset();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L218
  const partialAuthDir = await mkdtemp(join(tmpdir(), "bbx-invite-partial-"));
  process.env.BBX_AUTH_FILE = join(partialAuthDir, "auth.json");
  process.env.BBX_OWNER_EMAIL = "owner@example.com";
  await createFirstUser({ email: "owner@example.com", name: "Owner", password: "owner-password" });
  const partialCtx = await makeTestServer({ openAccess: false });
  await partialCtx.seed("_config/box.json", "not json");
  const partialInvite = await mintAuthInvite({
    boxRoot: partialCtx.boxRoot,
    createdBy: "owner@example.com",
    email: "partial@example.com",
  });
  const originalPartialError = console.error;
  const partialErrors: unknown[][] = [];
  console.error = (...args) => partialErrors.push(args);
  const partial = await partialCtx.server.inject(inviteForm({
    token: partialInvite.token,
    name: "Partial",
    password: "partial-password",
    confirmPassword: "partial-password",
  }));
  console.error = originalPartialError;
  t.check(
    {
      status: partial.statusCode,
      cookie: partial.headers["set-cookie"] ?? null,
      users: listUsers(),
      logged: partialErrors,
    },
    {
      status: 503,
      cookie: null,
      users: [storedUser({ email: "owner@example.com", name: "Owner", role: "owner" }), storedUser({ email: "partial@example.com", name: "Partial", role: "member" })],
      logged: [
        [
          "[auth-invite] account created but box config write failed for partial@example.com:",
          {
            name: "BoxConfigWriteError",
            message: "Box configuration is unreadable; refusing to replace it.",
            configPath: join(partialCtx.boxRoot, "_config", "box.json"),
          },
        ],
      ],
    },
  );
  // The page is large generated HTML; it must name the account left behind.
  t.check(partial.payload, any(String).includes("partial@example.com"));
});

// ## Open invites cannot claim an owner or an already-authorized identity
void test("Open invites cannot claim an owner or an already-authorized identity", async (t) => {
  t.teardown(async () => {
    try {
      await ctx2.cleanup();
      await rm(authDir2, { recursive: true, force: true });
      delete process.env.BBX_AUTH_FILE;
      delete process.env.BBX_OWNER_EMAIL;
      delete process.env.BBX_AUTH_SCRYPT_N;
      delete process.env.BBX_SESSION_SECRET;
      loginThrottle.reset();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L260
  const authDir2 = await mkdtemp(join(tmpdir(), "bbx-invite-collision-"));
  process.env.BBX_AUTH_FILE = join(authDir2, "auth.json");
  process.env.BBX_OWNER_EMAIL = "owner@example.com";
  await createFirstUser({ email: "owner@example.com", name: "Owner", password: "owner-password" });
  const ctx2 = await makeTestServer({ openAccess: false });
  await ctx2.seed("_config/box.json", JSON.stringify({ allowedEmails: ["GoogleOnly@Example.COM"] }));
  const openOwner = await mintAuthInvite({ boxRoot: ctx2.boxRoot, createdBy: "owner@example.com" });

  // doctest:L268
  const originalCollisionWarn = console.warn;
  const collisionWarnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => collisionWarnings.push(args);
  const ownerClaim = await ctx2.server.inject(inviteForm({
    token: openOwner.token,
    email: " OWNER@EXAMPLE.COM ",
    name: "Not owner",
    password: "attacker-password",
    confirmPassword: "attacker-password",
  }));
  console.warn = originalCollisionWarn;
  t.check(
    { status: ownerClaim.statusCode, logged: collisionWarnings },
    { status: 410, logged: [["[auth-invite] rejected: category=collision ip=127.0.0.1"]] },
  );

  // The collision burns the capability, so it cannot be reused to probe another
  // address or claim a valid one.

  // doctest:L287
  loginThrottle.reset();
  const originalReuseWarn = console.warn;
  console.warn = () => {};
  const reuseAfterCollision = await ctx2.server.inject(inviteForm({
    token: openOwner.token,
    email: "new-member@example.com",
    name: "Not owner",
    password: "attacker-password",
    confirmPassword: "attacker-password",
  }));
  console.warn = originalReuseWarn;
  t.check({ status: reuseAfterCollision.statusCode, payload: reuseAfterCollision.payload }, { status: 410, payload: UNAVAILABLE_PAGE });

  // A separate capability rejects an already-authorized identity with the same
  // dead-link response and is likewise consumed.

  // doctest:L306
  loginThrottle.reset();
  const openAllowlisted = await mintAuthInvite({ boxRoot: ctx2.boxRoot, createdBy: "owner@example.com" });
  const originalAllowlistedWarn = console.warn;
  console.warn = () => {};
  const allowlistedClaim = await ctx2.server.inject(inviteForm({
    token: openAllowlisted.token,
    email: "googleonly@example.com",
    name: "Not Google user",
    password: "attacker-password",
    confirmPassword: "attacker-password",
  }));
  console.warn = originalAllowlistedWarn;
  t.check({ status: allowlistedClaim.statusCode, payload: allowlistedClaim.payload }, { status: 410, payload: UNAVAILABLE_PAGE });

  // doctest:L321
  t.check(listUsers(), [storedUser({ email: "owner@example.com", name: "Owner", role: "owner" })]);
});
