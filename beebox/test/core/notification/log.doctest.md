# The notification log

`.beebox/notifications.jsonl` records every intent and every delivery, one
JSON line each, append-only and gitignored. `readRecent` and `getIntent`
group the deliveries under their intent. Rotation renames the file; readers
read the current file and the rotated one.

```ts setup
import * as fs from "node:fs";
import * as path from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import {
  appendIntent,
  appendDelivery,
  readRecent,
  getIntent,
  rotateIfNeeded,
  notificationLogPath,
} from "../../../src/core/notification/log.js";

const NOW = new Date("2026-09-26T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function intent(id, title) {
  return { id, title, body: "", target: { kind: "dashboard" }, loudness: "loud", source: "log-doctest" };
}

function summary(n) {
  const deliveries = n.deliveries.map((d) => `${d.channel}=${d.status}${d.detail ? `(${d.detail})` : ""}`);
  return `${n.intent.id} ${n.intent.title}: ${deliveries.length === 0 ? "(no deliveries)" : deliveries.join(" ")}`;
}
```

## Append, then read back grouped

Each append is one line. The intent line carries the target in its string
form.

```ts
const box = await makeTmpBox();
appendIntent(box.root, { intent: { ...intent("a1", "Vet at 3"), target: { kind: "chat-new" }, tag: "vet" }, now: NOW });
appendDelivery(box.root, { notificationId: "a1", delivery: { channel: "web-push", status: "sent" }, now: NOW });
appendDelivery(box.root, { notificationId: "a1", delivery: { channel: "telegram", status: "failed", detail: "chat not found" }, now: NOW });
appendIntent(box.root, { intent: intent("b2", "Two questions"), now: NOW });
appendDelivery(box.root, { notificationId: "b2", delivery: { channel: "apns", status: "skipped", detail: "no-audience" }, now: NOW });

fs.readFileSync(notificationLogPath(box.root), "utf-8").split("\n")[0]
=> {"kind":"intent","at":"2026-09-26T09:00:00.000Z","id":"a1","title":"Vet at 3","body":"","target":"chat:new","loudness":"loud","tag":"vet","source":"log-doctest"}

(await readRecent(box.root, { days: 1, now: NOW })).map(summary).join("\n")
=>
a1 Vet at 3: web-push=sent telegram=failed(chat not found)
b2 Two questions: apns=skipped(no-audience)

summary(await getIntent(box.root, "b2"))
=> b2 Two questions: apns=skipped(no-audience)

await getIntent(box.root, "zz")
=> null
```

`readRecent` keeps only intents inside the window:

```ts continue
(await readRecent(box.root, { days: 1, now: new Date(NOW.getTime() + 2 * DAY) })).length
=> 0
```

An unparseable line (a crash mid-write, a hand edit) is skipped with a
warning; the lines around it still read:

```ts continue
fs.appendFileSync(notificationLogPath(box.root), "{not json\n");
appendIntent(box.root, { intent: intent("c3", "After the bad line"), now: NOW });
(await readRecent(box.root, { days: 1, now: NOW })).map((n) => n.intent.id).join(" ")
=> a1 b2 c3
```

```ts cleanup
await box.cleanup();
```

## A long body is shortened so the line stays one atomic write

Appends under 4 KB are atomic on the filesystems in use, so the logged body is
cut to fit. The delivered notification is not affected.

```ts
const box = await makeTmpBox();
appendIntent(box.root, { intent: { ...intent("long", "Long"), body: "x".repeat(20_000) }, now: NOW });
const line = fs.readFileSync(notificationLogPath(box.root), "utf-8");
JSON.stringify([Buffer.byteLength(line) < 4000, JSON.parse(line).body.endsWith("…")])
=> [true,true]
```

```ts cleanup
await box.cleanup();
```

## The other fields are bounded, and a line that cannot fit is refused

The tag and the source are cut to 200 characters. A line that is still over
4 KB with its body emptied is refused with an error rather than appended, so
the log never holds a torn line.

```ts
const box = await makeTmpBox();
appendIntent(box.root, { intent: { ...intent("tagged", "Tagged"), tag: "t".repeat(5000), source: "s".repeat(5000) }, now: NOW });
const logged = JSON.parse(fs.readFileSync(notificationLogPath(box.root), "utf-8"));
JSON.stringify([logged.tag.length, logged.tag.endsWith("…"), logged.source.length])
=> [200,true,200]

appendIntent(box.root, { intent: { ...intent("x".repeat(5000), "Huge id"), body: "b".repeat(100) }, now: NOW })
=> throws NotificationLogLineTooLongError

fs.readFileSync(notificationLogPath(box.root), "utf-8").split("\n").filter(Boolean).length
=> 1
```

```ts cleanup
await box.cleanup();
```

## Rotation

The log rotates when its first line is older than 30 days, or when it
exceeds 8 MB. A young, small log is left alone.

```ts
const box = await makeTmpBox();
const OLD = new Date(NOW.getTime() - 31 * DAY);
appendIntent(box.root, { intent: intent("old", "From last month"), now: OLD });

await rotateIfNeeded(box.root, { now: new Date(OLD.getTime() + DAY) })
=> false

await rotateIfNeeded(box.root, { now: NOW })
=> true

fs.readdirSync(path.join(box.root, ".beebox")).filter((f) => f.startsWith("notifications")).sort().join(" ")
=> notifications.1.jsonl
```

A writer that opened the file before the rename still holds the old
descriptor, so its line lands in the rotated file. Readers read both files,
so nothing is lost, and new appends start a fresh file:

```ts continue
appendIntent(box.root, { intent: intent("new", "Fresh file"), now: NOW });
const staleFd = fs.openSync(notificationLogPath(box.root), "a");
await rotateIfNeeded(box.root, { now: new Date(NOW.getTime() + 31 * DAY) });
fs.writeSync(staleFd, JSON.stringify({ kind: "delivery", at: NOW.toISOString(), notificationId: "new", channel: "telegram", status: "sent" }) + "\n");
fs.closeSync(staleFd);
appendIntent(box.root, { intent: intent("later", "After rotation"), now: NOW });

(await readRecent(box.root, { days: 1, now: NOW })).map(summary).join("\n")
=>
new Fresh file: telegram=sent
later After rotation: (no deliveries)
```

The second rotation replaced the first rotated file, so the month-old
intent is gone. A file over 8 MB rotates whatever its age:

```ts continue
await getIntent(box.root, "old")
=> null

fs.truncateSync(notificationLogPath(box.root), 8 * 1024 * 1024 + 1);
await rotateIfNeeded(box.root, { now: NOW })
=> true
```

```ts cleanup
await box.cleanup();
```
