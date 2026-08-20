# One labelling order for every engine

`resolveSessionLabel` names a chat in the history dropdown and the landmark
picker: the husk's editorial `title`, then the first user message, then the
session-id prefix. An engine supplies only *where* that first message is read
from — a Claude transcript on disk, or the Codex app-server's `preview` — and
nothing else about naming a chat is per-engine.

That split is the fix for a real bug. Codex chats used to have their own label
path that sliced `preview` at 400 characters without stripping anything. The
`<chat-app …>` snapshot the composer prepends to a first message is longer than
that on its own, so the cut landed inside the machine prefix: every Codex row in
the list rendered as near-identical envelope markup, and no Codex row could ever
contain what the person typed. The boxholder couldn't find a chat they'd had
that evening.

```ts setup
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveSessionLabel } from "../../../src/core/chat/session-label.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

/** The features snapshot the composer prepends to a session's first message. */
const ENVELOPE = '<chat-app narration="off" prose="on" ' +
  'local-time="Friday 2026-08-14 16:47 CDT (afternoon)" channel="web-desktop" ' +
  'last-activity="1 minute ago" health="chat-review: failing ×1 (last success 37h ago); ' +
  'process-retrospective: failing ×3 (never succeeded); ' +
  'seminar-weekly-research: failing ×1 (last success 64d ago); ' +
  'hearth-inbox-triage: failing ×2 (last success 6d ago)"/>';

/** A first web-chat message as it lands: snapshot, then the send. */
function firstMessage(text: string) {
  return `${ENVELOPE}\n<typed user="Priya Marlowe" user-email="priya@example.com" ` +
    `local-time="16:47">${text}</typed>`;
}

function codexLabel(preview: string | undefined, title?: string) {
  return resolveSessionLabel({
    sessionId: "01a0023e-9c1f",
    title,
    source: { kind: "preview", text: preview },
  });
}
```

## A Codex chat is named by what the person typed

The preview the app-server reports is the thread's verbatim first user message —
envelope and all — so it goes through the same stripping a transcript scan does.

```ts
await codexLabel(firstMessage("Hey, welcome to my little story place!"))
=> Hey, welcome to my little story place!
```

The machine prefix ahead of the person's first word — the snapshot plus the
opening `<typed>`/`<speech>` tag — is longer than the whole 400-character label
budget, which is why slicing the preview raw could never work. The cut landed
before the message began, so the label was *all* prefix, and every Codex row
shared it.

```ts continue
const message = firstMessage("Hey, welcome to my little story place!");
message.indexOf("Hey") > 400
=> true
```

Voice sends carry their own wrappers, including the keyword marker that ended
the utterance. Those come off too.

```ts
await codexLabel(
  '<chat-app narration="off" prose="on" local-time="Friday 2026-08-14 23:14 CDT (late night)"/>\n' +
  '<speech user="Priya Marlowe" local-time="23:14">how is my week looking' +
  '<send-message phrase="Send message." /></speech>',
)
=> how is my week looking
```

## The rest of the order is the same for both engines

A husk title still wins — the nightly chat review's name for a chat beats any
first message.

```ts
await codexLabel(firstMessage("could you look at the rent thing"), "Chasing down a duplicate charge")
=> Chasing down a duplicate charge
```

A Codex thread whose metadata never reached us, or whose first message is
nothing but markup, falls back to the id prefix rather than inventing a name.
Unlike the transcript reader, there's no second message to fall through to —
`preview` is only the first — so this is where a Codex label stops looking.

```ts continue
await codexLabel(undefined)
=> 01a0023e
```

```ts continue
await codexLabel('<chat-app narration="off" prose="on"/>')
=> 01a0023e
```

A Claude chat reaches the same answers through its transcript.

```ts
const box = await makeTmpBox();
const logPath = box.path("log.jsonl");
await mkdir(dirname(logPath), { recursive: true });
await writeFile(logPath, JSON.stringify({
  type: "user",
  timestamp: "2026-08-14T21:47:00Z",
  message: { role: "user", content: [{ type: "text", text: firstMessage("what's on my calendar tomorrow") }] },
}) + "\n");

await resolveSessionLabel({
  sessionId: "claude01-9c1f",
  title: undefined,
  source: { kind: "transcript", logPath },
})
=> what's on my calendar tomorrow
```

An unreadable transcript is a label problem, not a list problem: it warns and
falls back rather than failing the whole enumeration. (Expect the warning below;
that's the fixture.)

```ts continue
await resolveSessionLabel({
  sessionId: "claude01-9c1f",
  title: undefined,
  source: { kind: "transcript", logPath: box.path("gone.jsonl") },
})
=> claude01
```

```ts cleanup
await box.cleanup();
```
