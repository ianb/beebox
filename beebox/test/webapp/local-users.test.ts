// # Local credential store (`local-users.ts`)
//
// The scrypt-hashed username/password store behind `~/.bbx-auth.json`. These are
// pure-function tests: each runs against a throwaway `BBX_AUTH_FILE` in a tmp dir,
// with a small scrypt work factor (`BBX_AUTH_SCRYPT_N`) so the suite stays fast —
// that env var is a test-only seam, inert in every real deployment.

import { test } from "tap";
import "agent-doctest/tap";
import { anything } from "agent-doctest/check";
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFirstUser,
  addInvitedMember,
  addUser,
  verifyPassword,
  setPassword,
  setPasswordWithPasswordHash,
  removeUser,
  listUsers,
  getLocalUser,
  getLocalOwnerEmail,
  isLocalAuthStoreInitialized,
} from "../../src/webapp/local-users.js";
import { hashPassword } from "../../src/webapp/local-users-scrypt.js";
import { AuthFileLockError, AuthStoreUnavailableError } from "../../src/webapp/local-users-errors.js";

// Small work factor keeps scrypt fast in tests (2^14 vs the 2^17 prod default).
process.env.BBX_AUTH_SCRYPT_N = String(2 ** 14);

const dir = await mkdtemp(join(tmpdir(), "bbx-auth-"));
const AUTH_FILE = join(dir, "auth.json");
process.env.BBX_AUTH_FILE = AUTH_FILE;
delete process.env.BBX_OWNER_EMAIL;

// `=> throws` only catches synchronous throws; async calls reject, so assert on
// the rejected error's name instead.
async function rejectName(fn: () => Promise<unknown>) {
  try {
    await fn();
    return "no-throw";
  } catch (e) {
    return e instanceof Error ? e.name : String(e);
  }
}

