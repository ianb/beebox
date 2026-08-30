# Box-aware identity: the browse key becomes the owner only where a box says so

`resolveBoxIdentity` (`src/webapp/box-identity.ts`) is `resolveRequestIdentity`
plus one rung: the machine-wide browse key (`BBX_BROWSE_API_KEY`), on a box whose
`config/box.json` declares `agentBrowsing: "owner"`, resolves to the box owner's
identity with `source: "browse"`. Everywhere else the key keeps its old meaning
— it clears the auth wall and is nobody.

Three facts must all hold for the rung to fire: a valid key, the box's own
opt-in, and an owner to act as. Each row below removes one of them.

```ts setup
import * as os from "node:os";
import * as path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { resolveBoxIdentity } from "../../src/webapp/box-identity.js";
import { COOKIE_NAME, signSession } from "../../src/webapp/auth.js";
import { createFirstUser } from "../../src/webapp/local-users.js";
import { resetLocalUserCache } from "../../src/webapp/local-users-cache.js";

const KEY = "browse-key-for-box-identity-doctest";

// Snapshot every variable this test writes, so it neither inherits an ambient
// value nor leaks one into whatever runs next in this process.
const ENV_KEYS = ["BBX_BROWSE_API_KEY", "BBX_OWNER_EMAIL", "BBX_AUTH_FILE", "BBX_AUTH_SCRYPT_N", "BBX_SESSION_SECRET", "BBX_HUB_SECRET"];
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

process.env.BBX_BROWSE_API_KEY = KEY;
process.env.BBX_OWNER_EMAIL = "owner@example.com";
process.env.BBX_AUTH_SCRYPT_N = "1024";
process.env.BBX_SESSION_SECRET = "test-session-secret-for-box-identity-doctest";
delete process.env.BBX_HUB_SECRET; // standalone (non-hub)

// The local user store is GLOBAL (~/.bbx-auth.json) — point it somewhere
// disposable before anything reads or writes it.
const authDir = await mkdtemp(path.join(os.tmpdir(), "bbx-box-identity-"));
process.env.BBX_AUTH_FILE = path.join(authDir, "auth.json");
await createFirstUser({ email: "owner@example.com", name: "Owner", password: "pw-correct-1" });
resetLocalUserCache();

const withKey = { headers: { authorization: `Bearer ${KEY}` } };
const noKey = { headers: {} };

/** Write the box's opt-in field (any value, so a bad one can be tested too). */
async function setAgentBrowsing(box, value) {
  await mkdir(path.join(box.root, "config"), { recursive: true });
  await writeFile(path.join(box.root, "config", "box.json"), JSON.stringify({ agentBrowsing: value }));
}
```

## The key on an opted-in box is the owner

The name comes from the local user record, so an attributed chat message reads
as the boxholder rather than as an email string.

```ts
const optedIn = await makeTmpBox();
await setAgentBrowsing(optedIn, "owner");

JSON.stringify(await resolveBoxIdentity({ boxRoot: optedIn.root, request: withKey, openAccess: false }))
=> {"email":"owner@example.com","name":"Owner","source":"browse"}
```

## The same key on a box that never opted in is nobody

This is the fence: one key reaches every box the dev router serves, so a box a
person actually uses must not hand it an identity just because the key is set on
the machine.

```ts continue
const plainBox = await makeTmpBox();

JSON.stringify(await resolveBoxIdentity({ boxRoot: plainBox.root, request: withKey, openAccess: false }))
=> {"email":null,"name":null,"source":null}
```

## The field without the key grants nothing

The opt-in is not a credential — it only says what a credential means here.

```ts continue
JSON.stringify(await resolveBoxIdentity({ boxRoot: optedIn.root, request: noKey, openAccess: false }))
=> {"email":null,"name":null,"source":null}
```

## A bad value is treated as absent, and warned once per box

`config/box.json` is disk: the value is read as `=== "owner"`, and anything else
is a hand-edit mistake that must fail closed rather than be guessed at. The warn
names the box and the value, and fires once however many requests arrive.

