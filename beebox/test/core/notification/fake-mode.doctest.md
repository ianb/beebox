# Fake mode: `BBX_NOTIFY_FAKE=1`

With `BBX_NOTIFY_FAKE=1` every channel sends through its fake service, and a
channel with nobody to reach gets a synthetic member, so a dev box exercises
the whole delivery path with no phone, browser, or Telegram chat. The log
records each delivery as `sent` with detail `fake`, and the Admin recent list
and `bbx health` read it like any other.

```ts setup
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { notifyBoxholder, notifyChannels } from "../../../src/core/notify-boxholder.js";
import { pairFakePushDevice } from "../../../src/core/mobile/pairing.js";
import { readRecent } from "../../../src/core/notification/log.js";
import { writePresence } from "../../../src/core/notification/presence.js";

process.env.BBX_PUSH_STORE_DIR = path.join(os.tmpdir(), `bbx-notify-fake-${process.pid}-${Date.now()}`);
const ENV = ["BBX_NOTIFY_FAKE", "BBX_PUSH_FAKE", "BBX_APNS_KEY_PATH", "BBX_APNS_KEY_ID", "BBX_APNS_TEAM_ID", "BBX_APNS_BUNDLE_ID", "BBX_VAPID_PUBLIC_KEY", "BBX_VAPID_PRIVATE_KEY"];
for (const name of ENV) delete process.env[name];

const NOW = new Date("2026-09-26T12:00:00Z");
const intent = (loudness) => ({ title: "Fake-mode check", body: "", target: { kind: "dashboard" }, loudness, source: "fake-doctest" });

async function logged(box) {
  const [n] = (await readRecent(box.root, { days: 1, now: NOW })).toReversed();
  return n.deliveries.map((d) => `${d.channel} ${d.status}${d.detail ? `: ${d.detail}` : ""}`).join("\n");
}

async function debugLines(box) {
  const text = await fs.readFile(path.join(box.root, ".beebox", "push-debug.log"), "utf-8");
  return text.trim().split("\n").map((line) => JSON.parse(line));
}
```

## An empty box reaches every channel

The box has no paired phone, no push subscription, no Telegram chat, and no
keys. In fake mode none of that matters:

```ts
const box = await makeTmpBox({ git: true });
process.env.BBX_NOTIFY_FAKE = "1";
JSON.stringify(await notifyChannels(box.root))
=> {"apns":true,"webPush":true,"telegram":true}

await notifyBoxholder(box.root, { intent: intent("loud"), now: NOW });
await logged(box)
=>
apns sent: fake
web-push sent: fake
telegram sent: fake
```

Both push channels leave their debug lines, the APNs one naming the
synthetic phone:

```ts continue
(await debugLines(box)).map((l) => l.channel === "apns" ? `apns ${l.device} ${l.loudness} ${l.target}` : `web-push ${l.title}`).join("\n")
=>
apns synthetic phone loud dashboard
web-push Fake-mode check
```

A registered device is used in place of the synthetic one:

```ts continue
await pairFakePushDevice(box.root, { label: "dev phone" });
await notifyBoxholder(box.root, { intent: intent("dot"), now: NOW });
delete process.env.BBX_NOTIFY_FAKE;
[await logged(box), (await debugLines(box)).at(-1).device].join("\n")
=>
apns sent: fake
dev phone
```

```ts cleanup
await box.cleanup();
```

## The loudness and presence rules still apply

Fake mode fakes the audience and the services, not the decision: a `quiet`
notification while someone is in the app is still held back.

```ts
const box = await makeTmpBox({ git: true });
process.env.BBX_NOTIFY_FAKE = "1";
await writePresence(box.root, { activeWeb: 1, now: NOW });
await notifyBoxholder(box.root, { intent: intent("quiet"), now: NOW });
delete process.env.BBX_NOTIFY_FAKE;
await logged(box)
=>
apns skipped: present
web-push skipped: present
telegram skipped: present
```

```ts cleanup
await box.cleanup();
```

## `BBX_PUSH_FAKE` still works for one release

The old web-push-only switch is read as an alias, with a warning to rename it.

```ts
const box = await makeTmpBox({ git: true });
process.env.BBX_PUSH_FAKE = "1";
const warnings = [];
const origWarn = console.warn;
console.warn = (...args) => { warnings.push(args.join(" ")); };
await notifyBoxholder(box.root, { intent: intent("loud"), now: NOW });
console.warn = origWarn;
delete process.env.BBX_PUSH_FAKE;
[await logged(box), warnings.filter((w) => w.includes("BBX_PUSH_FAKE")).length].join("\n")
=>
apns sent: fake
web-push sent: fake
telegram sent: fake
1
```

```ts cleanup
await box.cleanup();
await fs.rm(process.env.BBX_PUSH_STORE_DIR, { recursive: true, force: true });
```
