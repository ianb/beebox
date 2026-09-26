# Callouts at turn end

A `<callout>` marks content the person must read. At turn end the server
parses a turn's callouts (`parseCalloutTags`) and sends one notification for
them (`notifyTurnCallouts`): titled by the first callout's `context`, carrying
its body, as loud as the loudest `loudness` any callout asked for (else `dot`),
targeting the chat session. See docs/plans/notifications.md (Track E).

```ts setup
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { boxSlug } from "../../../src/lib/box-slug.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { parseCalloutTags, notifyTurnCallouts } from "../../../src/core/chat/callout-tags.js";
import { addSubscription } from "../../../src/core/push-subscriptions.js";
import { createFakePush } from "../../../src/services/push.js";
import { readRecent } from "../../../src/core/notification/log.js";
import { writePresence } from "../../../src/core/notification/presence.js";

const storeDir = path.join(os.tmpdir(), `bbx-callouts-${process.pid}-${Date.now()}`);
process.env.BBX_PUSH_STORE_DIR = storeDir;
for (const name of ["BBX_NOTIFY_FAKE", "BBX_PUSH_FAKE"]) delete process.env[name];

const SESSION = "5f0c2a9e-1111-4c1d-9e2b-000000000001";
const SUB = { endpoint: "https://push.example/callouts", keys: { p256dh: "p", auth: "a" } };

/** The newest logged intent and its deliveries. */
async function lastLogged(box) {
  const n = (await readRecent(box.root, { days: 1 })).at(-1);
  if (n === undefined) return "nothing logged";
  const { title, body, target, loudness, tag, source } = n.intent;
  const deliveries = n.deliveries.map((d) => `${d.channel} ${d.status}${d.detail ? `: ${d.detail}` : ""}`);
  return [`${loudness} | ${title} | ${target} | tag ${tag === SESSION} | ${source === `chat:${SESSION}`}`, body, ...deliveries].join("\n");
}
```

## Parsing

`context` and `loudness` are optional; an unknown `loudness` is ignored (with a
warning), and the body is trimmed:

```ts
JSON.stringify(parseCalloutTags(`Done.
<callout context="you asked about Saturday">
Saturday: sunny, high of 72.
</callout>
<callout loudness="loud">The form is due Friday.</callout>
<callout loudness="shout">Odd one.</callout>`), null, 1)
=> [
 {
  "context": "you asked about Saturday",
  "loudness": null,
  "body": "Saturday: sunny, high of 72."
 },
 {
  "context": null,
  "loudness": "loud",
  "body": "The form is due Friday."
 },
 {
  "context": null,
  "loudness": null,
  "body": "Odd one."
 }
]

parseCalloutTags("No tags here, and <speech>not a callout</speech>.").length
=> 0
```

## A turn without callouts sends nothing

```ts
const box = await makeTmpBox({ git: true });
await addSubscription({ boxSlug: await boxSlug(box.root), subscription: SUB, now: new Date() });
const push = createFakePush();

await notifyTurnCallouts(box.root, { text: "All filed.", sessionId: SESSION, services: { push } })
=> null

await lastLogged(box)
=> nothing logged
```

## A `quiet` callout with nobody present is pushed

The loudest callout sets the loudness; the first one titles and carries the
notification. With no `context`, the title is the body's first line.

```ts continue
const text = `<callout loudness="quiet">The school moved the field trip to Thursday.
Forms are due Wednesday.</callout> and <callout context="later">second</callout>`;
await notifyTurnCallouts(box.root, { text, sessionId: SESSION, services: { push } });
await lastLogged(box)
=>
quiet | The school moved the field trip to Thursday. | chat:5f0c2a9e-1111-4c1d-9e2b-000000000001 | tag true | true
The school moved the field trip to Thursday.
Forms are due Wednesday.
apns skipped: no-audience
web-push sent
telegram skipped: no-audience

push.sent[0].payload.url === `/${await boxSlug(box.root)}/chat?session=${SESSION}`
=> true
```

## With someone present, a `quiet` callout is not pushed

The open app shows it; each channel logs `skipped: present`.

```ts continue
await writePresence(box.root, { activeWeb: 1, now: new Date() });
await notifyTurnCallouts(box.root, { text: `<callout context="you asked" loudness="quiet">Booked.</callout>`, sessionId: SESSION, services: { push } });
await lastLogged(box)
=>
quiet | you asked | chat:5f0c2a9e-1111-4c1d-9e2b-000000000001 | tag true | true
Booked.
apns skipped: present
web-push skipped: present
telegram skipped: present

push.sent.length
=> 1
```

A callout with no `loudness` is a `dot`: a badge on paired phones only, sent
whatever the presence.

```ts continue
await notifyTurnCallouts(box.root, { text: `<callout context="note">Filed the receipt.</callout>`, sessionId: SESSION, services: { push } });
(await lastLogged(box)).split("\n")[0].startsWith("dot | note")
=> true
```

```ts cleanup
await box.cleanup();
await fs.rm(storeDir, { recursive: true, force: true });
```