```ts continue
const badBox = await makeTmpBox();
await setAgentBrowsing(badBox, "yes");
const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => { warnings.push(args.map(String).join(" ")); };
const first = await resolveBoxIdentity({ boxRoot: badBox.root, request: withKey, openAccess: false });
await resolveBoxIdentity({ boxRoot: badBox.root, request: withKey, openAccess: false });
console.warn = originalWarn;

print(JSON.stringify(first));
print(`warned ${warnings.length}x, names the box and the value: ${warnings[0].includes(badBox.root) && warnings[0].includes('"yes"')}`);
=>
{"email":null,"name":null,"source":null}
warned 1x, names the box and the value: true
```

## An opted-in box with no owner to act as stays unauthenticated

The rung binds the key to a real person; with no owner there is nobody to be, so
the request keeps the identity it had (a 401 at the gate) and the box is named in
a warning.

```ts continue
const ownerless = await makeTmpBox();
await setAgentBrowsing(ownerless, "owner");
delete process.env.BBX_OWNER_EMAIL;
process.env.BBX_AUTH_FILE = path.join(authDir, "no-such-auth.json");
resetLocalUserCache();
const noOwnerWarnings = [];
const warnBefore = console.warn;
console.warn = (...args) => { noOwnerWarnings.push(args.map(String).join(" ")); };
const ownerlessIdentity = await resolveBoxIdentity({ boxRoot: ownerless.root, request: withKey, openAccess: false });
console.warn = warnBefore;
process.env.BBX_OWNER_EMAIL = "owner@example.com";
process.env.BBX_AUTH_FILE = path.join(authDir, "auth.json");
resetLocalUserCache();

print(JSON.stringify(ownerlessIdentity));
print(`warned about the box: ${noOwnerWarnings.length === 1 && noOwnerWarnings[0].includes(ownerless.root)}`);
=>
{"email":null,"name":null,"source":null}
warned about the box: true
```

## A real signed-in identity wins over the rung

The key never overrides a person: a request carrying both a session cookie and
the key is the cookie's owner, `source: "cookie"`, so nothing about who acted is
blurred by which credentials happened to ride along.

```ts continue
const cookie = signSession({ email: "owner@example.com", name: "Owner" });
const both = { headers: { authorization: `Bearer ${KEY}` }, cookies: { [COOKIE_NAME]: cookie } };

JSON.stringify(await resolveBoxIdentity({ boxRoot: optedIn.root, request: both, openAccess: false }))
=> {"email":"owner@example.com","name":"Owner","source":"cookie"}
```

## `open` is returned as-is

An open-access box has no wall to clear; the rung must not turn its ambient
openness into a named person.

```ts continue
JSON.stringify(await resolveBoxIdentity({ boxRoot: optedIn.root, request: withKey, openAccess: true }))
=> {"email":null,"name":null,"source":"open"}
```

## A corrupt credential store is never masked by the key

`source: "unavailable"` is the fail-closed outcome that answers 503 — the store
is unreadable, so the cookie's revocation generation can't be verified. The key
must not overwrite that with a cheerful owner identity: the whole point of the
distinct source is that a store outage does not silently downgrade to "no
session" (Track D, `webapp/auth.ts`).

A key-only request never reaches cookie verification, so it cannot produce
`unavailable` at all — the case that exists is a request carrying both, which is
the one below.

```ts continue
await writeFile(path.join(authDir, "auth.json"), "{not json at all");
resetLocalUserCache();
// The resolver logs the outage loudly (once per process) — captured here so the
// deliberate diagnostic doesn't read as test-run noise.
const errors = [];
const originalError = console.error;
console.error = (...args) => { errors.push(args.map(String).join(" ")); };
const corrupt = await resolveBoxIdentity({ boxRoot: optedIn.root, request: both, openAccess: false });
console.error = originalError;

print(JSON.stringify(corrupt));
print(`logged the outage: ${errors.length === 1 && errors[0].includes("auth store unavailable")}`);
=>
{"email":null,"name":null,"source":"unavailable"}
logged the outage: true
```

```ts cleanup
await optedIn.cleanup();
await plainBox.cleanup();
await badBox.cleanup();
await ownerless.cleanup();
await rm(authDir, { recursive: true, force: true });
restoreEnv();
resetLocalUserCache();
```
