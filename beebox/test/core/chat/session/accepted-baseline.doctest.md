# An acceptance is reconciled by its own echo, not blacklisted by it

`chat.bootstrap` answers a page load with two records: the `history` (what is
durable) and `pending` (what the box has *accepted* but the transcript may not
show yet — `accepted-messages.ts`). The client merges them with
`reconcilePending`, retiring a pending copy once a transcript entry repeating
its words arrives.

Each pending message carries a **baseline** of entry uuids that cannot serve as
that echo. Without one, an old turn that happens to repeat the same words
answers a new message, which then vanishes on reload.

The baseline has to be dated per message. When it was "every uuid in the
history being returned", it also blacklisted each message's OWN echo whenever
the transcript had already caught up by the time bootstrap ran — which is
exactly what a reload does. The pending copy could then never be retired, and
`reconcilePending` appends what is left after the server messages, so a reload
pinned duplicates of the last few messages to the bottom of the chat until they
aged out of the ten-minute acceptance window.

```ts setup
import { readAcceptedMessages } from "../../../../src/core/chat/session/accepted-messages.js";
import { reconcilePending } from "../../../../src/frontend/src/machines/chat-shared.js";
import { createEventBus } from "../../../../src/core/event-bus.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";

const SESSION = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-08-26T13:00:00.000Z");

/** One transcript entry, as both records name it: a uuid and a moment. */
function entry(uuid: string, timestamp: string, text: string) {
  return { uuid, type: "user" as const, timestamp, content: [{ type: "text" as const, text }] };
}

function accept(bus, at: string, message: string) {
  bus.emit("chat-user-message", { sessionId: SESSION, timestamp: at, message, user: null });
}

function textOf(e) {
  return e.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}
```

## The reload that produced duplicates

A conversation that already contains the word "yes", then a message accepted at
12:54 whose echo the agent wrote eight seconds later. By the time the page
reloads, both are in the history.

```ts
const box = await makeTmpBox();
const bus = createEventBus(box.root);
accept(bus, "2026-08-26T12:54:34.000Z", "yes");

const history = [
  entry("item-100", "2026-08-26T11:00:00.000Z", "yes"),
  entry("item-255", "2026-08-26T12:54:42.000Z", "yes"),
];
const [pending] = readAcceptedMessages(bus, {
  sessionId: SESSION,
  now: NOW,
  viewerEmail: null,
  history: history.map((e) => ({ uuid: e.uuid, timestamp: e.timestamp })),
});

// The old entry cannot answer for this message; the echo can.
JSON.stringify(pending.reconcileKnownUuids)
=> ["item-100"]
```

So the client retires it, and the conversation is the two entries it actually
contains — not three with the last one repeated.

```ts continue
const merged = reconcilePending({ serverMessages: history, pendingMessages: [pending] });
JSON.stringify({ messages: merged.messages.map((e) => e.uuid), stillPending: merged.pendingMessages.length })
=> {"messages":["item-100","item-255"],"stillPending":0}
```

## What the baseline is still for

Nothing above weakens the protection it was added for. Take the same
conversation with the echo not yet written: the only "yes" on record is the old
one, and it must not answer for the new message.

```ts continue
const [stillWaiting] = readAcceptedMessages(bus, {
  sessionId: SESSION,
  now: NOW,
  viewerEmail: null,
  history: [{ uuid: "item-100", timestamp: "2026-08-26T11:00:00.000Z" }],
});
const notYet = reconcilePending({
  serverMessages: [history[0]],
  pendingMessages: [stillWaiting],
});

JSON.stringify({ messages: notYet.messages.map(textOf), stillPending: notYet.pendingMessages.length })
=> {"messages":["yes","yes"],"stillPending":1}
```

An entry with no usable timestamp counts as older, so it never stands in as the
echo. The echo is written after the acceptance — the agent receives the message,
then records it — so an undatable entry is old history far more often than it is
the thing being waited for, and letting it reconcile would retire a message it
has nothing to do with.

```ts continue
const [undated] = readAcceptedMessages(bus, {
  sessionId: SESSION,
  now: NOW,
  viewerEmail: null,
  history: [{ uuid: "item-100", timestamp: "" }],
});

JSON.stringify(undated.reconcileKnownUuids)
=> ["item-100"]
```
