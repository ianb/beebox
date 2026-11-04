// # admin.boxConfig / updateBoxConfig parity
//
// The `admin` tRPC procedures expose the owner-managed box settings. `boxConfig`
// returns `ownerEmail` and the selected agent engine. `updateBoxConfig` accepts
// Google services, allowed emails, and the engine, commits the change, and returns
// the saved fields.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import type { TrpcContext, TrpcUser } from "../../../../src/webapp/trpc/context.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import { simpleGit } from "simple-git";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addInvitedMember, addUser, createFirstUser } from "../../../../src/webapp/local-users.js";

// Owner context (ownerProcedure requires ctx.isOwner).
function caller(boxRoot: string, user?: TrpcUser | null) {
  const ctx: TrpcContext = trpcContext({ boxRoot, user: user === undefined ? { email: "owner@example.com", name: "Owner" } : user, isAuthenticatedOwner: true });
  return appRouter.createCaller(ctx);
}

// ## Invite minting requires a concrete signed-in box owner
void test("Invite minting requires a concrete signed-in box owner", async (t) => {
  t.teardown(async () => {
    try {
      await inviteBox.cleanup();
      await rm(inviteAuthDir, { recursive: true, force: true });
      delete process.env.BBX_AUTH_FILE;
      delete process.env.BBX_AUTH_SCRYPT_N;
      delete process.env.BBX_OWNER_EMAIL;
    } catch (error) {
      t.error(error);
    }
  });
  const inviteAuthDir = await mkdtemp(join(tmpdir(), "bbx-admin-invite-"));
  process.env.BBX_AUTH_FILE = join(inviteAuthDir, "auth.json");
  process.env.BBX_AUTH_SCRYPT_N = "1024";
  process.env.BBX_OWNER_EMAIL = "owner@example.com";
  await createFirstUser({ email: "owner@example.com", name: "Owner", password: "owner-password" });
  const inviteBox = await makeTmpBox({ git: true });

  const invite = await caller(inviteBox.root).admin.createInvite({ email: " Member@Example.COM " });
  t.check(invite, {
    invitePath: str`/auth/invite?token=${any(String).matches(/^[\w-]+$/)}`,
    expiresAt: any(Number).above(Date.now()),
  });

  // Open/test owner authorization without a human identity cannot mint a bearer
  // capability into the global credential store.

  const openResult = await caller(inviteBox.root, null).admin.createInvite({}).then(
    () => "allowed",
    (error) => error.code,
  );
  t.check(openResult, "UNAUTHORIZED");

  // The owner can detect when an allowlist addition would grant an already-created
  // local account, including an identity previously claimed through an open invite.

  await addUser({ email: "claimed@example.com", name: "Claimed", password: "claimed-password", role: "member" });
  t.check(await caller(inviteBox.root).admin.localAccountStatus({ email: " Claimed@Example.COM " }), {
    exists: true,
  });

  // Pinned invites cannot replace an existing local identity.

  const pinnedConflict = await caller(inviteBox.root).admin.createInvite({ email: "claimed@example.com" }).then(
    () => "allowed",
    (error) => error.code,
  );
  t.check(pinnedConflict, "CONFLICT");

  // A corrupt capability store is a typed, generic precondition failure on the
  // owner surface; its filesystem path is not exposed in the error message.

  await writeFile(`${process.env.BBX_AUTH_FILE}.invites.json`, "not json", { mode: 0o600 });
  const unavailableInvite = await caller(inviteBox.root).admin.createInvite({}).then(
    () => ({ code: "none", message: "" }),
    (error) => ({ code: error.code, message: error.message }),
  );
  t.check(unavailableInvite, {
    code: "PRECONDITION_FAILED",
    message: "The invite store is unavailable.",
  });
});

