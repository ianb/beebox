# Question alerts (finalize-time sweep)

`checkPendingQuestionsAndNotify` diffs the box's currently-pending questions
against a per-box latch and notifies the boxholder about newly-pending ones —
no per-producer hook, just a sweep. Each question notifies once while it stays
pending. A new question is a `dot` (a badge on the phone); a question
carrying `urgency: time-bound` makes the sweep `quiet`, which a subscribed
browser receives.

```ts setup
import { boxSlug } from "../../src/lib/box-slug.js";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { checkPendingQuestionsAndNotify } from "../../src/core/question-alert.js";
import { addSubscription } from "../../src/core/push-subscriptions.js";
import { createFakePush } from "../../src/services/push.js";
import { readRecent } from "../../src/core/notification/log.js";

const storeDir = path.join(os.tmpdir(), `bbx-qalert-${process.pid}-${Date.now()}`);
process.env.BBX_PUSH_STORE_DIR = storeDir;

const NOW = new Date("2026-06-29T12:00:00Z");
const SUB = { endpoint: "https://push.example/d1", keys: { p256dh: "p", auth: "a" } };

function question(prompt, urgency) {
  const extra = urgency === undefined ? "" : `urgency: ${urgency}\n`;
  return `---\nprompt: ${prompt}\ninput:\n  type: text\n${extra}---\n`;
}

// The newest logged intent: its loudness, target, and each delivery.
async function lastLogged(box) {
  const n = (await readRecent(box.root, { days: 1, now: NOW })).at(-1);
  const deliveries = n.deliveries.map((d) => `${d.channel} ${d.status}${d.detail ? `: ${d.detail}` : ""}`);
  return [`${n.intent.loudness} → ${n.intent.target}`, ...deliveries].join("\n");
}

const MARKER = JSON.stringify({ shapeVersion: 3, version: "1.0.0", created: NOW.toISOString() });
```

## A newly-pending question notifies once, then latches

```ts
const box = await makeTmpBox({ git: true });
await box.seed(".beebox/box.json", MARKER);
await addSubscription({ boxSlug: await boxSlug(box.root), subscription: SUB, now: NOW });
await box.seed("_bookkeeping/questions/Color.question.card", question("What color?"));
box.commitAll("seed question");

const push = createFakePush();
const first = await checkPendingQuestionsAndNotify(box.root, { now: NOW, push });
JSON.stringify(first.notified)
=> ["_bookkeeping/questions/Color.question.card"]
```

It is a `dot` targeting the question card. A dot goes to paired phones only,
and this box has none, so the subscribed browser gets nothing:

```ts continue
await lastLogged(box)
=>
dot → question:_bookkeeping/questions/Color.question.card
apns skipped: no-audience

push.sent.length
=> 0
```

A second sweep finds nothing new (the question is latched):

```ts continue
await checkPendingQuestionsAndNotify(box.root, { now: NOW, push })
=> null
```

## A second question notifies only the new one

```ts continue
await box.seed("_bookkeeping/questions/Size.question.card", question("What size?"));
const third = await checkPendingQuestionsAndNotify(box.root, { now: NOW, push });
JSON.stringify(third.notified)
=> ["_bookkeeping/questions/Size.question.card"]
```

## A time-bound question is `quiet`

A question that blocks something with a date sends a muted notification, so
the subscribed browser receives it, deep-linked to the card:

```ts continue
await box.seed("_bookkeeping/questions/Form.question.card", question("Sign the form by Friday?", "time-bound"));
await checkPendingQuestionsAndNotify(box.root, { now: NOW, push });
await lastLogged(box)
=>
quiet → question:_bookkeeping/questions/Form.question.card
apns skipped: no-audience
web-push sent
telegram skipped: no-audience

push.sent[0]?.payload.url === `/${await boxSlug(box.root)}/browse/_bookkeeping/questions/Form.question.card`
=> true
```

```ts cleanup
await box.cleanup();
await fs.rm(storeDir, { recursive: true, force: true });
```

## No reachable channel → no sweep

```ts
const box = await makeTmpBox({ git: true });
await box.seed(".beebox/box.json", MARKER);
await box.seed("_bookkeeping/questions/Color.question.card", question("What color?"));
box.commitAll("seed");

await checkPendingQuestionsAndNotify(box.root, { now: NOW })
=> null
```

```ts cleanup
await box.cleanup();
```
