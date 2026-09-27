# notifications and presence routers

`notifications.recent` and `notifications.get` read the notification log for
the Admin "Recent" list and the `chat:new` banner. `notifications.send` and
`notifications.channels` are `bbx notify`'s server side: a box-spawned shell has
no APNs or VAPID keys, so it asks the server, which has them. `presence.heartbeat` is the
open tab's report that a person is using it; the server keeps
`.beebox/presence.json` current from those heartbeats, and `livePresence` (what
`notifyBoxholder` reads) sees the count.

```ts setup
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { appRouter } from "../../src/webapp/trpc/router.js";
import { notifyBoxholder } from "../../src/core/notify-boxholder.js";
import { livePresence } from "../../src/core/notification/presence.js";
import { boxSlug } from "../../src/lib/box-slug.js";
import { addSubscription } from "../../src/core/push-subscriptions.js";
import { pairFakePushDevice } from "../../src/core/mobile/pairing.js";
import { createFakePush } from "../../src/services/push.js";
import { createFakeApns } from "../../src/services/apns.js";
import { createFakeTelegram } from "../../src/services/telegram.js";

const storeDir = path.join(os.tmpdir(), `bbx-notifications-router-${process.pid}-${Date.now()}`);
process.env.BBX_PUSH_STORE_DIR = storeDir;
for (const name of ["BBX_VAPID_PUBLIC_KEY", "BBX_VAPID_PRIVATE_KEY", "BBX_NOTIFY_FAKE", "BBX_PUSH_FAKE", "BBX_APNS_KEY_PATH", "BBX_APNS_KEY_ID", "BBX_APNS_TEAM_ID", "BBX_APNS_BUNDLE_ID"]) delete process.env[name];

const box = await makeTmpBox({ git: true });

function caller(over) {
  return appRouter.createCaller({
    boxRoot: box.root,
    boxSlug: "alpha",
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {},
    user: null,
    authed: true,
    isOwner: true,
    isAuthenticatedOwner: true,
    actor: "user",
    ...over,
  });
}

async function attempt(fn) {
  try {
    return await fn();
  } catch (e) {
    return `THREW:${e.code}`;
  }
}
```

## recent: intents with their deliveries, newest first

The box has no channel configured, so each channel is logged `no-audience`.

```ts
const first = await notifyBoxholder(box.root, {
  intent: { title: "Field trip form due", body: "Sign by Friday.", target: { kind: "dashboard" }, loudness: "loud", source: "doctest" },
});
const second = await notifyBoxholder(box.root, {
  intent: { title: "Talk about the trip?", body: "", target: { kind: "chat-new" }, loudness: "quiet", source: "doctest" },
});
const recent = await caller({}).notifications.recent({ days: 3 });
recent.map((n) => `${n.intent.title}: ${n.deliveries.map((d) => `${d.channel} ${d.status} ${d.detail}`).join(", ")}`).join("\n")
=>
Talk about the trip?: apns skipped no-audience, web-push skipped no-audience, telegram skipped no-audience
Field trip form due: apns skipped no-audience, web-push skipped no-audience, telegram skipped no-audience
```

## get: one intent by id; null for an unknown id

A `chat:new` tap carries the id, and the chat page shows the intent. An id the
log no longer has (rotated away) is null, not an error.

```ts continue
const got = await caller({}).notifications.get({ id: second.id });
JSON.stringify([got?.intent.title, got?.intent.target])
=> ["Talk about the trip?","chat:new"]

await caller({}).notifications.get({ id: "no-such-id" })
=> null
```

## Both routers need an authenticated request

```ts continue
await attempt(() => caller({ authed: false }).notifications.recent({}))
=> THREW:UNAUTHORIZED

await attempt(() => caller({ authed: false }).presence.heartbeat({ sessionId: "tab-aaaaaaaa" }))
=> THREW:UNAUTHORIZED
```

## heartbeat: each tab counts once, and the file reflects it

