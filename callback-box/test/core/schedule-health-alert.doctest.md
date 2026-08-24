# Proactive schedule-health alerts

`checkHealthAndAlert` is run by the scheduler daemon after each box's
tick. It needs a reachable channel (`healthAlerts.telegramChat` and/or a
subscribed push device), fans out one aggregated alert per batch of
newly-unhealthy tasks via notifyBoxholder, flushes it immediately, and
latches each task so the same unhealthy episode never alerts twice. A
successful run clears the latch (via `recordOutcome`), re-arming alerts
for a relapse.

```ts setup
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { createFakeTelegram } from "../../src/services/telegram.js";
import { checkHealthAndAlert } from "../../src/core/schedule/health-alert.js";
import {
  loadScriptState,
  saveScriptState,
  recordOutcome,
} from "../../src/core/schedule/state.js";

// Isolate the server-level push store so the push channel is deterministically
// absent (telegram-only) in this test.
const pushStoreDir = path.join(os.tmpdir(), `cb-push-health-${process.pid}-${Date.now()}`);
process.env.CALLBACK_PUSH_STORE_DIR = pushStoreDir;

const NOW = new Date("2026-06-09T12:00:00Z");

async function seedFailingTask(box) {
  await box.seed("config/schedules/sync-notes.scheduled-script.card", `---
cron: "0 * * * *"
runs: cb wakeup --connector notes
---
`);
  await box.seed("config/schedules/.state/sync-notes.json", JSON.stringify({
    lastRun: "2026-06-09T11:00:00Z",
    lastResult: "failure",
    lastError: "Command failed with exit code 1\nstderr:\nAgent invocation failed: Model gpt-retired is not supported",
    lastSuccess: "2026-06-07T09:00:00Z",
    consecutiveFailures: 4,
    alertedAt: null,
    alertedFor: null,
    runCount: 50,
  }));
}
```

## No opt-in, no alert

```ts
const box = await makeTmpBox({ git: true });
await seedFailingTask(box);
box.commitAll("seed");

await checkHealthAndAlert(box.root, { now: NOW, tg: createFakeTelegram({ username: "bot" }) })
=> null
```

```ts cleanup
await box.cleanup();
```

## Opted in: one aggregated alert, delivered immediately, then latched

```ts
const box = await makeTmpBox({ git: true });
await seedFailingTask(box);
await box.seed("config/box.json", JSON.stringify({
  healthAlerts: { telegramChat: "777" },
}));
await box.seed("config/connectors/telegram.secret.json", JSON.stringify({
  botToken: "fake:token", webhookSecret: "s",
}));
box.commitAll("seed");

const tg = createFakeTelegram({ username: "bot" });
JSON.stringify(await checkHealthAndAlert(box.root, { now: NOW, tg }))
=> {"alerted":["sync-notes"],"delivered":true}

tg.sent[0].chatId
=> 777

tg.sent[0].text
=> ⚠️ Scheduled-task health «*»
- sync-notes: failing ×4 (last success 2d ago) — Agent invocation failed: Model gpt-retired is not supported
«blankline»
Run `cb health` in the box for details.
```

The task is latched, so the next daemon cycle stays quiet:

```ts continue
const state = await loadScriptState(box.root, "sync-notes");
print(`alertedFor: ${state.alertedFor}`);
print(`again: ${await checkHealthAndAlert(box.root, { now: NOW, tg })}`);
=>
alertedFor: failing
again: null
```

A successful run clears the latch; a relapse alerts again:

```ts continue
recordOutcome(state, {
  result: "success", error: null, durationMs: 100, sleepAffected: false,
  windowMs: 86_400_000, now: new Date("2026-06-09T13:00:00Z"),
});
recordOutcome(state, {
  result: "failure", error: "boom", durationMs: 100, sleepAffected: false,
  windowMs: 86_400_000, now: new Date("2026-06-09T14:00:00Z"),
});
recordOutcome(state, {
  result: "failure", error: "boom", durationMs: 100, sleepAffected: false,
  windowMs: 86_400_000, now: new Date("2026-06-09T15:00:00Z"),
});
await saveScriptState({ boxRoot: box.root, scriptName: "sync-notes", state });

const again = await checkHealthAndAlert(box.root, { now: new Date("2026-06-09T15:05:00Z"), tg });
JSON.stringify(again.alerted)
=> ["sync-notes"]

tg.sent.length
=> 2
```

```ts cleanup
await box.cleanup();
await fs.rm(pushStoreDir, { recursive: true, force: true });
```
