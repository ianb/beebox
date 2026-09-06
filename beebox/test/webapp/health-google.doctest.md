# `google-auth` health check

A dead Google grant used to surface only as a generic connector sync failure in
the logs. `googleAuthHealthChecks` turns it into a typed condition carrying the
one action that fixes it. It is a pure reader of the state in
`connectors/google-auth-status.ts` — the refresh probe that keeps that state
fresh runs about daily from the scheduler, so health queries stay cheap.

See `docs/plans/google-auth-reauth-health.md`.

```ts setup
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { googleAuthHealthChecks } from "../../src/webapp/trpc/routers/health-google.js";
import { saveGoogleTokens, markGoogleAuthDead } from "../../src/connectors/google-token-store.js";
import { grantSecret, setSecret } from "../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../src/lib/box-slug.js";

const tmp = await mkdtemp(path.join(os.tmpdir(), "health-google-"));
process.env.BBX_GOOGLE_TOKENS_FILE = path.join(tmp, "google-tokens.json");

const CLIENT_SECRET_NAMES = ["google-oauth-client-id", "google-oauth-client-secret"];

/** Configure the OAuth app's client credentials for `tmp`: a per-box grant. */
async function configureGoogle() {
  const slug = await boxSlug(tmp);
  for (const name of CLIENT_SECRET_NAMES) {
    await setSecret({ name, value: `placeholder-${name}` });
    await grantSecret({ slug, name, access: "server" });
  }
}

const NOW = new Date("2026-07-28T12:00:00Z");
const describe = (checks) =>
  JSON.stringify(checks.map((c) => ({ name: c.name, ok: c.ok, severity: c.severity })));
```

## Google unconfigured, or configured but never connected: no check at all

Neither is a problem, and a permanent "not connected" line would be noise on
every box that doesn't use Google.

```ts
// No grants at all yet.
describe(await googleAuthHealthChecks(tmp, { now: NOW }))
=> []

// Configured — the box holds the client-credential grants — but no Google
// authorization has ever been stored.
await configureGoogle();
describe(await googleAuthHealthChecks(tmp, { now: NOW }))
=> []
```

## A live grant reports how recently it was verified

```ts continue
await saveGoogleTokens({ refreshToken: "rt-1", accessToken: "at-1", }, { boxRoot: tmp });
const live = await googleAuthHealthChecks(tmp, { now: NOW });
describe(live)
=> [{"name":"google-auth","ok":true,"severity":"warning"}]

live[0].message
=> Google authorization is live (last verified «*» ago)
```

## A dead grant is a warning naming the breakage, the impact, and the fix

Severity is `warning`, not `error`: Google features pause, but the box keeps
working — and a dead grant must not flip `bbx health`'s exit code for scripts
gating on "is this box broken".

```ts continue
await markGoogleAuthDead({ boxRoot: tmp, reason: "Token has been expired or revoked." });
const dead = await googleAuthHealthChecks(tmp, { now: NOW });
describe(dead)
=> [{"name":"google-auth","ok":false,"severity":"warning"}]

dead[0].message
=> Google authorization expired or was revoked «*» ago (Token has been expired or revoked.) — Gmail, Calendar and Drive sync are paused. Reconnect at /«*»/admin?reconnect=google
```

The link points at the admin page's Google Services section rather than a
one-click reconnect: `googleSetup` is owner-gated and mints a one-time nonce, so
a static link in an outbound message can't carry a valid one.

## Reconnecting flips it back

```ts continue
await saveGoogleTokens({ refreshToken: "rt-2", accessToken: "at-2" }, { boxRoot: tmp });
describe(await googleAuthHealthChecks(tmp, { now: NOW }))
=> [{"name":"google-auth","ok":true,"severity":"warning"}]
```

```ts cleanup
delete process.env.BBX_GOOGLE_TOKENS_FILE;
delete process.env.GOOGLE_OAUTH_CLIENT_ID;
delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
await rm(tmp, { recursive: true, force: true });
```
