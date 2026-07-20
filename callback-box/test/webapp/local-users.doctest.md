# Local credential store (`local-users.ts`)

The scrypt-hashed username/password store behind `~/.cb-auth.json`. These are
pure-function tests: each runs against a throwaway `CB_AUTH_FILE` in a tmp dir,
with a small scrypt work factor (`CB_AUTH_SCRYPT_N`) so the suite stays fast —
that env var is a test-only seam, inert in every real deployment.

```ts setup
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFirstUser,
  addUser,
  verifyPassword,
  setPassword,
  removeUser,
  listUsers,
  getLocalUser,
  getLocalOwnerEmail,
} from "../../src/webapp/local-users.js";

// Small work factor keeps scrypt fast in tests (2^14 vs the 2^17 prod default).
process.env.CB_AUTH_SCRYPT_N = String(2 ** 14);

const dir = await mkdtemp(join(tmpdir(), "cb-auth-"));
process.env.CB_AUTH_FILE = join(dir, "auth.json");
delete process.env.CB_OWNER_EMAIL;

// `=> throws` only catches synchronous throws; async calls reject, so assert on
// the rejected error's name instead.
async function rejectName(fn) {
  try {
    await fn();
    return "no-throw";
  } catch (e) {
    return e.name;
  }
}
```

## Create the first user: owner, gen 1, mode 0600, hashed on disk

```ts
const owner = await createFirstUser({ email: "Boxholder@Example.com", name: "Boxholder", password: "correct horse" });
JSON.stringify(owner)
=> {"email":"boxholder@example.com","name":"Boxholder","role":"owner","gen":1,"created":«*»}
```

The email is canonicalized (trim + lowercase); the owner email is discoverable.

```ts continue
getLocalOwnerEmail()
=> boxholder@example.com
```

The file is 0600, and the plaintext password never appears in it.

```ts continue
const info = await stat(process.env.CB_AUTH_FILE);
(info.mode & 0o777).toString(8)
=> 600

const raw = await import("node:fs/promises").then((fs) => fs.readFile(process.env.CB_AUTH_FILE, "utf-8"));
raw.includes("correct horse")
=> false
```

## Verify: right password succeeds, wrong password returns null

Email match is case-insensitive; verification returns the public user.

```ts continue
const ok = await verifyPassword({ email: "  BOXHOLDER@example.com ", password: "correct horse" });
ok === null ? "null" : ok.email
=> boxholder@example.com

await verifyPassword({ email: "boxholder@example.com", password: "wrong" })
=> null
```

An unknown email returns null too (no enumeration — same shape as a bad password).

```ts continue
await verifyPassword({ email: "nobody@example.com", password: "correct horse" })
=> null
```

## A second create fails (O_EXCL — first writer wins)

```ts continue
await rejectName(() => createFirstUser({ email: "other@example.com", name: "Other", password: "hunter2" }))
=> UserExistsError
```

## Add a member, then verify and list

```ts continue
const member = await addUser({ email: "Member@Example.com", name: "Member", password: "s3cret", role: "member" });
member.role
=> member

(await verifyPassword({ email: "member@example.com", password: "s3cret" }))?.role
=> member

listUsers().map((u) => `${u.email}:${u.role}`).join(",")
=> boxholder@example.com:owner,member@example.com:member
```

Adding a duplicate, or a second owner, is refused.

```ts continue
await rejectName(() => addUser({ email: "member@example.com", name: "Dup", password: "x", role: "member" }))
=> UserExistsError

await rejectName(() => addUser({ email: "second@example.com", name: "Second", password: "x", role: "owner" }))
=> OwnerExistsError
```

## Set password bumps `gen` (revokes outstanding sessions)

```ts continue
const before = getLocalUser("member@example.com").gen;
const after = (await setPassword({ email: "member@example.com", password: "n3wsecret" })).gen;
`${before} -> ${after}`
=> 1 -> 2
```

The old password no longer verifies; the new one does.

