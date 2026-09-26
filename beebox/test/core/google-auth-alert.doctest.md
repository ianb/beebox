# Google grant refresh and breakage episodes

`refreshGoogleAuth` runs from the scheduler daemon after each box's tick. It
refreshes the verdict (the ~daily probe, skipped here since the state is
already fresh) and records each breakage episode once, for the scheduler log.
A dead grant is the `google-auth` health check with the reconnect link; it
never notifies on its own (docs/plans/notifications.md, Track E). See
`docs/plans/google-auth-reauth-health.md`.

```ts setup
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { refreshGoogleAuth } from "../../src/core/schedule/google-auth-alert.js";
import { readRecent } from "../../src/core/notification/log.js";
import { saveGoogleTokens, markGoogleAuthDead } from "../../src/connectors/google-token-store.js";

process.env.BBX_GOOGLE_TOKENS_FILE = path.join(
  await mkdtemp(path.join(os.tmpdir(), "gauth-alert-")),
  "google-tokens.json",
);
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";

const NOW = new Date("2026-07-28T12:00:00Z");
```

## A live grant records nothing

```ts
const box = await makeTmpBox({ git: true });
box.commitAll("seed");
await saveGoogleTokens({ refreshToken: "rt-1", accessToken: "at-1" });

await refreshGoogleAuth(box.root, { now: NOW })
=> null
```

## A dead grant is one episode, and sends nothing

```ts continue
await markGoogleAuthDead({ reason: "Token has been expired or revoked." });

(await refreshGoogleAuth(box.root, { now: NOW }))?.since !== undefined
=> true

await refreshGoogleAuth(box.root, { now: NOW })
=> null

(await readRecent(box.root, { days: 1, now: NOW })).length
=> 0
```

## Reconnecting clears the latch, so a relapse is a new episode

```ts continue
await saveGoogleTokens({ refreshToken: "rt-2", accessToken: "at-2" });
await refreshGoogleAuth(box.root, { now: NOW })
=> null

await markGoogleAuthDead({ reason: "revoked again" });
(await refreshGoogleAuth(box.root, { now: NOW }))?.since !== undefined
=> true
```

```ts cleanup
await box.cleanup();
delete process.env.BBX_GOOGLE_TOKENS_FILE;
delete process.env.GOOGLE_OAUTH_CLIENT_ID;
delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
```
