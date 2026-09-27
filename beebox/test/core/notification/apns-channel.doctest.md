# The `apns` channel

A notification reaches every paired phone that registered an APNs token and is
not revoked. The channel logs one delivery for the intent however many phones
there are: `sent` when at least one took it. A token APNs reports dead is
pruned from its device; the phone stays paired and restores the registration
on its next launch. Missing keys are `skipped: unconfigured`. Each send leaves
one line in `.beebox/push-debug.log`, with no token in it.

```ts setup
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { notifyBoxholder, notifyChannels } from "../../../src/core/notify-boxholder.js";
import { createFakeApns } from "../../../src/services/apns.js";
import {
  createMobilePairingTicket,
  devicePushRegistrations,
  listMobileDevices,
  redeemMobilePairingTicket,
  registerDevicePush,
  revokeMobileDevice,
} from "../../../src/core/mobile/pairing.js";
import { readRecent } from "../../../src/core/notification/log.js";

process.env.BBX_PUSH_STORE_DIR = path.join(os.tmpdir(), `bbx-apns-channel-${process.pid}-${Date.now()}`);
const ENV = ["BBX_NOTIFY_FAKE", "BBX_PUSH_FAKE", "BBX_APNS_KEY_PATH", "BBX_APNS_KEY_ID", "BBX_APNS_TEAM_ID", "BBX_APNS_BUNDLE_ID", "BBX_VAPID_PUBLIC_KEY", "BBX_VAPID_PRIVATE_KEY"];
for (const name of ENV) delete process.env[name];

const NOW = new Date("2026-09-26T12:00:00Z");
const PHONE = "a1".repeat(32);
const TABLET = "b2".repeat(32);

/** Pair a phone and register its APNs token, as the app does at launch. */
async function pairPhone(box, opts) {
  const ticket = createMobilePairingTicket(box.root, { createdBy: "owner@example.com" });
  const device = await redeemMobilePairingTicket(box.root, { pairingToken: ticket.token, deviceLabel: opts.label });
  await registerDevicePush(box.root, { deviceId: device.deviceId, token: opts.token, environment: opts.environment });
  return device;
}

function intent(loudness) {
  return {
    title: "Pick up Sam at 3",
    body: "The reminder you asked for this morning.",
    target: { kind: "chat-new" },
    loudness,
    tag: "pickup",
    source: "apns-doctest",
  };
}

async function logged(box) {
  const [n] = (await readRecent(box.root, { days: 1, now: NOW })).toReversed();
  return n.deliveries.map((d) => `${d.channel} ${d.status}${d.detail ? `: ${d.detail}` : ""}`).join("\n");
}
```

## A registered phone gets the push

```ts
const box = await makeTmpBox({ git: true });
await pairPhone(box, { label: "Jamie's iPhone", token: PHONE, environment: "sandbox" });
const apns = createFakeApns();
const result = await notifyBoxholder(box.root, { intent: intent("loud"), now: NOW, services: { apns } });

await logged(box)
=>
apns sent
web-push skipped: no-audience
telegram skipped: no-audience
```

The push goes to the phone's own APNs host, with the payload the iOS client
reads (contract §5.10). With no bundle id configured, the topic is a
placeholder.

```ts continue
const [sent] = apns.sent;
JSON.stringify([sent.token === PHONE, sent.environment, sent.headers, sent.payload.target, sent.payload.loudness, sent.payload.notificationId === result.id])
=> [true,"sandbox",{"apns-push-type":"alert","apns-topic":"app.beebox.fake","apns-collapse-id":"pickup"},"chat:new","loud",true]
```

The debug log has one line for the send, naming the device, the loudness, and
the target, and never the token:

```ts continue
const debug = await fs.readFile(path.join(box.root, ".beebox", "push-debug.log"), "utf-8");
const line = JSON.parse(debug.trim().split("\n").at(-1));
JSON.stringify([line.channel, line.device, line.environment, line.loudness, line.target, line.result, debug.includes(PHONE)])
=> ["apns","Jamie's iPhone","sandbox","loud","chat:new","sent",false]
```

A `dot` goes to the phone alone: it is a badge, and no other channel has one.