```ts continue
await verifyPassword({ email: "member@example.com", password: "s3cret" })
=> null

(await verifyPassword({ email: "member@example.com", password: "n3wsecret" }))?.gen
=> 2

await rejectName(() => setPassword({ email: "ghost@example.com", password: "x" }))
=> NoSuchUserError
```

## Remove a member; refuse to remove the owner

```ts continue
await removeUser({ email: "member@example.com" });
listUsers().map((u) => u.email).join(",")
=> boxholder@example.com

await rejectName(() => removeUser({ email: "boxholder@example.com" }))
=> LastOwnerRemovalError

await rejectName(() => removeUser({ email: "ghost@example.com" }))
=> NoSuchUserError
```

## Rehash-on-verify: a changed work factor transparently rewrites the record

The owner was hashed at N=2^14. Lower the current factor to 2^13; a successful
verify should rewrite the stored record with the new parameters.

```ts continue
getLocalUser("boxholder@example.com") && JSON.parse(raw).users[0].scrypt.N
=> 16384

process.env.CB_AUTH_SCRYPT_N = String(2 ** 13);
(await verifyPassword({ email: "boxholder@example.com", password: "correct horse" }))?.email
=> boxholder@example.com

const rehashed = await import("node:fs/promises").then((fs) => fs.readFile(process.env.CB_AUTH_FILE, "utf-8"));
JSON.parse(rehashed).users[0].scrypt.N
=> 8192
```

`gen` is unchanged by a rehash (it's not a credential change).

```ts continue
getLocalUser("boxholder@example.com").gen
=> 1
```

```ts cleanup
await rm(dir, { recursive: true, force: true });
delete process.env.CB_AUTH_FILE;
delete process.env.CB_AUTH_SCRYPT_N;
```

## A corrupt file is a hard failure — never a silent fall-open

```ts
const dir2 = await mkdtemp(join(tmpdir(), "cb-auth-bad-"));
process.env.CB_AUTH_FILE = join(dir2, "auth.json");

await writeFile(process.env.CB_AUTH_FILE, "{ not valid json", { mode: 0o600 });
listUsers()
=> throws AuthFileCorruptError
```

A well-formed-JSON-but-wrong-shape file (here: zero owners) is corrupt too —
the login path refuses it rather than treating it as an empty store.

```ts continue
await writeFile(process.env.CB_AUTH_FILE, JSON.stringify({ version: 1, users: [] }), { mode: 0o600 });
await rejectName(() => verifyPassword({ email: "boxholder@example.com", password: "x" }))
=> AuthFileCorruptError
```

```ts cleanup
await rm(dir2, { recursive: true, force: true });
delete process.env.CB_AUTH_FILE;
```

## Missing file is the first-run state, not an error

```ts
const dir3 = await mkdtemp(join(tmpdir(), "cb-auth-empty-"));
process.env.CB_AUTH_FILE = join(dir3, "auth.json");

listUsers().length
=> 0

getLocalOwnerEmail()
=> null

getLocalUser("anyone@example.com")
=> null

await verifyPassword({ email: "anyone@example.com", password: "x" })
=> null
```

```ts cleanup
await rm(dir3, { recursive: true, force: true });
delete process.env.CB_AUTH_FILE;
```

## `CB_OWNER_EMAIL` pins the first owner's identity

```ts
const dir4 = await mkdtemp(join(tmpdir(), "cb-auth-owner-"));
process.env.CB_AUTH_FILE = join(dir4, "auth.json");
process.env.CB_AUTH_SCRYPT_N = String(2 ** 14);
process.env.CB_OWNER_EMAIL = "configured@example.com";

await rejectName(() => createFirstUser({ email: "someone-else@example.com", name: "X", password: "p" }))
=> OwnerEmailMismatchError
```

A matching (case-insensitively) email is accepted.

```ts continue
const owner = await createFirstUser({ email: "Configured@Example.com", name: "Cfg", password: "p" });
owner.email
=> configured@example.com
```

```ts cleanup
await rm(dir4, { recursive: true, force: true });
delete process.env.CB_AUTH_FILE;
delete process.env.CB_AUTH_SCRYPT_N;
delete process.env.CB_OWNER_EMAIL;
```
