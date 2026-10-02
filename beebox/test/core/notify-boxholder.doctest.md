# notifyBoxholder: log, decide, deliver once

`notifyBoxholder` is the one way the box reaches the person. It appends the
intent to `.beebox/notifications.jsonl`, emits a live `notification` event for
open apps, picks channels from the loudness, the audience, and presence, sends
once on each in process, and appends one delivery line per channel. There is no
queue and no retry: a failure is a `failed` line, and the notification health
checks report it.

```ts setup
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { boxSlug } from "../../src/lib/box-slug.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { notifyBoxholder, notifyChannels } from "../../src/core/notify-boxholder.js";
import { addSubscription } from "../../src/core/push-subscriptions.js";
import { createFakePush } from "../../src/services/push.js";
import { createFakeTelegram } from "../../src/services/telegram.js";
import { createEventBus } from "../../src/core/event-bus/core.js";
import { readRecent, notificationLogPath } from "../../src/core/notification/log.js";
import { writePresence } from "../../src/core/notification/presence.js";
import { notificationHealthChecks } from "../../src/core/notification/health.js";

const storeDir = path.join(os.tmpdir(), `bbx-notify-${process.pid}-${Date.now()}`);
process.env.BBX_PUSH_STORE_DIR = storeDir;
// No VAPID keys, forced-fake push, or public URL unless a section sets them.
for (const name of ["BBX_VAPID_PUBLIC_KEY", "BBX_VAPID_PRIVATE_KEY", "BBX_NOTIFY_FAKE", "BBX_PUSH_FAKE", "BBX_APNS_KEY_PATH", "BBX_APNS_KEY_ID", "BBX_APNS_TEAM_ID", "BBX_APNS_BUNDLE_ID", "BBX_PUBLIC_URL", "PUBLIC_URL"]) delete process.env[name];

const NOW = new Date("2026-09-26T12:00:00Z");
const SUB = { endpoint: "https://push.example/phone", keys: { p256dh: "p", auth: "a" } };

// A box whose boxholder subscribed a browser and set a Telegram chat.
async function reachableBox() {
  const box = await makeTmpBox({ git: true });
  await box.seed("_config/box.json", JSON.stringify({ healthAlerts: { telegramChat: "777" } }));
  box.commitAll("seed");
  await addSubscription({ boxSlug: await boxSlug(box.root), subscription: SUB, now: NOW });
  return box;
}

function intent(loudness) {
  return {
    title: "Field trip form due Friday",
    body: "The school emailed: the form is due Friday.",
    target: { kind: "card", path: "_content/inbox/field-trip.email.card" },
    loudness,
    source: "notify-doctest",
  };
}

async function logged(box) {
  const [n] = await readRecent(box.root, { days: 1, now: NOW });
  return n.deliveries.map((d) => `${d.channel} ${d.status}${d.detail ? `: ${d.detail}` : ""}`).join("\n");
}

async function failing(box) {
  const checks = await notificationHealthChecks(box.root, { now: NOW });
  return checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.message}`).join("\n") || "all ok";
}
```

## `loud` with a subscribed browser and a Telegram chat: two sends

APNs has no audience until paired phones register, so it is a skip. The
other two channels send.

```ts
const box = await reachableBox();
const push = createFakePush();
const tg = createFakeTelegram({ username: "bot" });
const result = await notifyBoxholder(box.root, { intent: intent("loud"), now: NOW, services: { push, tg } });

await logged(box)
=>
apns skipped: no-audience
web-push sent
telegram sent
```

The push carries the rendered deep link and makes a sound. Telegram gets the
title, the body, and the same link, root-relative because no public URL is
set:

```ts continue
const slug = await boxSlug(box.root);
push.sent[0]?.payload.url === `/${slug}/browse/_content/inbox/field-trip.email.card`
=> true

push.sent[0]?.payload.silent
=> false

tg.sent[0]?.text.replace(slug, "<box>")
=>
Field trip form due Friday
The school emailed: the form is due Friday.
/<box>/browse/_content/inbox/field-trip.email.card

tg.sent[0]?.silent
=> false
```

The intent line is in the log under the id the result returns, and open apps
got the live bus event with the same id and url:

```ts continue
const [n] = await readRecent(box.root, { days: 1, now: NOW });
JSON.stringify([n.intent.id === result.id, n.intent.target, n.intent.loudness, n.intent.source])
=> [true,"card:_content/inbox/field-trip.email.card","loud","notify-doctest"]

const bus = createEventBus(box.root);
const events = bus.readSince(0).filter((e) => e.event === "notification");
bus.close();
JSON.stringify([events.length, events[0]?.data.id === result.id, events[0]?.data.url === push.sent[0]?.payload.url])
=> [1,true,true]

await failing(box)
=> all ok
```

With `PUBLIC_URL` set, the Telegram link is absolute:

```ts continue
process.env.PUBLIC_URL = "https://box.example.com/";
await notifyBoxholder(box.root, { intent: intent("loud"), now: NOW, services: { push, tg }, channel: "telegram" });
delete process.env.PUBLIC_URL;
tg.sent[1]?.text.split("\n").at(-1).replace(slug, "<box>")
=> https://box.example.com/<box>/browse/_content/inbox/field-trip.email.card
```

```ts cleanup
await box.cleanup();
```

## `quiet` while someone is present: nothing sent

An open app with a person active shows a `quiet` notification itself, so every
channel is skipped as `present`. Presence is only current for 90 seconds: a
stale presence file counts as nobody, and the next `quiet` sends.

```ts
const box = await reachableBox();
const push = createFakePush();
const tg = createFakeTelegram({ username: "bot" });
await writePresence(box.root, { activeWeb: 1, now: new Date(NOW.getTime() - 30_000) });
await notifyBoxholder(box.root, { intent: intent("quiet"), now: NOW, services: { push, tg } });

