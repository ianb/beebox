# reconcilePending

`reconcilePending` decides which optimistic ("pending") user messages
should still be displayed after a fresh server-history fetch arrives.
A pending entry is dropped when the server has caught up to it; the
rest stay visible. Entries explicitly queued while the agent is busy also
carry `pending: true`, which gives them the dimmed "queued — waiting" UI.

```ts setup
import { reconcilePending, mergeAcceptedIntoPending } from "../../src/frontend/src/machines/chat-shared.js";
import type { PendingSessionEntry, SessionEntry } from "../../src/frontend/src/api.js";

function userEntry(uuid: string, text: string): SessionEntry {
  return {
    uuid,
    type: "user",
    timestamp: "2026-01-01T00:00:00Z",
    content: [{ type: "text", text }],
  };
}

function pendingEntry(uuid: string, text: string, reconcileKnownUuids: string[] = []): PendingSessionEntry {
  return { ...userEntry(uuid, text), reconcileKnownUuids };
}
```

## Empty pending → server messages pass through

```ts
const server = [userEntry("s1", "hello")];
const result = reconcilePending({ serverMessages: server, pendingMessages: [] });
print(`messages: ${result.messages.length}`);
print(`pending: ${result.pendingMessages.length}`);
=>
messages: 1
pending: 0
```

## Pending message that the server has caught up to → dropped

```ts
const server = [userEntry("s1", "<typed>hi there</typed>")];
const pending = [pendingEntry("p1", "<typed>hi there</typed>")];
const result = reconcilePending({ serverMessages: server, pendingMessages: pending });
print(`messages: ${result.messages.length}`);
print(`pending: ${result.pendingMessages.length}`);
=>
messages: 1
pending: 0
```

## Pending message not yet on the server → re-appended, kept pending

```ts
const server = [userEntry("s1", "<typed>old</typed>")];
const pending = [pendingEntry("p1", "<typed>new</typed>")];
const result = reconcilePending({ serverMessages: server, pendingMessages: pending });
print(`messages: ${result.messages.length}`);
print(`last message uuid: ${result.messages[result.messages.length - 1]?.uuid}`);
print(`pending: ${result.pendingMessages.length}`);
=>
messages: 2
last message uuid: p1
pending: 1
```

## Server-injected user attribution → reconcile MUST still drop the pending entry

When the server stores a user message, it calls `injectUserAttr` to
add `user="Name" user-email="addr"` into the opening `<typed>` tag.
The optimistic copy doesn't have those attrs yet. Reconcile must
treat the two as the same message — otherwise the pending bubble
sticks around forever after the queued turn completes.

This is the regression behind the "Agent is busy — your message is
queued" indicator that never clears.

```ts
const server = [userEntry(
  "s1",
  '<typed user="Ian" user-email="ian@example.com" local-time="9:00 AM">hello world</typed>',
)];
const pending = [pendingEntry(
  "p1",
  '<typed local-time="9:00 AM">hello world</typed>',
)];
const result = reconcilePending({ serverMessages: server, pendingMessages: pending });
print(`messages: ${result.messages.length}`);
print(`pending (0 expected): ${result.pendingMessages.length}`);
=>
messages: 1
pending (0 expected): 0
```

## Two queued duplicates of one message → both drop after server has the merged turn

The backend's `drainQueue` joins multiple queued texts with `\n\n` into
a single send. So if the user typed the same message twice while busy,
the resulting server entry contains the text twice. Both pending
entries should drop.

```ts
const server = [userEntry(
  "s1",
  '<typed local-time="9:00 AM">say hi</typed>\n\n<typed local-time="9:00 AM">say hi</typed>',
)];
const pending = [
  pendingEntry("p1", '<typed local-time="9:00 AM">say hi</typed>'),
  pendingEntry("p2", '<typed local-time="9:00 AM">say hi</typed>'),
];
const result = reconcilePending({ serverMessages: server, pendingMessages: pending });
print(`pending (0 expected): ${result.pendingMessages.length}`);
=>
pending (0 expected): 0
```

## An older identical message cannot confirm the new send