```ts continue
await notifyBoxholder(box.root, { intent: intent("dot"), now: NOW, services: { apns } });
await logged(box)
=> apns sent

JSON.stringify(apns.sent[1]?.payload)
=> {"aps":{"badge":1},"target":"chat:new","notificationId":"«*»","box":"«*»"}
```

The payload names the sending box by its slug, the box directory's name:

```ts continue
apns.sent[1]?.payload.box === (await import("node:path")).basename(box.root)
=> true
```

```ts cleanup
await box.cleanup();
```

## A dead token is pruned, and the phone stays paired

APNs answers 410 Unregistered (or 400 BadDeviceToken) for a token that will
never work again. The registration goes; the device does not.

```ts
const box = await makeTmpBox({ git: true });
await pairPhone(box, { label: "Jamie's iPhone", token: PHONE, environment: "production" });
const apns = createFakeApns({ goneTokens: [PHONE] });
await notifyBoxholder(box.root, { intent: intent("loud"), now: NOW, services: { apns } });

await logged(box)
=>
apns failed: no device received the push (sent 0 of 1, pruned 1)
web-push skipped: no-audience
telegram skipped: no-audience

JSON.stringify([devicePushRegistrations(box.root).length, listMobileDevices(box.root).map((d) => [d.label, d.push, d.revokedAt ?? null])])
=> [0,[["Jamie's iPhone",null,null]]]
```

With the registration gone the phone is no longer an audience, until it
registers again:

```ts continue
await notifyBoxholder(box.root, { intent: intent("quiet"), now: NOW, services: { apns } });
(await logged(box)).split("\n")[0]
=> apns skipped: no-audience
```

```ts cleanup
await box.cleanup();
```

## Several phones: one delivery line with the counts

The line is `sent` when any phone took the push. Each phone is sent to on its
own host, and a revoked phone is not an audience.

```ts
const box = await makeTmpBox({ git: true });
await pairPhone(box, { label: "Jamie's iPhone", token: PHONE, environment: "production" });
await pairPhone(box, { label: "old iPad", token: TABLET, environment: "sandbox" });
const lost = await pairPhone(box, { label: "lost phone", token: "c3".repeat(32), environment: "production" });
await revokeMobileDevice(box.root, lost.deviceId);
const apns = createFakeApns({ goneTokens: [TABLET] });
await notifyBoxholder(box.root, { intent: intent("loud"), now: NOW, services: { apns } });

(await logged(box)).split("\n")[0]
=> apns sent: devices: sent 1 of 2, pruned 1

JSON.stringify(apns.sent.map((s) => s.environment))
=> ["production"]
```

```ts cleanup
await box.cleanup();
```

## No APNs key: `unconfigured`, never a throw

Without an injected service the channel needs all four `BBX_APNS_*` values.
`notifyChannels` (and `bbx notify --check`) agree.

```ts
const box = await makeTmpBox({ git: true });
await pairPhone(box, { label: "Jamie's iPhone", token: PHONE, environment: "sandbox" });
await notifyBoxholder(box.root, { intent: intent("loud"), now: NOW });

(await logged(box)).split("\n")[0]
=> apns skipped: unconfigured

(await notifyChannels(box.root)).apns
=> false

Object.assign(process.env, { BBX_APNS_KEY_PATH: "/nonexistent/AuthKey.p8", BBX_APNS_KEY_ID: "KEY", BBX_APNS_TEAM_ID: "TEAM", BBX_APNS_BUNDLE_ID: "app.example" });
const withKeys = (await notifyChannels(box.root)).apns;
withKeys
=> true
```

With keys set but the key file missing, the send is a `failed` line with the
reason, and nothing throws:

```ts continue
await notifyBoxholder(box.root, { intent: intent("loud"), now: NOW });
for (const name of ENV) delete process.env[name];
(await logged(box)).split("\n")[0]
=> apns failed: no device received the push (sent 0 of 1, failed 1): Failed loading token key: ENOENT: no such file or directory, open '/nonexistent/AuthKey.p8'
```

```ts cleanup
await box.cleanup();
await fs.rm(process.env.BBX_PUSH_STORE_DIR, { recursive: true, force: true });
```