// ## Create the first user: owner, gen 1, mode 0600, hashed on disk
void test("Create the first user: owner, gen 1, mode 0600, hashed on disk", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dir, { recursive: true, force: true });
      delete process.env.BBX_AUTH_FILE;
      delete process.env.BBX_AUTH_SCRYPT_N;
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L51
  const owner = await createFirstUser({ email: "Boxholder@Example.com", name: "Boxholder", password: "correct horse" });
  t.check(owner, {
    email: "boxholder@example.com",
    name: "Boxholder",
    role: "owner",
    gen: 1,
    created: anything(),
  });

  // Credential lock exhaustion is part of the store-unavailable contract, so every
  // route that already fails closed on an unavailable store also handles it.

  // doctest:L60
  await t.checkText(new AuthFileLockError("/redacted/auth.lock") instanceof AuthStoreUnavailableError, "true");

  // The email is canonicalized (trim + lowercase); the owner email is discoverable.

  // doctest:L67
  t.check(getLocalOwnerEmail(), "boxholder@example.com");

  // The file is 0600, and the plaintext password never appears in it.

  // doctest:L74
  const info = await stat(AUTH_FILE);
  await t.checkText((info.mode & 0o777).toString(8), "600");

  // doctest:L78
  const raw = await import("node:fs/promises").then((fs) => fs.readFile(AUTH_FILE, "utf-8"));
  await t.checkText(raw.includes("correct horse"), "false");

  // ## Verify: right password succeeds, wrong password returns null
  //
  // Email match is case-insensitive; verification returns the public user.

  // doctest:L88
  const ok = await verifyPassword({ email: "  BOXHOLDER@example.com ", password: "correct horse" });
  t.check(ok === null ? "null" : ok.email, "boxholder@example.com");

  // doctest:L92
  t.check(await verifyPassword({ email: "boxholder@example.com", password: "wrong" }), null);

  // An unknown email returns null too (no enumeration — same shape as a bad password).

  // doctest:L99
  t.check(await verifyPassword({ email: "nobody@example.com", password: "correct horse" }), null);

  // ## A second owner creation fails without replacing the first

  // doctest:L106
  t.check(await rejectName(() => createFirstUser({ email: "other@example.com", name: "Other", password: "hunter2" })), "UserExistsError");

  // ## Add a member, then verify and list

  // doctest:L113
  const member = await addUser({ email: "Member@Example.com", name: "Member", password: "s3cret", role: "member" });
  t.check(member.role, "member");

  // doctest:L117
  t.check((await verifyPassword({ email: "member@example.com", password: "s3cret" }))?.role, "member");

  // doctest:L120
  t.check(listUsers().map((u) => `${u.email}:${u.role}`).join(","), "boxholder@example.com:owner,member@example.com:member");

  // Adding a duplicate, or a second owner, is refused.

  // doctest:L127
  t.check(await rejectName(() => addUser({ email: "member@example.com", name: "Dup", password: "x", role: "member" })), "UserExistsError");

  // doctest:L130
  t.check(await rejectName(() => addUser({ email: "second@example.com", name: "Second", password: "x", role: "owner" })), "OwnerExistsError");

  // ## Set password bumps `gen` (revokes outstanding sessions)

  // doctest:L137
  const before = getLocalUser("member@example.com")?.gen;
  const after = (await setPassword({ email: "member@example.com", password: "n3wsecret" })).gen;
  t.check(`${before} -> ${after}`, "1 -> 2");

  // The old password no longer verifies; the new one does.

  // doctest:L146
  t.check(await verifyPassword({ email: "member@example.com", password: "s3cret" }), null);

  // doctest:L149
  t.check((await verifyPassword({ email: "member@example.com", password: "n3wsecret" }))?.gen, 2);

  // The reset flow can do expensive hashing before entering the credential-store
  // lock, while preserving the same generation bump and user metadata.

  // doctest:L157
  const resetHash = await hashPassword("reset-secret");
  const resetUser = await setPasswordWithPasswordHash({ email: " MEMBER@example.com ", scrypt: resetHash });
  t.check({ name: resetUser.name, role: resetUser.role, gen: resetUser.gen }, {
    name: "Member",
    role: "member",
    gen: 3,
  });

  // doctest:L162
  t.check(await verifyPassword({ email: "member@example.com", password: "n3wsecret" }), null);

  // doctest:L165
  t.check((await verifyPassword({ email: "member@example.com", password: "reset-secret" }))?.gen, 3);

  // doctest:L170
  t.check(await rejectName(() => setPassword({ email: "ghost@example.com", password: "x" })), "NoSuchUserError");

  // ## Remove a member; refuse to remove the owner

  // doctest:L177
  await removeUser({ email: "member@example.com" });
  t.check(listUsers().map((u) => u.email).join(","), "boxholder@example.com");

  // doctest:L181
  t.check(await rejectName(() => removeUser({ email: "boxholder@example.com" })), "LastOwnerRemovalError");

  // doctest:L184
  t.check(await rejectName(() => removeUser({ email: "ghost@example.com" })), "NoSuchUserError");

  // ## Rehash-on-verify: a changed work factor transparently rewrites the record
  //
  // The owner was hashed at N=2^14. Lower the current factor to 2^13; a successful
  // verify should rewrite the stored record with the new parameters.

  // doctest:L194
  t.check(getLocalUser("boxholder@example.com") && JSON.parse(raw).users[0].scrypt.N, 16384);

  // doctest:L197
  process.env.BBX_AUTH_SCRYPT_N = String(2 ** 13);
  t.check((await verifyPassword({ email: "boxholder@example.com", password: "correct horse" }))?.email, "boxholder@example.com");

  // doctest:L201
  const rehashed = await import("node:fs/promises").then((fs) => fs.readFile(AUTH_FILE, "utf-8"));
  t.check(JSON.parse(rehashed).users[0].scrypt.N, 8192);

  // `gen` is unchanged by a rehash (it's not a credential change).

  // doctest:L209
  t.check(getLocalUser("boxholder@example.com")?.gen, 1);
});

// ## A corrupt file is a hard failure — never a silent fall-open
void test("A corrupt file is a hard failure — never a silent fall-open", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dir2, { recursive: true, force: true });
      delete process.env.BBX_AUTH_FILE;
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L222
  const dir2 = await mkdtemp(join(tmpdir(), "bbx-auth-bad-"));
  process.env.BBX_AUTH_FILE = join(dir2, "auth.json");

  // doctest:L225
  await writeFile(process.env.BBX_AUTH_FILE, "{ not valid json", { mode: 0o600 });
  await t.checkThrows(async () => (listUsers()), "AuthFileCorruptError");

  // A well-formed-JSON-but-wrong-shape file (here: zero users) is corrupt too — the
  // login path refuses it rather than treating it as an empty store.

  // doctest:L234
  await writeFile(process.env.BBX_AUTH_FILE, JSON.stringify({ version: 2, users: [] }), { mode: 0o600 });
  t.check(await rejectName(() => verifyPassword({ email: "boxholder@example.com", password: "x" })), "AuthFileCorruptError");
});

// ## Missing file is the first-run state, not an error
void test("Missing file is the first-run state, not an error", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dir3, { recursive: true, force: true });
      delete process.env.BBX_AUTH_FILE;
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L247
  const dir3 = await mkdtemp(join(tmpdir(), "bbx-auth-empty-"));
  process.env.BBX_AUTH_FILE = join(dir3, "auth.json");

  // doctest:L250
  await t.checkText(listUsers().length, "0");

  // doctest:L253
  t.check(getLocalOwnerEmail(), null);

  // doctest:L256
  t.check(getLocalUser("anyone@example.com"), null);

  // doctest:L259
  t.check(await verifyPassword({ email: "anyone@example.com", password: "x" }), null);

  // doctest:L262
  t.check(await rejectName(() => addUser({ email: "member@example.com", name: "Member", password: "member-password", role: "member" })), "NoOwnerError");
});

