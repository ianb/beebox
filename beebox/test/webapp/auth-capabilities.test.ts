// # Auth capability store (`auth-capabilities.ts`)
//
// Invite URLs carry a random bearer token, but the machine-local store retains
// only its SHA-256 hash. The store is shared by the box child that mints an invite
// and the root auth process that consumes it.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  consumeAuthInvite,
  consumeAuthPasswordReset,
  inspectAuthInvite,
  inspectAuthPasswordReset,
  authCapabilityStorePath,
  mintAuthInvite,
  mintAuthPasswordReset,
} from "../../src/webapp/auth-capabilities.js";

async function rejectionName(fn: () => Promise<unknown>) {
  try {
    await fn();
    return "no-throw";
  } catch (error) {
    return error instanceof Error ? error.name : String(error);
  }
}

const PACKAGE_ROOT = join(import.meta.dirname, "../..");

async function consumeInChild(token: string) {
  const code = "const { consumeAuthInvite } = await import(\"./src/webapp/auth-capabilities.ts\"); console.log((await consumeAuthInvite({ token: process.env.TEST_INVITE_TOKEN })).status);";
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", code], {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, TEST_INVITE_TOKEN: token },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const codeResult = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (codeResult !== 0) throw new Error(`invite child failed (${codeResult}): ${stderr}`);
  return stdout.trim();
}

// ## Minted tokens are short-lived, hashed, canonical, and mode 0600
void test("Minted tokens are short-lived, hashed, canonical, and mode 0600", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dir, { recursive: true, force: true });
      delete process.env.BBX_AUTH_FILE;
    } catch (error) {
      t.error(error);
    }
  });
  const dir = await mkdtemp(join(tmpdir(), "bbx-invites-"));
  process.env.BBX_AUTH_FILE = join(dir, "auth.json");
  const now = Date.UTC(2026, 7, 6, 12);

  const minted = await mintAuthInvite({
    boxRoot: "/boxes/family",
    createdBy: " Owner@Example.COM ",
    email: " Invitee@Example.COM ",
    now,
  });
  t.check({ email: minted.email, lifetime: minted.expiresAt - now, tokenLength: minted.token.length }, {
    email: "invitee@example.com",
    lifetime: 900000,
    tokenLength: 43,
  });

  // The clear token is absent from disk and the file is private.

  const raw = await readFile(authCapabilityStorePath(), "utf-8");
  t.check({ containsToken: raw.includes(minted.token), mode: ((await stat(authCapabilityStorePath())).mode & 0o777).toString(8) }, {
    containsToken: false,
    mode: "600",
  });

  // Inspection does not consume. Consumption returns trusted stored metadata once.

  t.check(await inspectAuthInvite({ token: minted.token, now: now + 1 }), {
    status: "valid",
    invite: {
      boxRoot: "/boxes/family",
      email: "invitee@example.com",
      createdBy: "owner@example.com",
      expiresAt: 1786018500000,
    },
  });

  t.check(await consumeAuthInvite({ token: minted.token, now: now + 2 }), {
    status: "consumed",
    invite: {
      boxRoot: "/boxes/family",
      email: "invitee@example.com",
      createdBy: "owner@example.com",
      expiresAt: 1786018500000,
    },
  });

  t.check(await consumeAuthInvite({ token: minted.token, now: now + 3 }), { status: "invalid-or-gone" });
});

// ## Expired and malformed capabilities are indistinguishable
void test("Expired and malformed capabilities are indistinguishable", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dir2, { recursive: true, force: true });
      delete process.env.BBX_AUTH_FILE;
    } catch (error) {
      t.error(error);
    }
  });
  const dir2 = await mkdtemp(join(tmpdir(), "bbx-invites-expired-"));
  process.env.BBX_AUTH_FILE = join(dir2, "auth.json");
  const minted2 = await mintAuthInvite({ boxRoot: "/boxes/a", createdBy: "o@example.com", now: 1_000 });

  t.check(await inspectAuthInvite({ token: minted2.token, now: 1_000 + 15 * 60 * 1_000 }), { status: "invalid-or-gone" });

  t.check(await inspectAuthInvite({ token: "not-a-token", now: 1_001 }), { status: "invalid-or-gone" });
});

// ## Corruption and symlinks fail closed
void test("Corruption and symlinks fail closed", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dir3, { recursive: true, force: true });
      delete process.env.BBX_AUTH_FILE;
    } catch (error) {
      t.error(error);
    }
  });
  const dir3 = await mkdtemp(join(tmpdir(), "bbx-invites-bad-"));
  process.env.BBX_AUTH_FILE = join(dir3, "auth.json");
  await writeFile(authCapabilityStorePath(), "{bad json", { mode: 0o600 });

  t.check(await rejectionName(() => inspectAuthInvite({ token: "anything" })), "AuthCapabilityStoreError");

  await rm(authCapabilityStorePath());
  const symlinkTarget = join(dir3, "invite-target.json");
  await writeFile(symlinkTarget, JSON.stringify({ version: 1, invites: [] }), { mode: 0o600 });
  await symlink(symlinkTarget, authCapabilityStorePath());

  t.check(await rejectionName(() => inspectAuthInvite({ token: "anything" })), "AuthCapabilityStoreError");
});

