# Promotion: a requested schedule that cannot run says so once

Health never notifies on its own. The one exception is a schedule the
boxholder asked for (`requested-by: boxholder`) that could not run: the first
tick of the episode sends one `loud` notification and latches
`alertedFor: skipped:<reason>`; later ticks in the same episode send nothing;
a run clears the latch. See docs/implemented-plans/notifications.md (Track E) and
`src/core/schedule/promotion.ts`.

```ts setup
import { runTick } from "../../src/cli/commands/tick.js";
import { loadScriptState } from "../../src/core/schedule/state.js";
import { readRecent } from "../../src/core/notification/log.js";
import { checkRequiredConnectors } from "../../src/core/schedule/promotion.js";
import { parseScheduledScript } from "../../src/schemas/scheduled-script/schema.js";
import { syncConnector, addDays } from "../../src/connector-activity/core.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

// Hermetic: no engine-availability store, no Google grant, every channel fake.
process.env.BBX_ENGINE_AVAILABILITY_FILE = "/nonexistent/engine-availability.json";
delete process.env.BBX_GOOGLE_TOKENS_FILE;
process.env.BBX_NOTIFY_FAKE = "1";

function card({ requested, requires }) {
  return [
    "---",
    'cron: "0 * * * *"',
    "description: field trip watch",
    ...(requested ? ["requested-by: boxholder"] : []),
    ...(requires ? ["requires:", "  connectors: [gmail]"] : []),
    'runs: "true"',
    "---",
    "",
  ].join("\n");
}

/** Each logged notification: loudness, title, target, then the body. */
async function sent(box) {
  return (await readRecent(box.root, { days: 36500 }))
    .map(({ intent }) => `${intent.loudness} | ${intent.title} | ${intent.target}\n${intent.body}`)
    .join("\n") || "nothing sent";
}

/** A forced tick of one card: the schedule gate is bypassed, the connector gate is not. */
async function tick(box, script) {
  return (await runTick(box.root, { quiet: true, force: true, script })).scripts[0].status;
}
```

## A missing Google connector promotes once, with the Admin section as target

```ts
const box = await makeTmpBox({ git: true });
await box.write("_config/schedules/watch.scheduled-script.card", card({ requested: true, requires: true }));
box.commitAll("add schedule");

await tick(box, "watch")
=> skipped

await sent(box)
=>
loud | Your field trip watch could not run | admin:google-services
It needs gmail. Google is not connected or its access expired; open Admin › Google Services.

const state = await loadScriptState(box.root, "watch");
`${state.skipped.reason} | ${state.alertedFor}`
=> missing-connectors | skipped:missing-connectors
```

Later ticks in the same episode keep its `since` and send nothing:

```ts continue
await tick(box, "watch");
(await loadScriptState(box.root, "watch")).skipped.since === state.skipped.since
=> true

(await readRecent(box.root, { days: 36500 })).length
=> 1
```

A run clears both the episode and the latch, so the next episode promotes
again:

```ts continue
await box.write("_config/schedules/watch.scheduled-script.card", card({ requested: true, requires: false }));
await tick(box, "watch")
=> ran

const cleared = await loadScriptState(box.root, "watch");
`${cleared.skipped} | ${cleared.alertedFor}`
=> null | null

await box.write("_config/schedules/watch.scheduled-script.card", card({ requested: true, requires: true }));
await tick(box, "watch");
(await readRecent(box.root, { days: 36500 })).length
=> 2
```

```ts cleanup
await box.cleanup();
```

## A schedule the system set up never promotes

The episode is still recorded; nothing is sent.

```ts
const box = await makeTmpBox({ git: true });
await box.write("_config/schedules/sync.scheduled-script.card", card({ requested: false, requires: true }));
box.commitAll("add schedule");

await tick(box, "sync")
=> skipped

(await loadScriptState(box.root, "sync")).skipped.reason
=> missing-connectors

await sent(box)
=> nothing sent
```

```ts cleanup
await box.cleanup();
```

## A run deferred for want of the Jev key promotes once

The pipeline's defer marker says `unconfigured`. The latch survives the next
run that defers the same way, so the second run sends nothing.

```ts
const box = await makeTmpBox({ git: true });
await box.write("_config/schedules/judge.scheduled-script.card", `---
cron: "0 * * * *"
requested-by: boxholder
runs: printf '{"reason":"unconfigured"}' > "$BBX_DEFER_FILE"; exit 75
---
`);
box.commitAll("add schedule");

await tick(box, "judge");
await tick(box, "judge");
await sent(box)
=>
loud | Your judge could not run | dashboard
Its judgment step needs Jev, and the box has no OpenRouter key for Jev. Grant the "openrouter" secret to this box.

(await loadScriptState(box.root, "judge")).alertedFor
=> skipped:unconfigured
```

```ts cleanup
await box.cleanup();
```

## A required connector in a failing episode promotes once, though the card runs

The card itself can run; the tick checks the connectors it requires just
before running it. Two days of failed gmail syncs are a failing episode:

```ts
const box = await makeTmpBox({ git: true });
await box.seed("_config/box.json", JSON.stringify({ timezone: "UTC" }));
box.commitAll("seed");
const fail = { name: "gmail", produces: [], inboxPaths: [], sync: async () => ({ success: true, created: [], updated: [], error: "invalid_grant" }) };
await syncConnector(fail, { boxRoot: box.root, now: new Date("2026-09-20T15:00:00Z") });
await syncConnector(fail, { boxRoot: box.root, now: new Date("2026-09-21T15:00:00Z") });

const parsed = parseScheduledScript({ cron: "0 * * * *", "requested-by": "boxholder", requires: { connectors: ["gmail"] }, runs: "true", enabled: true });
const state = await loadScriptState(box.root, "watch");
const ctx = { boxRoot: box.root, scriptName: "watch", parsed, state, now: new Date("2026-09-21T16:00:00Z") };
await checkRequiredConnectors(ctx);
await checkRequiredConnectors(ctx);
await sent(box)
=>
loud | Your watch could not run | admin:google-services
It depends on gmail. gmail has failed every sync on its last 2 days of running, since 2026-09-20: invalid_grant
Reconnect Google in Admin, in the Google Services section.
```

When the episode ends, the latch clears so the next episode is new:

```ts continue
const ok = { ...fail, sync: async () => ({ success: true, created: ["_content/inbox/email/a.email-thread.card"], updated: [] }) };
await syncConnector(ok, { boxRoot: box.root, now: new Date("2026-09-22T15:00:00Z") });
await checkRequiredConnectors({ ...ctx, now: new Date("2026-09-22T16:00:00Z") });
(await loadScriptState(box.root, "watch")).alertedFor
=> null
```

```ts cleanup
await box.cleanup();
```