```ts continue
await caller({}).presence.heartbeat({ sessionId: "tab-aaaaaaaa" });
await caller({}).presence.heartbeat({ sessionId: "tab-bbbbbbbb" });
await caller({}).presence.heartbeat({ sessionId: "tab-aaaaaaaa" });
JSON.stringify(await livePresence(box.root))
=> {"activeWeb":2}
```

A malformed session id is rejected:

```ts continue
await attempt(() => caller({}).presence.heartbeat({ sessionId: "x" }))
=> THREW:BAD_REQUEST
```

## send and channels: the box's agent or its owner, on the server's services

The server's channel services arrive through the context's `services.notify`
(production leaves it unset and builds them from the server's keys). This box
now has a paired phone, a subscribed browser, and a Telegram chat, and the
server holds fakes for all three.

```ts continue
await box.seed("_config/box.json", JSON.stringify({ healthAlerts: { telegramChat: "777" } }));
await pairFakePushDevice(box.root, { label: "test phone" });
await addSubscription({
  boxSlug: await boxSlug(box.root),
  subscription: { endpoint: "https://push.example/phone", keys: { p256dh: "p", auth: "a" } },
  now: new Date(),
});
const notify = { apns: createFakeApns(), push: createFakePush(), tg: createFakeTelegram({ username: "bot" }) };
const agent = caller({ actor: "agent", user: null, isOwner: false, isAuthenticatedOwner: false, services: { notify } });

JSON.stringify(await agent.notifications.channels())
=> {"reach":{"apns":true,"webPush":true,"telegram":true},"configured":{"apns":true,"webPush":true,"telegram":true}}
```

A send runs `notifyBoxholder` in the server process, so the delivery goes out
on the server's services and lands in the log like any other:

```ts continue
const sent = await agent.notifications.send({
  intent: { title: "Pick up Sam", body: "At 3.", target: "chat:new", loudness: "loud", source: "bbx notify" },
});
JSON.stringify([sent.deliveries, notify.apns.sent.length, notify.push.sent.length, notify.tg.sent.length])
=> [[{"channel":"apns","status":"sent"},{"channel":"web-push","status":"sent"},{"channel":"telegram","status":"sent"}],1,1,1]

(await caller({}).notifications.get({ id: sent.id }))?.intent.source
=> bbx notify
```

`channel` restricts the send to one channel, as `bbx notify --channel` does:

```ts continue
const one = await agent.notifications.send({
  intent: { title: "Only the phone", body: "", target: "dashboard", loudness: "loud", source: "bbx notify" },
  channel: "apns",
});
JSON.stringify(one.deliveries)
=> [{"channel":"apns","status":"sent"}]
```

The signed-in owner may send too. A member who is not the owner, a paired
device acting for nobody, and an open-access request are refused: reaching the
boxholder's phone is the box's voice. An unauthenticated request never gets
that far.

```ts continue
const intent = { title: "x", body: "", target: "dashboard", loudness: "loud", source: "doctest" };
(await caller({ services: { notify } }).notifications.send({ intent })).deliveries.length
=> 3

[
  await attempt(() => caller({ user: { email: "member@example.org", name: "Member" }, isOwner: false, isAuthenticatedOwner: false }).notifications.send({ intent })),
  await attempt(() => caller({ actor: "device", isOwner: false, isAuthenticatedOwner: false }).notifications.channels()),
  await attempt(() => caller({ actor: "open", isAuthenticatedOwner: false }).notifications.send({ intent })),
  await attempt(() => caller({ actor: "none", authed: false, isOwner: false, isAuthenticatedOwner: false }).notifications.send({ intent })),
  await attempt(() => caller({ actor: "none", authed: false, isOwner: false, isAuthenticatedOwner: false }).notifications.channels()),
].join(" ")
=> THREW:FORBIDDEN THREW:FORBIDDEN THREW:FORBIDDEN THREW:UNAUTHORIZED THREW:UNAUTHORIZED
```

A target the log could not hold is refused at the boundary, before anything is
logged or sent:

```ts continue
await attempt(() => agent.notifications.send({ intent: { ...intent, target: "card:../outside.card" } }))
=> THREW:BAD_REQUEST
```

```ts cleanup
await box.cleanup();
await fs.rm(storeDir, { recursive: true, force: true });
```