// ## An invited member can initialize the store before a local owner exists
//
// Google-authenticated owners do not need a local password. The first invited
// member can therefore create a valid member-only credential file.
void test("Google-authenticated owners do not need a local password.", async (t) => {
  t.teardown(async () => {
    try {
      await rm(memberFirstDir, { recursive: true, force: true });
      delete process.env.BBX_AUTH_FILE;
      delete process.env.BBX_AUTH_SCRYPT_N;
      delete process.env.BBX_OWNER_EMAIL;
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L277
  const memberFirstDir = await mkdtemp(join(tmpdir(), "bbx-auth-member-first-"));
  process.env.BBX_AUTH_FILE = join(memberFirstDir, "auth.json");
  process.env.BBX_AUTH_SCRYPT_N = String(2 ** 14);
  process.env.BBX_OWNER_EMAIL = "owner@example.com";

  // doctest:L282
  await addInvitedMember({ email: "member@example.com", name: "Member", password: "member-password" });
  t.check({ owner: getLocalOwnerEmail(), users: listUsers().map((user) => `${user.email}:${user.role}`) }, {
    owner: null,
    users: [
      "member@example.com:member",
    ],
  });

  // Removing the only member keeps an empty credential-store tombstone. First-run
  // setup must not reopen after local auth has been initialized once.

  // doctest:L291
  await removeUser({ email: "member@example.com" });
  await t.checkText(listUsers().length, "0");

  // doctest:L295
  t.check({ file: await stat(process.env.BBX_AUTH_FILE).then(() => "exists"), initialized: isLocalAuthStoreInitialized() }, {
    file: "exists",
    initialized: true,
  });

  // The CLI owner-creation path can add the configured owner after members exist.

  // doctest:L302
  await addInvitedMember({ email: "member@example.com", name: "Member", password: "member-password" });
  const laterOwner = await createFirstUser({ email: "owner@example.com", name: "Owner", password: "owner-password" });
  t.check(laterOwner.role, "owner");

  // doctest:L307
  t.check(listUsers().map((user) => user.role).toSorted().join(","), "member,owner");
});

// ## Concurrent first owner and first member creation preserve both accounts
//
// Both initialization paths share the credential-file lock. Either operation can
// win, but neither can overwrite the other.
void test("Both initialization paths share the credential-file lock.", async (t) => {
  t.teardown(async () => {
    try {
      await rm(raceDir, { recursive: true, force: true });
      delete process.env.BBX_AUTH_FILE;
      delete process.env.BBX_AUTH_SCRYPT_N;
      delete process.env.BBX_OWNER_EMAIL;
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L324
  const raceDir = await mkdtemp(join(tmpdir(), "bbx-auth-first-race-"));
  process.env.BBX_AUTH_FILE = join(raceDir, "auth.json");
  process.env.BBX_AUTH_SCRYPT_N = String(2 ** 12);
  process.env.BBX_OWNER_EMAIL = "owner@example.com";

  // doctest:L329
  const raceResults = await Promise.allSettled([
    createFirstUser({ email: "owner@example.com", name: "Owner", password: "owner-password" }),
    addInvitedMember({ email: "member@example.com", name: "Member", password: "member-password" }),
  ]);
  t.check({ results: raceResults.map((result) => result.status), users: listUsers().map((user) => user.role).toSorted() }, {
    results: [
      "fulfilled",
      "fulfilled",
    ],
    users: [
      "member",
      "owner",
    ],
  });
});

// ## `BBX_OWNER_EMAIL` pins the first owner's identity
void test("`BBX_OWNER_EMAIL` pins the first owner's identity", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dir4, { recursive: true, force: true });
      delete process.env.BBX_AUTH_FILE;
      delete process.env.BBX_AUTH_SCRYPT_N;
      delete process.env.BBX_OWNER_EMAIL;
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L347
  const dir4 = await mkdtemp(join(tmpdir(), "bbx-auth-owner-"));
  process.env.BBX_AUTH_FILE = join(dir4, "auth.json");
  process.env.BBX_AUTH_SCRYPT_N = String(2 ** 14);
  process.env.BBX_OWNER_EMAIL = "configured@example.com";

  // doctest:L352
  t.check(await rejectName(() => createFirstUser({ email: "someone-else@example.com", name: "X", password: "p" })), "OwnerEmailMismatchError");

  // A matching (case-insensitively) email is accepted.

  // doctest:L359
  const owner = await createFirstUser({ email: "Configured@Example.com", name: "Cfg", password: "p" });
  t.check(owner.email, "configured@example.com");
});