// The configured Google owner can mint before any local-password account exists.
void test("The configured Google owner can mint before any local-password account exists.", async (t) => {
  t.teardown(async () => {
    try {
      await noOwnerBox.cleanup();
      await rm(noOwnerAuthDir, { recursive: true, force: true });
      delete process.env.BBX_AUTH_FILE;
      delete process.env.BBX_OWNER_EMAIL;
    } catch (error) {
      t.error(error);
    }
  });
  const noOwnerAuthDir = await mkdtemp(join(tmpdir(), "bbx-admin-no-owner-"));
  process.env.BBX_AUTH_FILE = join(noOwnerAuthDir, "auth.json");
  process.env.BBX_OWNER_EMAIL = "owner@example.com";
  const noOwnerBox = await makeTmpBox({ git: true });
  const noOwnerResult = await caller(noOwnerBox.root).admin.createInvite({ email: "member@example.com" });
  t.check(noOwnerResult, {
    invitePath: str`/auth/invite?token=${any(String).matches(/^[\w-]+$/)}`,
    expiresAt: any(Number).above(Date.now()),
  });

  t.check(await caller(noOwnerBox.root).admin.boxConfig(), {
    boxSlug: "test",
    allowedEmails: [],
    allowedUserDetails: [],
    localPasswordStatus: "ready",
    passwordResetEligibleEmails: [],
    publicUrl: null,
    ownerEmail: "owner@example.com",
    googleLoginConfigured: false,
    googleServices: {},
    agentEngine: "claude",
    agentModel: null,
    openrouterModels: [],
    openrouterKeyGranted: false,
    engines: { claude: true },
    claudeCodeTelemetry: "on",
    codexTelemetry: "off",
  });
});