Short repeated replies are common. A snapshot containing only the already
visible older `"yes"` must keep the new optimistic `"yes"`; only a new server
UUID can confirm it.

```ts
const oldYes = userEntry("s-old", "<typed>yes</typed>");
const pending = [pendingEntry("p-new", "<typed>yes</typed>", [oldYes.uuid])];
const stale = reconcilePending({
  serverMessages: [oldYes],
  pendingMessages: pending,
});
print(`messages after stale snapshot: ${stale.messages.length}`);
print(`pending after stale snapshot: ${stale.pendingMessages.length}`);

const durableYes = userEntry("s-new", "<typed>yes</typed>");
const caughtUp = reconcilePending({
  serverMessages: [oldYes, durableYes],
  pendingMessages: stale.pendingMessages,
});
print(`messages after durable snapshot: ${caughtUp.messages.length}`);
print(`pending after durable snapshot: ${caughtUp.pendingMessages.length}`);
=>
messages after stale snapshot: 2
pending after stale snapshot: 1
messages after durable snapshot: 2
pending after durable snapshot: 0
```

## One durable occurrence confirms only one identical pending send

Two client sends need two server occurrences. A snapshot containing only the
first durable `"yes"` keeps the second optimistic copy visible.

```ts
const durable = userEntry("s-one", "<typed>yes</typed>");
const pending = [
  pendingEntry("p-one", "<typed>yes</typed>"),
  pendingEntry("p-two", "<typed>yes</typed>"),
];
const result = reconcilePending({ serverMessages: [durable], pendingMessages: pending });
print(`messages: ${result.messages.length}`);
print(`remaining uuid: ${result.pendingMessages[0]?.uuid}`);
=>
messages: 2
remaining uuid: p-two
```

## Chronological matching respects each send's baseline

When the second identical send was created after the first durable UUID was
already known, the first pending entry must consume the first echo. Matching
newest-first would consume the second echo incorrectly and strand the newer
pending entry behind its baseline.

```ts
const firstEcho = userEntry("s-first", "<typed>yes</typed>");
const secondEcho = userEntry("s-second", "<typed>yes</typed>");
const pending = [
  pendingEntry("p-first", "<typed>yes</typed>"),
  pendingEntry("p-second", "<typed>yes</typed>", [firstEcho.uuid]),
];
const result = reconcilePending({
  serverMessages: [firstEcho, secondEcho],
  pendingMessages: pending,
});
result.pendingMessages.length
=> 0
```

## A turn whose images were stripped still retires its pending copy

The client's optimistic entry keeps the user's photos as image blocks, which
contribute nothing to the entry's text. The server's copy of the same turn, read
back from a session log whose inline media was stripped for size, has each image
block replaced by placeholder *text*.

Comparing the two verbatim fails: the server's text carries characters the
client's never had. The pending entry is then never retired and the user sees
their own message twice — once with their photos, once with grey placeholders.
A journey walker hit exactly that on 2026-08-24 and reported the app as
duplicating their message.

```ts
const optimistic: PendingSessionEntry = {
  uuid: "m1", type: "user", timestamp: "2026-01-01T00:00:00Z", pending: true,
  reconcileKnownUuids: [],
  content: [
    { type: "image", mediaType: "image/jpeg", dataBase64: "AAAA" },
    { type: "text", text: " " },
    { type: "image", mediaType: "image/jpeg", dataBase64: "BBBB" },
    { type: "text", text: " workroom tray 1" },
  ],
};
const stripped: SessionEntry = {
  uuid: "s1", type: "user", timestamp: "2026-01-01T00:00:01Z",
  content: [
    { type: "text", text: "[image not displayed]" },
    { type: "text", text: " " },
    { type: "text", text: "[image not displayed]" },
    { type: "text", text: " workroom tray 1" },
  ],
};
const out = reconcilePending({ serverMessages: [stripped], pendingMessages: [optimistic] });
JSON.stringify({ rendered: out.messages.length, stillPending: out.pendingMessages.length })
=> {"rendered":1,"stillPending":0}
```

A turn that genuinely has not reached the server yet is still kept, placeholders
or not — the fix must not retire an entry the server has never seen.

