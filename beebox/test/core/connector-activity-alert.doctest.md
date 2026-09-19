# Connector quiet/failing alert and dashboard warning

`checkConnectorActivityAndAlert` runs from the scheduler daemon after each tick.
It sends one message per episode — a connector that has gone quiet or keeps
failing — and the dashboard shows a warning until the condition clears or the
owner dismisses it. See `connectors/activity-verdict.ts` for the rule and
`connector-activity-verdict.doctest.md` for its cases.

```ts setup
import * as os from "node:os";
import * as path from "node:path";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { createFakeTelegram } from "../../src/services/telegram.js";
import { syncConnector, addDays, loadConnectorActivity } from "../../src/connectors/activity.js";
import { checkConnectorActivityAndAlert } from "../../src/core/schedule/connector-activity-alert.js";
import { connectorActivityHealthChecks } from "../../src/webapp/trpc/routers/health-connectors.js";
import { appRouter } from "../../src/webapp/trpc/router.js";

// Isolate the server-level push store so only the Telegram channel exists.
process.env.BBX_PUSH_STORE_DIR = path.join(os.tmpdir(), `bbx-push-connector-${process.pid}-${Date.now()}`);

async function seedBox({ telegram }) {
  const box = await makeTmpBox({ git: true });
  await box.seed("_config/box.json", JSON.stringify({
    timezone: "UTC",
    ...(telegram ? { healthAlerts: { telegramChat: "777" } } : {}),
  }));
  if (telegram) {
    await box.seed("_config/connectors/telegram.secret.json", JSON.stringify({ botToken: "fake:token", webhookSecret: "s" }));
  }
  box.commitAll("seed");
  return box;
}

const FIRST_DAY = "2026-08-15";
const at = (day) => new Date(`${day}T15:00:00Z`);

/** One sync per day: `P` brings in a new thread, `Z` succeeds with nothing new, `E` fails. */
async function runDays(boxRoot, { start, pattern }) {
  let day = start;
  for (const char of pattern) {
    const result = char === "P" ? { success: true, created: [`_content/inbox/email/${day}.email-thread.card`], updated: [] }
      : char === "Z" ? { success: true, created: [], updated: ["_content/inbox/email/old.email-thread.card"] }
      : { success: true, created: [], updated: [], error: "invalid_grant" };
    await syncConnector({ name: "gmail", produces: [], inboxPaths: [], sync: async () => result }, { boxRoot, now: at(day) });
    day = addDays(day, 1);
  }
  return addDays(day, -1);
}

function caller(boxRoot, isOwner) {
  return appRouter.createCaller({
    boxRoot,
    boxSlug: "test",
    eventBus: {
      emit: () => 0,
      emitTransient: () => {},
      readSince: () => [],
      subscribe: () => ({ unsubscribe: () => {} }),
      prune: () => 0,
      close: () => {},
    },
    services: {},
    user: { email: "owner@example.com", name: "Owner" },
    authed: true,
    isOwner,
  });
}
```

## A steady producer that goes quiet alerts once

Thirty days of new mail, then three days of successful syncs that only refresh
tracked threads:

```ts
const box = await seedBox({ telegram: true });
const tg = createFakeTelegram({ username: "bot" });
const last = await runDays(box.root, { start: FIRST_DAY, pattern: "P".repeat(30) + "ZZ" });
await checkConnectorActivityAndAlert(box.root, { now: at(last), tg })
=> null

const day3 = await runDays(box.root, { start: addDays(last, 1), pattern: "Z" });
const alert = await checkConnectorActivityAndAlert(box.root, { now: at(day3), tg });
JSON.stringify(alert)
=> {"alerted":["gmail"],"delivered":true}

tg.sent[0].text
=> A connector needs attention («*»)
- gmail has brought in nothing new on its last 3 days of syncing since 2026-09-14 (more than 2 days without something new is unusual for it). Syncs are still succeeding, so check whether a filter, permission or upstream change stopped it.
«blankline»
If this is expected, dismiss it on the box dashboard.
```

The episode is stamped, so later ticks, including on later quiet days, send
nothing more:

```ts continue
await checkConnectorActivityAndAlert(box.root, { now: at(day3), tg })
=> null

const day4 = await runDays(box.root, { start: addDays(day3, 1), pattern: "Z" });
await checkConnectorActivityAndAlert(box.root, { now: at(day4), tg })
=> null

tg.sent.length
=> 1
```

## The dashboard warns until the owner dismisses it

```ts continue
const [check] = await connectorActivityHealthChecks(box.root, { now: at(day4) });
`${check.name} | ${check.ok} | ${check.actions}`
=> connector-activity:gmail | false | dismiss-connector-episode

await caller(box.root, false).health.dismissConnectorEpisode({ check: check.name }).then(() => "allowed", (e) => e.code)
=> FORBIDDEN

JSON.stringify(await caller(box.root, true).health.dismissConnectorEpisode({ check: check.name }))
=> {"success":true}

(await connectorActivityHealthChecks(box.root, { now: at(day4) })).length
=> 0
```

Dismissing when nothing is open is an error, not a silent success:

```ts continue
await caller(box.root, true).health.dismissConnectorEpisode({ check: "connector-activity:calendar" }).then(() => "allowed", (e) => e.code)
=> NOT_FOUND
```

## New items end the episode; the next one alerts again

```ts continue
const recovered = await runDays(box.root, { start: addDays(day4, 1), pattern: "P" });
await checkConnectorActivityAndAlert(box.root, { now: at(recovered), tg })
=> null

(await loadConnectorActivity(box.root)).connectors.gmail.episode
=> null

const failing = await runDays(box.root, { start: addDays(recovered, 1), pattern: "EE" });
const relapse = await checkConnectorActivityAndAlert(box.root, { now: at(failing), tg });
`${relapse.alerted} | ${tg.sent.length} | ${tg.sent[1].text.includes("gmail has failed every sync on its last 2 days of running")}`
=> gmail | 2 | true
```

```ts cleanup
await box.cleanup();
```

## No channel: the dashboard still warns, and nothing is stamped

```ts
const box = await seedBox({ telegram: false });
const last = await runDays(box.root, { start: FIRST_DAY, pattern: "P".repeat(30) + "ZZZ" });
await checkConnectorActivityAndAlert(box.root, { now: at(last) })
=> null

(await loadConnectorActivity(box.root)).connectors.gmail.episode.notifiedAt
=> null

(await connectorActivityHealthChecks(box.root, { now: at(last) })).length
=> 1
```

```ts cleanup
await box.cleanup();
```

## A damaged record is a warning, not a reset

```ts
const box = await seedBox({ telegram: false });
await box.seed("_bookkeeping/connectors/connector-activity.state.json", "{\"version\":2}");
const [check] = await connectorActivityHealthChecks(box.root, { now: at(FIRST_DAY) });
`${check.name} | ${check.ok} | ${check.message.includes("is invalid")}`
=> connector-activity | false | true
```

```ts cleanup
await box.cleanup();
```