await logged(box)
=>
apns skipped: present
web-push skipped: present
telegram skipped: present

JSON.stringify([push.sent.length, tg.sent.length])
=> [0,0]

await writePresence(box.root, { activeWeb: 1, now: new Date(NOW.getTime() - 120_000) });
await notifyBoxholder(box.root, { intent: intent("quiet"), now: NOW, services: { push, tg } });
JSON.stringify([push.sent.length, tg.sent.length])
=> [1,1]
```

A `quiet` Telegram message is sent with `disable_notification`, and a `quiet`
push carries `silent`, which the service worker passes to `showNotification`,
so neither makes a sound:

```ts continue
JSON.stringify([tg.sent[0]?.silent, push.sent[0]?.payload.silent])
=> [true,true]

await failing(box)
=> all ok
```

```ts cleanup
await box.cleanup();
```

## `quiet` with no audience and nobody present: a visible gap

Nothing can reach the person. Each channel is logged as `no-audience` and the
health check names the notification.

```ts
const box = await makeTmpBox({ git: true });
JSON.stringify(await notifyChannels(box.root))
=> {"apns":false,"webPush":false,"telegram":false}

const result = await notifyBoxholder(box.root, { intent: intent("quiet"), now: NOW });
await logged(box)
=>
apns skipped: no-audience
web-push skipped: no-audience
telegram skipped: no-audience

await failing(box)
=> notifications-no-channel: 1 notification(s) in the last 24 hours had no channel to reach the boxholder (open the paired iPhone app, subscribe a browser to push, or set healthAlerts.telegramChat): "Field trip form due Friday"
```

```ts cleanup
await box.cleanup();
```

## A channel counts as reachable only when a send could go out

`notifyChannels` needs someone to send to and what the send needs: an
injected service, or else VAPID keys for web push and the bot secret for
Telegram. A subscribed browser without VAPID keys, or a Telegram chat without
the bot secret, is not a way to reach the person.

```ts
const box = await reachableBox();
JSON.stringify(await notifyChannels(box.root))
=> {"apns":false,"webPush":false,"telegram":false}

JSON.stringify(await notifyChannels(box.root, { services: { push: createFakePush(), tg: createFakeTelegram({ username: "bot" }) } }))
=> {"apns":false,"webPush":true,"telegram":true}

process.env.BBX_VAPID_PUBLIC_KEY = "public";
process.env.BBX_VAPID_PRIVATE_KEY = "private";
const withKeys = await notifyChannels(box.root);
delete process.env.BBX_VAPID_PUBLIC_KEY;
delete process.env.BBX_VAPID_PRIVATE_KEY;
withKeys.webPush
=> true
```

```ts cleanup
await box.cleanup();
```

## Generated ids start with a letter

A URL search parser reads an all-digit value as a number, so an id is never
one:

```ts
const box = await reachableBox();
const ids = [];
for (let i = 0; i < 5; i++) ids.push((await notifyBoxholder(box.root, { intent: intent("dot"), now: NOW })).id);
ids.every((id) => /^n[\w-]{8}$/.test(id))
=> true
```

```ts cleanup
await box.cleanup();
```

## `channel` restricts delivery to one channel

`bbx notify --channel` uses this to test one channel. The others are neither
tried nor logged.

```ts
const box = await reachableBox();
const push = createFakePush();
const tg = createFakeTelegram({ username: "bot" });
await notifyBoxholder(box.root, { intent: intent("loud"), now: NOW, services: { push, tg }, channel: "telegram" });

await logged(box)
=> telegram sent

JSON.stringify([push.sent.length, tg.sent.length])
=> [0,1]
```

```ts cleanup
await box.cleanup();
```

## A failing push: one `failed` line and a health check

Telegram still sends; the push failure is recorded with its reason and
reported for 24 hours.

```ts
const box = await reachableBox();
const push = createFakePush({ failEndpoints: [SUB.endpoint] });
const tg = createFakeTelegram({ username: "bot" });
await notifyBoxholder(box.root, { intent: intent("loud"), now: NOW, services: { push, tg } });

await logged(box)
=>
apns skipped: no-audience
web-push failed: no device received the push (sent 0, pruned 0, failed 1)
telegram sent

await failing(box)
=> notifications-undelivered: 1 notification(s) could not be delivered in the last 24 hours: "Field trip form due Friday" (web-push: no device received the push (sent 0, pruned 0, failed 1))
```

A day later the failure has aged out of the check:

```ts continue
(await notificationHealthChecks(box.root, { now: new Date(NOW.getTime() + 25 * 60 * 60 * 1000) })).every((c) => c.ok)
=> true
```

```ts cleanup
await box.cleanup();
```

## An unwritable log does not stop delivery

The log is the record, not the delivery path. When it cannot be appended to,
the notification still sends and the writability check, which probes by
opening for append rather than by reading, reports it.

```ts
const box = await reachableBox();
await fs.mkdir(notificationLogPath(box.root), { recursive: true });
const tg = createFakeTelegram({ username: "bot" });
const result = await notifyBoxholder(box.root, { intent: intent("loud"), now: NOW, services: { push: createFakePush(), tg } });

result.deliveries.map((d) => `${d.channel} ${d.status}`).join(", ")
=> apns skipped, web-push sent, telegram sent

(await notificationHealthChecks(box.root, { now: NOW })).find((c) => c.name === "notification-log-writable").ok
=> false
```

```ts cleanup
await box.cleanup();
await fs.rm(storeDir, { recursive: true, force: true });
```