// ## updateBoxConfig writes googleServices and commits
void test("updateBoxConfig writes googleServices and commits", async (t) => {
  t.teardown(async () => {
    try {
      await rm(memberAuthDir, { recursive: true, force: true });
      delete process.env.BBX_AUTH_FILE;
      delete process.env.BBX_AUTH_SCRYPT_N;
      delete process.env.BBX_OWNER_EMAIL;
      delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const res = await caller(box.root).admin.updateBoxConfig({ googleServices: { calendar: true, gmail: false } });
  // The change was committed (a new commit exists on top of the box's initial one).
  const subject = (await simpleGit(box.root).log({ maxCount: 1 })).latest?.message;
  t.check(
    { res, subject },
    {
      res: {
        success: true,
        commitWarning: null,
        allowedEmails: [],
        googleServices: { calendar: true, gmail: false },
        agentEngine: "claude",
        agentModel: null,
        engines: { claude: true },
        claudeCodeTelemetry: "on",
        codexTelemetry: "off",
      },
      subject: "Update box config: googleServices",
    },
  );

  // ## boxConfig round-trips googleServices and exposes ownerEmail

  const cfg = await caller(box.root).admin.boxConfig();
  t.check(cfg, {
    boxSlug: "test",
    allowedEmails: [],
    allowedUserDetails: [],
    localPasswordStatus: "ready",
    passwordResetEligibleEmails: [],
    publicUrl: null,
    ownerEmail: null,
    googleLoginConfigured: false,
    googleServices: { calendar: true, gmail: false },
    agentEngine: "claude",
    agentModel: null,
    openrouterModels: [],
    openrouterKeyGranted: false,
    engines: { claude: true },
    claudeCodeTelemetry: "on",
    codexTelemetry: "off",
  });

  // Missing engine configuration defaults to Claude, while a Codex selection is
  // persisted and returned through the same owner-only mutation.

  t.check(cfg.agentEngine, "claude");

  const engineResult = await caller(box.root).admin.updateBoxConfig({ agentEngine: "codex" });
  const engineConfig = JSON.parse(await box.read("_config/box.json"));
  t.check({ returned: engineResult.agentEngine, saved: engineConfig.agentEngine }, { returned: "codex", saved: "codex" });

  t.check((await caller(box.root).admin.boxConfig()).agentEngine, "codex");


  // Retired model pins are shown as the current model in Admin, matching the model
  // the runtime will use instead of presenting a working pin as unavailable.

  await box.write("_config/box.json", JSON.stringify({
    agentEngine: "codex",
    agentModel: "gpt-5.6-sol",
  }));
  t.check((await caller(box.root).admin.boxConfig()).agentModel, "gpt-6.1-sol");

  // An invalid configured engine is not presented as a valid Claude default. The
  // runtime rejects this value too, so Admin must surface the same configuration
  // failure instead of fabricating a usable-looking payload.

  await box.write("_config/box.json", JSON.stringify({ agentEngine: "other" }));
  const originalConsoleWarn = console.warn;
  console.warn = () => {};
  const invalidConfigResult = await caller(box.root).admin.boxConfig().then(
    () => "allowed",
    (error) => `${error.code}: ${error.message}`,
  );
  console.warn = originalConsoleWarn;
  t.check(invalidConfigResult, "PRECONDITION_FAILED: Box configuration is unreadable.");

  await box.write("_config/box.json", JSON.stringify({ agentEngine: "codex" }));

  // Google login availability is reported separately from per-box Google service
  // toggles, so the allowed-user UI can describe how a non-local account signs in.

  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  t.check((await caller(box.root).admin.boxConfig()).googleLoginConfigured, false);

  process.env.GOOGLE_OAUTH_CLIENT_ID = "login-client";
  t.check((await caller(box.root).admin.boxConfig()).googleLoginConfigured, false);

  process.env.GOOGLE_OAUTH_CLIENT_ID = "login-client";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "login-secret";
  t.check((await caller(box.root).admin.boxConfig()).googleLoginConfigured, true);

  // ## updateBoxConfig still accepts allowedEmails and filters non-emails

  const res2 = await caller(box.root).admin.updateBoxConfig({
    allowedEmails: [" A@Example.COM ", "a@example.com", "not-an-email"],
  });
  t.check(res2, {
    success: true,
    commitWarning: null,
    allowedEmails: ["a@example.com"],
    googleServices: {},
    agentEngine: "codex",
    agentModel: null,
    engines: { codex: true },
    claudeCodeTelemetry: "on",
    codexTelemetry: "off",
  });

  // Only allowed local members are exposed as password-reset targets. The owner and
  // allowed addresses without a local account are excluded.

  const memberAuthDir = await mkdtemp(join(tmpdir(), "bbx-admin-members-"));
  process.env.BBX_AUTH_FILE = join(memberAuthDir, "auth.json");
  process.env.BBX_AUTH_SCRYPT_N = "1024";
  process.env.BBX_OWNER_EMAIL = "owner@example.com";
  await addInvitedMember({ email: "member@example.com", name: "Member", password: "member-password" });
  await caller(box.root).admin.updateBoxConfig({
    allowedEmails: ["member@example.com", "invited@example.com", "owner@example.com"],
  });
  const memberConfig = await caller(box.root).admin.boxConfig();
  const memberConfigSummary = {
    eligible: memberConfig.passwordResetEligibleEmails,
    status: memberConfig.localPasswordStatus,
    details: memberConfig.allowedUserDetails,
  };
  t.check(memberConfigSummary, {
    eligible: ["member@example.com"],
    status: "ready",
    details: [
      { email: "member@example.com", kind: "local-member", resetEligible: true },
      { email: "invited@example.com", kind: "access-only", resetEligible: false },
      { email: "owner@example.com", kind: "owner-entry", resetEligible: false },
    ],
  });

  // A local owner remains described as a local account when a different configured
  // owner identity makes its allowlist entry non-redundant. It is still ineligible
  // for the member password-reset action.

  await createFirstUser({ email: "owner@example.com", name: "Owner", password: "owner-password" });
  process.env.BBX_OWNER_EMAIL = "google-owner@example.com";
  const localOwnerDetail = (await caller(box.root).admin.boxConfig()).allowedUserDetails
    .find((user) => user.email === "owner@example.com");
  t.check(localOwnerDetail, { email: "owner@example.com", kind: "local-owner", resetEligible: false });

  delete process.env.BBX_OWNER_EMAIL;

  // The owner can mint a reset only for that eligible member; the returned link is
  // root-auth-relative and never contains the email address.

  const reset = await caller(box.root).admin.createPasswordReset({ email: " MEMBER@EXAMPLE.COM " });
  t.check(reset, {
    resetPath: str`/auth/reset-password?token=${any(String).matches(/^[\w-]+$/)}`,
    expiresAt: any(Number).above(Date.now()),
  });

  t.check(
    await caller(box.root).admin.createPasswordReset({ email: "invited@example.com" }).then(
      () => "allowed",
      (error) => error.code,
    ),
    "NOT_FOUND",
  );

  // ## empty input is rejected

  const err = await caller(box.root).admin.updateBoxConfig({}).then(() => "none", (e) => e.code);
  t.check(err, "BAD_REQUEST");
});

// ## Claude Code telemetry defaults on and the owner can turn it off
//
// The setting governs first-party runs only. Turning it off is saved,
// committed, and read by the spawn seam on the next run.
void test("The setting governs first-party runs only.", async (t) => {
  const { providerEnvAdditions } = await import("../../../../src/core/provider-env/core.js");
  const box = await makeTmpBox({ git: true });
  const before = (await caller(box.root).admin.boxConfig()).claudeCodeTelemetry;
  const saved = await caller(box.root).admin.updateBoxConfig({ claudeCodeTelemetry: "off" });
  const subject = (await simpleGit(box.root).log({ maxCount: 1 })).latest?.message;
  const env = await providerEnvAdditions({ boxRoot: box.root, model: "claude-opus-5-5", purpose: "test" });
  t.check(
    {
      before,
      saved: saved.claudeCodeTelemetry,
      after: (await caller(box.root).admin.boxConfig()).claudeCodeTelemetry,
      subject,
      env,
    },
    {
      before: "on",
      saved: "off",
      after: "off",
      subject: "Update box config: claudeCodeTelemetry",
      env: { DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1" },
    },
  );

  await box.cleanup();
});

// ## Codex analytics default off and the owner can turn them on
void test("Codex analytics default off and the owner can turn them on", async (t) => {
  const box = await makeTmpBox({ git: true });
  const before = (await caller(box.root).admin.boxConfig()).codexTelemetry;
  const saved = await caller(box.root).admin.updateBoxConfig({ codexTelemetry: "on" });
  t.check([before, saved.codexTelemetry, (await caller(box.root).admin.boxConfig()).codexTelemetry], [
    "off",
    "on",
    "on",
  ]);

  await box.cleanup();
});

// ## A Git failure does not falsely report that the saved config rolled back
void test("A Git failure does not falsely report that the saved config rolled back", async (t) => {
  t.teardown(async () => {
    try {
      await rejectedCommitBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const rejectedCommitBox = await makeTmpBox({ git: true });
  await rejectedCommitBox.write(".git/hooks/pre-commit", "#!/bin/sh\nexit 1\n");
  await chmod(join(rejectedCommitBox.root, ".git/hooks/pre-commit"), 0o755);
  const originalConsoleError = console.error;
  const commitErrors: unknown[][] = [];
  console.error = (...args) => commitErrors.push(args);
  const degraded = await caller(rejectedCommitBox.root).admin.updateBoxConfig({
    allowedEmails: ["member@example.com"],
  });
  console.error = originalConsoleError;
  const savedAfterRejection = JSON.parse(await rejectedCommitBox.read("_config/box.json"));
  t.check(
    { degraded, saved: savedAfterRejection.allowedEmails, logged: commitErrors },
    {
      degraded: {
        success: true,
        commitWarning: "Saved, but the Git commit failed.",
        allowedEmails: ["member@example.com"],
        googleServices: {},
        agentEngine: "claude",
        agentModel: null,
        engines: { claude: true },
        claudeCodeTelemetry: "on",
        codexTelemetry: "off",
      },
      saved: ["member@example.com"],
      logged: [
        [
          `[admin] box config was saved but its Git commit failed for ${rejectedCommitBox.root}:`,
          {
            name: "CommitDidNotLandError",
            message: `commit reported success but HEAD did not move in ${rejectedCommitBox.root} — a pre-commit or commit-msg hook most likely rejected it. Run \`git commit\` by hand to see the hook's output.`,
          },
        ],
      ],
    },
  );
});