// ## The live-invite cap fails closed
void test("The live-invite cap fails closed", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dir5, { recursive: true, force: true });
      delete process.env.BBX_AUTH_FILE;
    } catch (error) {
      t.error(error);
    }
  });
  const dir5 = await mkdtemp(join(tmpdir(), "bbx-invites-cap-"));
  process.env.BBX_AUTH_FILE = join(dir5, "auth.json");
  for (let index = 0; index < 100; index += 1) {
    await mintAuthInvite({ boxRoot: "/boxes/a", createdBy: "o@example.com" });
  }

  t.check(await rejectionName(() => mintAuthInvite({ boxRoot: "/boxes/a", createdBy: "o@example.com" })), "AuthCapabilityCapacityError");
});

// ## Concurrent consumption has exactly one winner
void test("Concurrent consumption has exactly one winner", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dir4, { recursive: true, force: true });
      delete process.env.BBX_AUTH_FILE;
    } catch (error) {
      t.error(error);
    }
  });
  const dir4 = await mkdtemp(join(tmpdir(), "bbx-invites-race-"));
  process.env.BBX_AUTH_FILE = join(dir4, "auth.json");
  const minted4 = await mintAuthInvite({ boxRoot: "/boxes/a", createdBy: "o@example.com" });
  const raced = await Promise.all([consumeInChild(minted4.token), consumeInChild(minted4.token)]);
  t.check(raced.toSorted().join(","), "consumed,invalid-or-gone");
});

// ## Password resets are typed siblings and replace older links
void test("Password resets are typed siblings and replace older links", async (t) => {
  t.teardown(async () => {
    try {
      await rm(resetDir, { recursive: true, force: true });
      delete process.env.BBX_AUTH_FILE;
    } catch (error) {
      t.error(error);
    }
  });
  const resetDir = await mkdtemp(join(tmpdir(), "bbx-password-resets-"));
  process.env.BBX_AUTH_FILE = join(resetDir, "auth.json");
  const firstReset = await mintAuthPasswordReset({
    boxRoot: "/boxes/family",
    createdBy: "Owner@Example.COM",
    email: "Member@Example.COM",
  });

  t.check(
    {
      email: firstReset.email,
      inviteSeesReset: (await inspectAuthInvite({ token: firstReset.token })).status,
      resetSeesReset: (await inspectAuthPasswordReset({ token: firstReset.token })).status,
    },
    {
    email: "member@example.com",
    inviteSeesReset: "invalid-or-gone",
    resetSeesReset: "valid",
  },
  );

  // Minting a replacement invalidates the older link before capacity is checked.

  for (let index = 0; index < 99; index += 1) {
    await mintAuthInvite({ boxRoot: `/boxes/${String(index)}`, createdBy: "owner@example.com" });
  }
  const replacement = await mintAuthPasswordReset({
    boxRoot: "/boxes/other",
    createdBy: "owner@example.com",
    email: "member@example.com",
  });

  t.check(`${(await inspectAuthPasswordReset({ token: firstReset.token })).status},${(await inspectAuthPasswordReset({ token: replacement.token })).status}`, "invalid-or-gone,valid");

  // Consumption invalidates every reset link for that account and cannot consume an
  // invite token.

  const unrelatedInvite = await consumeAuthInvite({ token: replacement.token });
  const consumedReset = await consumeAuthPasswordReset({ token: replacement.token });
  t.check({ invite: unrelatedInvite.status, reset: consumedReset.status, replay: (await consumeAuthPasswordReset({ token: replacement.token })).status }, {
    invite: "invalid-or-gone",
    reset: "consumed",
    replay: "invalid-or-gone",
  });
});

// ## A v1 invite store upgrades on mutation without losing its invites
void test("A v1 invite store upgrades on mutation without losing its invites", async (t) => {
  t.teardown(async () => {
    try {
      await rm(migrationDir, { recursive: true, force: true });
      delete process.env.BBX_AUTH_FILE;
    } catch (error) {
      t.error(error);
    }
  });
  const migrationDir = await mkdtemp(join(tmpdir(), "bbx-capability-migration-"));
  process.env.BBX_AUTH_FILE = join(migrationDir, "auth.json");
  const legacyToken = "legacy-token";
  const legacyHash = (await import("node:crypto")).createHash("sha256").update(legacyToken).digest("hex");
  await writeFile(authCapabilityStorePath(), JSON.stringify({
    version: 1,
    invites: [{
      tokenHash: legacyHash,
      boxRoot: "/boxes/legacy",
      email: "legacy@example.com",
      createdBy: "owner@example.com",
      createdAt: 1,
      expiresAt: Date.now() + 60_000,
    }],
  }), { mode: 0o600 });

  t.check((await inspectAuthInvite({ token: legacyToken })).status, "valid");

  await mintAuthPasswordReset({ boxRoot: "/boxes/legacy", createdBy: "owner@example.com", email: "legacy@example.com" });
  t.check(JSON.parse(await readFile(authCapabilityStorePath(), "utf-8")).version, 2);

  t.check((await inspectAuthInvite({ token: legacyToken })).status, "valid");
});