```ts continue
const unsent = reconcilePending({ serverMessages: [], pendingMessages: [optimistic] });
JSON.stringify({ rendered: unsent.messages.length, stillPending: unsent.pendingMessages.length })
=> {"rendered":1,"stillPending":1}
```

## mergeAcceptedIntoPending — the box's record and this page's, without doubling

`chat.bootstrap` reports what the box has **accepted** but not yet written into
the transcript. On a fresh page load that list is the only thing standing
between a reload mid-turn and a conversation missing the question the box
already promised to have — the optimistic copies died with the previous page.

```ts
const accepted = [pendingEntry("accepted-7", "<typed>where is the drawer key?</typed>")];
mergeAcceptedIntoPending({ pendingMessages: [], accepted }).map((e) => e.uuid).join(",")
=> accepted-7
```

The two lists describe the same events from different sides, so in the window
where a send lands while the initial fetch is still in flight they overlap. The
server injects `user=`/`user-email=` attributes the optimistic copy never
carried, so the comparison runs through the same normalizer reconciliation uses
— otherwise the message renders twice, once from each side:

```ts continue
const mine = pendingEntry("local-1", "<typed>where is the drawer key?</typed>");
const server = pendingEntry("accepted-7", "<typed user=\"Ada Lovelace\" user-email=\"ada@example.com\">where is the drawer key?</typed>");
mergeAcceptedIntoPending({ pendingMessages: [mine], accepted: [server] }).map((e) => e.uuid).join(",")
=> local-1
```

A match is consumed, so a person who really did send the same words twice keeps
both — one optimistic copy cannot answer for two acceptances:

```ts continue
const twice = [
  pendingEntry("accepted-8", "<typed>yes</typed>"),
  pendingEntry("accepted-9", "<typed>yes</typed>"),
];
mergeAcceptedIntoPending({ pendingMessages: [pendingEntry("local-2", "<typed>yes</typed>")], accepted: twice })
  .map((e) => e.uuid).join(",")
=> local-2,accepted-9
```

An image send is the asymmetric case. The transcript and the optimistic copy
both consume `[image#N]` into image blocks, so their text no longer holds the
token; the box's acceptance record carries the raw text, because the bytes never
reached the bus. Compared naively those are different messages and the send
renders twice:

```ts continue
const withImage = pendingEntry("local-3", "<typed>here is the drawer</typed>");
const acceptedImage = pendingEntry("accepted-11", "<typed>[image#1]here is the drawer</typed>");
mergeAcceptedIntoPending({ pendingMessages: [withImage], accepted: [acceptedImage] }).map((e) => e.uuid).join(",")
=> local-3
```

The token form is not necessarily the same on both sides — the three copies of
one message can come from different eras — so the pre-2026-08-25 spelling has
to normalize away too. A reader that knew only one form would strip the token
on one side and keep it on the other, which is exactly the mismatch this guards
against:

```ts continue
const withImage2 = pendingEntry("local-4", "<typed>here is the drawer</typed>");
const acceptedLegacy = pendingEntry("accepted-12", "<typed>[image1]here is the drawer</typed>");
mergeAcceptedIntoPending({ pendingMessages: [withImage2], accepted: [acceptedLegacy] }).map((e) => e.uuid).join(",")
=> local-4
```

And a repeated load cannot stack copies of one bus row, because the uuid it is
minted from is stable:

```ts continue
const once = mergeAcceptedIntoPending({ pendingMessages: [], accepted });
mergeAcceptedIntoPending({ pendingMessages: once, accepted }).map((e) => e.uuid).join(",")
=> accepted-7
```

Once the transcript catches up, reconciliation retires an accepted entry exactly
as it does a locally-minted one — the point of carrying them in this shape:

```ts continue
const echoed = reconcilePending({
  serverMessages: [userEntry("real-1", "<typed user=\"Ada Lovelace\">where is the drawer key?</typed>")],
  pendingMessages: once,
});
JSON.stringify({ messages: echoed.messages.length, pending: echoed.pendingMessages.length })
=> {"messages":1,"pending":0}
```
