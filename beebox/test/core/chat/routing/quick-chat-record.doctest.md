# Quick chat records: states, old records, and where they live

A quick chat record is one submitted thought. Its `state` is `needs-choice`,
`sending`, `sent`, or `discarded`. The box screen sees a view of the record:
the text, the state, where it went or what to choose, and no probabilities.

```ts setup
import { readdir, utimes, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  parseQuickChatRecord, quickChatView, quickChatChoiceIds,
} from "../../../../src/core/chat/routing/quick-chat-record.js";
import {
  readQuickChatRecord, saveQuickChatRecord, listOpenQuickChatRecords, listRecentlySentQuickChatRecords,
} from "../../../../src/core/chat/routing/quick-chat-store.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";

const NOW = Date.parse("2026-10-06T12:00:00.000Z");
const ID = "11111111-1111-4111-8111-111111111111";
const candidates = [
  { id: "c0", label: "Trip planning", target: { kind: "existing-session", sessionId: "s-trip", contextDir: "_content/Trips" }, landmark: { path: "_content/Trips/Trips.landmark.card", label: "Trips" } },
  { id: "c1", label: "Household", target: { kind: "existing-session", sessionId: "s-house", contextDir: "_content/Household" } },
  { id: "c2", label: "Garden raised beds", target: { kind: "existing-session", sessionId: "s-garden", contextDir: "_content/Garden" } },
  { id: "c3", label: "Recipes notes", target: { kind: "existing-session", sessionId: "s-recipes", contextDir: "_content/Recipes" } },
  { id: "c4", label: "New chat in Trips", target: { kind: "new-session", contextDir: "_content/Trips" }, landmark: { path: "_content/Trips/Trips.landmark.card", label: "Trips" } },
  { id: "c5", label: "New general chat", target: { kind: "new-session", contextDir: "" } },
];
const base = { id: ID, message: "Remind me to renew my passport", createdAt: "2026-10-06T11:59:00.000Z", candidates,
  probabilities: { c0: 0.85, c1: 0.01, c2: 0, c3: 0, c4: 0, c5: 0.14 }, model: "synthetic-jev", confidence: 0.85, preferenceApplied: false };
const trip = { label: "Trip planning", sessionId: "s-trip" };
const delivery = { session: "s-trip", exactSession: true, contextDir: "_content/Trips", engine: "claude" };
const sending = { ...base, state: "sending", selected: candidates[0], delivery, destination: trip,
  deliveryStartedAt: "2026-10-06T11:59:01.000Z", lastError: "Chat is not running" };
const legacy = { ...base, selected: candidates[4], delivery: { session: "new", exactSession: false, contextDir: "_content/Trips", engine: "codex" } };
```

## Each state has its own view

An uncertain thought offers its choices by candidate id, with the landmark as
detail for an existing chat. The probabilities stay in the record.

```ts
quickChatView(parseQuickChatRecord({ ...base, state: "needs-choice", reason: "uncertain", choices: ["c0", "c5", "c1"] }), NOW)
=> {
  id: "11111111-1111-4111-8111-111111111111", message: "Remind me to renew my passport",
  createdAt: "2026-10-06T11:59:00.000Z", state: "needs-choice", reason: "uncertain",
  choices: [
    { candidateId: "c0", label: "Trip planning", detail: "Trips" },
    { candidateId: "c5", label: "New general chat" },
    { candidateId: "c1", label: "Household" },
  ],
}
```

A `sending` record names its destination before delivery, and shows the last
failed attempt. A `sent` record says whether the chat was busy.

```ts
const { id: _sendingId, message: _sendingMessage, createdAt: _sendingCreated, ...sendingView } = quickChatView(parseQuickChatRecord(sending), NOW);
sendingView
=> { state: "sending", destination: { label: "Trip planning", sessionId: "s-trip" }, lastError: "Chat is not running" }

const { id: _sentId, message: _sentMessage, createdAt: _sentCreated, ...sentView } = quickChatView(parseQuickChatRecord({ ...sending, state: "sent", lastError: undefined, queued: true, sentAt: "2026-10-06T11:59:02.000Z" }), NOW);
sentView
=> { state: "sent", destination: { label: "Trip planning", sessionId: "s-trip" }, queued: true }

quickChatView(parseQuickChatRecord({ ...base, state: "discarded", discardedAt: "2026-10-06T11:59:03.000Z" }), NOW).state
=> discarded
```

Past six days from the first delivery attempt, the message-id claim that
prevents a second copy is about to expire. The view stops offering Retry and
sends the person to the chat to check.

```ts
const late = quickChatView(parseQuickChatRecord({ ...sending, deliveryStartedAt: "2026-09-30T11:00:00.000Z" }), NOW);
[late.expired, late.lastError]
=> [true, "This may already be in Trip planning. Open the chat to check."]
```

## Records written before states existed

`quickChat.prepare` wrote records with no `state`. One with a `receipt` was
sent; its receipt's session id wins over the reserved one. One without a
receipt may or may not have been sent, so it reads as `sending`, with its
delivery window starting at creation.

