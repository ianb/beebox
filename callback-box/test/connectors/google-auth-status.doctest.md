# Dead Google grant: detection and state

A BYO operator's Google OAuth grant can expire (7 days, in Testing mode) or be
revoked. Google says so with `invalid_grant` on token refresh — the one signal
we treat as auth-dead, because access tokens live an hour so a dead refresh
token surfaces there within the hour no matter which connector runs first.

The state lives with the credential (`google-token-store.ts`), not in
per-connector state: one refresh token is shared by gmail/calendar/drive across
every box on the server. See `docs/plans/google-auth-reauth-health.md`.

```ts setup
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  isInvalidGrantError,
  classifyRefreshFailure,
  readGoogleAuthStatus,
} from "../../src/connectors/google-auth-status.js";
import { saveGoogleTokens, markGoogleAuthDead } from "../../src/connectors/google-token-store.js";

const tmp = await mkdtemp(path.join(os.tmpdir(), "google-auth-status-"));
process.env.CB_GOOGLE_TOKENS_FILE = path.join(tmp, "google-tokens.json");
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";

/** Run `fn`, returning whatever it throws instead of propagating. */
async function tryCall(fn) {
  try {
    return await fn();
  } catch (e) {
    return e;
  }
}

/** A GaxiosError-shaped rejection, the way google-auth-library v10 throws it. */
function gaxiosError(message, data) {
  const e = new Error(message);
  if (data) e.response = { data };
  return e;
}
```

## Only `invalid_grant` counts as a dead grant

The structured `response.data.error` is the primary signal; the ReAuth variant
replaces `message` with the JSON of that same payload, so a message match is the
fallback. Everything else is transient and must NOT flip the state — a network
blip that told the boxholder to go re-authorize would be worse than silence.

```ts
isInvalidGrantError(gaxiosError("invalid_grant", { error: "invalid_grant" }))
=> true

// ReAuth variant: message is the stringified payload.
isInvalidGrantError(gaxiosError('{"error":"invalid_grant","error_description":"ReAuth required"}'))
=> true

isInvalidGrantError(gaxiosError("connect ETIMEDOUT"))
=> false

isInvalidGrantError(gaxiosError("Service Unavailable", { error: "backendError" }))
=> false

isInvalidGrantError(undefined)
=> false
```

## A transient failure is classified as "not our problem" and left alone

```ts
const transient = await classifyRefreshFailure(gaxiosError("connect ETIMEDOUT"), {});
transient
=> null

const untouched = await readGoogleAuthStatus();
JSON.stringify({ needsReauthSince: untouched.needsReauthSince, connected: untouched.connected })
=> {"needsReauthSince":null,"connected":false}
```

## An `invalid_grant` records the breakage and returns a typed error

```ts continue
await saveGoogleTokens({ refreshToken: "rt-1", accessToken: "at-1" });

const expired = await classifyRefreshFailure(
  gaxiosError("invalid_grant", { error: "invalid_grant", error_description: "Token has been expired or revoked." }),
  {},
);
expired.name
=> GoogleAuthExpiredError

const dead = await readGoogleAuthStatus();
JSON.stringify({ configured: dead.configured, connected: dead.connected, broken: dead.needsReauthSince !== null })
=> {"configured":true,"connected":true,"broken":true}
```

## Re-marking preserves when the breakage started

Every failing sync re-marks, but the health message and the notification latch
both key on *when it broke* — so the original timestamp has to survive.

```ts continue
const firstSince = dead.needsReauthSince;
await markGoogleAuthDead({ reason: "a later failure" });
const again = await readGoogleAuthStatus();
JSON.stringify({ sameSince: again.needsReauthSince === firstSince, reason: again.reauthReason })
=> {"sameSince":true,"reason":"a later failure"}
```

## A fresh token clears the state — repair can't be forgotten

A new refresh or access token only ever reaches disk through `saveGoogleTokens`,
so clearing happens structurally rather than at each call site that might
remember to do it.

```ts continue
await saveGoogleTokens({ refreshToken: "rt-2", accessToken: "at-2" });
const repaired = await readGoogleAuthStatus();
JSON.stringify({
  broken: repaired.needsReauthSince !== null,
  reason: repaired.reauthReason,
  verified: repaired.authCheckedAt !== null,
})
=> {"broken":false,"reason":null,"verified":true}
```

A write that carries no token (a bare expiry touch-up) leaves the state as it
found it — only proof the grant works may clear it:

```ts continue
await markGoogleAuthDead({ reason: "broken again" });
await saveGoogleTokens({ tokenExpiry: "2026-07-28T00:00:00.000Z" });
const stillBroken = await readGoogleAuthStatus();
stillBroken.needsReauthSince !== null
=> true
```

The flag is stored beside the credential it describes, so it travels with the
token file rather than living in any one box:

```ts continue
const onDisk = JSON.parse(await readFile(process.env.CB_GOOGLE_TOKENS_FILE, "utf-8"));
JSON.stringify(Object.keys(onDisk).sort())
=> ["accessToken","authCheckedAt","needsReauthSince","reauthReason","refreshToken","tokenExpiry"]
```

## A corrupt token file fails the write closed, it is not rewritten

The store is a read-modify-write, and a partial file — a crash mid-write, before
this store wrote atomically — used to fall through to `{}`. The next token
update then rewrote the file from that empty base, wiping the one refresh token
shared by gmail, calendar, and drive across every box on the server. There is no
safe automatic recovery, so the write refuses and the bytes stay for a human.

```ts continue
await writeFile(process.env.CB_GOOGLE_TOKENS_FILE, '{"refreshToken": "trun');
const failure = await tryCall(() => saveGoogleTokens({ accessToken: "fresh" }));
print(`error: ${failure.name}`);
print(`onDisk: ${await readFile(process.env.CB_GOOGLE_TOKENS_FILE, "utf-8")}`);
=>
error: GoogleTokenStoreCorruptError
onDisk: {"refreshToken": "trun
```

A genuinely absent file is the legitimate first run, and still starts fresh.

```ts continue
await rm(process.env.CB_GOOGLE_TOKENS_FILE, { force: true });
await saveGoogleTokens({ refreshToken: "first-ever" });
JSON.parse(await readFile(process.env.CB_GOOGLE_TOKENS_FILE, "utf-8")).refreshToken
=> first-ever
```

Writes land by temp file + fsync + atomic rename, so that truncated state can no
longer be produced in the first place — and no temp sibling is left behind.

```ts continue
(await readdir(tmp)).sort().join(",")
=> google-tokens.json
```

```ts cleanup
delete process.env.CB_GOOGLE_TOKENS_FILE;
delete process.env.GOOGLE_OAUTH_CLIENT_ID;
delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
await rm(tmp, { recursive: true, force: true });
```
