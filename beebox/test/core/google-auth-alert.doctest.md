# Proactive "Google connection needs re-authorization" alert

`checkGoogleAuthAndAlert` runs from the scheduler daemon beside the
scheduled-task health alert. It refreshes the verdict (the ~daily probe, skipped
here since the state is already fresh), then sends exactly one notification per
breakage episode with a link to the admin page's Google Services section.

No re-nag: the condition also holds a permanent dashboard warning and a
`bbx health` line. See `docs/plans/google-auth-reauth-health.md`.

```ts setup
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { createFakeTelegram } from "../../src/services/telegram.js";
import { checkGoogleAuthAndAlert } from "../../src/core/schedule/google-auth-alert.js";
import { saveGoogleTokens, markGoogleAuthDead } from "../../src/connectors/google-token-store.js";

// Isolate the server-level push store so the push channel is deterministically
// absent (telegram-only) in this test.
process.env.BBX_PUSH_STORE_DIR = path.join(os.tmpdir(), `bbx-push-gauth-${process.pid}-${Date.now()}`);
process.env.BBX_GOOGLE_TOKENS_FILE = path.join(
  await mkdtemp(path.join(os.tmpdir(), "gauth-alert-")),
  "google-tokens.json",
);
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";

const NOW = new Date("2026-07-28T12:00:00Z");

async function optIn(box) {
  await box.seed("config/box.json", JSON.stringify({
    healthAlerts: { telegramChat: "777" },
  }));
  await box.seed("config/connectors/telegram.secret.json", JSON.stringify({
    botToken: "fake:token", webhookSecret: "s",
  }));
}
```

## A live grant says nothing

```ts
const box = await makeTmpBox({ git: true });
await optIn(box);
box.commitAll("seed");
await saveGoogleTokens({ refreshToken: "rt-1", accessToken: "at-1" });

await checkGoogleAuthAndAlert(box.root, { now: NOW, tg: createFakeTelegram({ username: "bot" }) })
=> null
```

## A dead grant alerts once, with the reconnect link

```ts continue
await markGoogleAuthDead({ reason: "Token has been expired or revoked." });

const tg = createFakeTelegram({ username: "bot" });
const alert = await checkGoogleAuthAndAlert(box.root, { now: NOW, tg });
JSON.stringify({ delivered: alert.delivered, hasSince: alert.alertedForSince !== null })
=> {"delivered":true,"hasSince":true}

tg.sent[0].text
=> Google connection needs re-authorization («*»)
Your Google connection stopped working — the authorization expired or was revoked.
Gmail, Calendar and Drive sync are paused until you reconnect.
«blankline»
Reconnect: /«*»/admin?reconnect=google
```

The episode is latched, so the next daemon cycle stays quiet:

```ts continue
await checkGoogleAuthAndAlert(box.root, { now: NOW, tg })
=> null

tg.sent.length
=> 1
```

## Reconnecting clears the latch, so a relapse alerts again

```ts continue
await saveGoogleTokens({ refreshToken: "rt-2", accessToken: "at-2" });
await checkGoogleAuthAndAlert(box.root, { now: NOW, tg })
=> null

await markGoogleAuthDead({ reason: "revoked again" });
const relapse = await checkGoogleAuthAndAlert(box.root, { now: NOW, tg });
JSON.stringify({ delivered: relapse.delivered, messages: tg.sent.length })
=> {"delivered":true,"messages":2}
```

## No reachable channel, no alert

A box with no Telegram chat and no subscribed push device has nowhere to send —
the dashboard warning and `bbx health` still carry the condition.

```ts continue
const quiet = await makeTmpBox({ git: true });
quiet.commitAll("seed");
await checkGoogleAuthAndAlert(quiet.root, { now: NOW, tg })
=> null
```

```ts cleanup
await box.cleanup();
await quiet.cleanup();
delete process.env.BBX_GOOGLE_TOKENS_FILE;
delete process.env.GOOGLE_OAUTH_CLIENT_ID;
delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
```