```ts
const receipted = parseQuickChatRecord({ ...legacy, receipt: { sessionId: "s-assigned", turnId: "t1", queued: true } });
[receipted.state, receipted.destination, receipted.queued, "sentAt" in receipted]
=> ["sent", { label: "New chat in Trips", sessionId: "s-assigned" }, true, false]

const unreceipted = parseQuickChatRecord(legacy);
[unreceipted.state, unreceipted.destination, unreceipted.deliveryStartedAt]
=> ["sending", { label: "New chat in Trips" }, "2026-10-06T11:59:00.000Z"]
```

A record that matches neither shape is refused rather than guessed at.

```ts
parseQuickChatRecord({ ...base, state: "sending" })
=> throws ZodError«*»
```

## Choices

An uncertain thought offers the three most likely destinations and a new
general chat when it is not among them. Without a judgment, the three most
recent chats stand in, in catalog order. A destination that has gone is never
offered again.

```ts
[
  quickChatChoiceIds({ candidates, probabilities: base.probabilities }),
  quickChatChoiceIds({ candidates, probabilities: { c0: 0.5, c1: 0.3, c2: 0.2, c3: 0, c4: 0, c5: 0 } }),
  quickChatChoiceIds({ candidates, probabilities: {} }),
  quickChatChoiceIds({ candidates, probabilities: base.probabilities, exclude: "c0" }),
  quickChatChoiceIds({ candidates: [candidates[5]], probabilities: {} }),
]
=> [["c0", "c5", "c1"], ["c0", "c1", "c2", "c5"], ["c0", "c1", "c2", "c5"], ["c5", "c1", "c2"], ["c5"]]
```

## Open records live apart from finished ones

A record that still needs the person, or is still being delivered, lives in
`open/`. It moves out when it is sent or discarded, so listing what needs the
person reads only unfinished records.

```ts
const box = await makeTmpBox();
const record = parseQuickChatRecord({ ...base, state: "needs-choice", reason: "uncertain", choices: ["c0"] });
await saveQuickChatRecord(box.root, record);
const files = async () => [
  ...(await readdir(join(box.root, ".beebox/quick-chat"))).filter((name) => name !== "open"),
  ...(await readdir(join(box.root, ".beebox/quick-chat/open"))).map((name) => `open/${name}`),
];
[await files(), (await listOpenQuickChatRecords(box.root)).map((item) => item.state)]
=> [["open/11111111-1111-4111-8111-111111111111.json"], ["needs-choice"]]

await saveQuickChatRecord(box.root, { ...sending, state: "sent", lastError: undefined, sentAt: new Date(NOW).toISOString() });
[await files(), await listOpenQuickChatRecords(box.root), (await readQuickChatRecord(box.root, ID))?.state]
=> [["11111111-1111-4111-8111-111111111111.json"], [], "sent"]
```

A crash after writing the finished record and before removing the open copy
leaves both. The finished one wins, and the open listing skips it.

```ts continue
await mkdir(join(box.root, ".beebox/quick-chat/open"), { recursive: true });
await writeFile(join(box.root, ".beebox/quick-chat/open", `${ID}.json`), JSON.stringify(sending));
[(await readQuickChatRecord(box.root, ID))?.state, await listOpenQuickChatRecords(box.root)]
=> ["sent", []]
```

An old record without a receipt sits in the closed location. When a retry
writes it as `sending` again, the open copy is the current one.

```ts continue
const OLD = "22222222-2222-4222-8222-222222222222";
await writeFile(join(box.root, ".beebox/quick-chat", `${OLD}.json`), JSON.stringify({ ...legacy, id: OLD }));
const oldRecord = await readQuickChatRecord(box.root, OLD);
await saveQuickChatRecord(box.root, { ...oldRecord, lastError: "Chat is not running" });
(await readQuickChatRecord(box.root, OLD))?.lastError
=> Chat is not running
```

Recently sent records are the ones sent in the last day, newest first, at most
the limit. A record sent two days ago is not recent even when its file was
touched later.

```ts continue
const SENT_A = "33333333-3333-4333-8333-333333333333";
const SENT_OLD = "44444444-4444-4444-8444-444444444444";
await saveQuickChatRecord(box.root, { ...sending, id: SENT_A, state: "sent", lastError: undefined, sentAt: new Date(NOW - 60_000).toISOString() });
await saveQuickChatRecord(box.root, { ...sending, id: SENT_OLD, state: "sent", lastError: undefined, sentAt: new Date(NOW - 2 * 86_400_000).toISOString() });
const touched = new Date(NOW - 120_000);
await utimes(join(box.root, ".beebox/quick-chat", `${SENT_A}.json`), touched, touched);
[
  (await listRecentlySentQuickChatRecords(box.root, { now: NOW, limit: 5 })).map((item) => item.id),
  (await listRecentlySentQuickChatRecords(box.root, { now: NOW, limit: 1 })).map((item) => item.id),
]
=> [["11111111-1111-4111-8111-111111111111", "33333333-3333-4333-8333-333333333333"], ["11111111-1111-4111-8111-111111111111"]]
```

```ts cleanup
await box.cleanup();
```
