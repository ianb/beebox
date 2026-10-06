# The box screen's page state

The web box screen (`pages/box-screen/BoxScreenPage.tsx`) takes a new thought
and shows what became of each one. Its state is the pure reducer in
`pages/box-screen/state.ts`; the page only wires it to storage and to the
`quickChat` procedures. The views below are the shared contract fixtures, so
the web page reads the same answers the phone does.

```ts setup
import { readFileSync } from "node:fs";
import {
  boxScreenReducer, boxScreenRows, boxScreenStorageKey, parseStoredBoxScreen, pendingRetry,
  restoreBoxScreen, rowFace, storedBoxScreen, submission, unsentStatus,
} from "../../../src/pages/box-screen/state.js";

const fixtures = new URL("../../../../../test/mobile-contract/fixtures/quick-chat/", import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(new URL(`${name}.json`, fixtures), "utf8")).result.data;
const fresh = () => restoreBoxScreen({ draft: "", unsent: null });
const run = (state, actions) => actions.reduce(boxScreenReducer, state);
const ID = "11111111-2222-4333-8444-555555555555";
const OTHER_ID = "99999999-8888-4777-8666-555555555555";
```

## Each row face

A sent thought names its chat and links to it. "Open chat" only navigates; it
puts nothing in the chat's composer.

```ts
rowFace(fixture("view-sent"))
=> { kind: "sent", title: "Sent to Trip planning", link: { kind: "chat", sessionId: "0b7d4c1e-6a2f-4e8b-9c3d-2f1a5e7b9d40" } }

rowFace(fixture("view-sent-queued")).title
=> Queued in Trip planning
```

A new chat on an engine that assigns its id later has no session to open, so
the row offers the chat list:

```ts
rowFace(fixture("view-sent-no-session")).link
=> { kind: "all-chats" }
```

A thought that needs the person says why in words and offers the choices. No
percentages reach the page.

```ts
rowFace(fixture("view-needs-choice-uncertain"))
=> {
  kind: "needs-choice",
  title: "Not sure where this goes",
  choices: [
    { candidateId: "c2", label: "Trip planning", detail: "Travel" },
    { candidateId: "c9", label: "New general chat" },
    { candidateId: "c0", label: "Household", detail: "Home" },
  ],
}

rowFace(fixture("view-needs-choice-routing-unavailable")).title
=> Could not sort this

rowFace(fixture("view-needs-choice-destination-gone")).title
=> That chat is gone
```

A delivery that failed offers Retry and Discard, with the server's sentence:

```ts
rowFace(fixture("view-sending-not-delivered"))
=> { kind: "not-delivered", title: "Not delivered", detail: "Chat is not running on the box. Retry in a moment." }
```

Past six days a retry could post twice, so the row sends the person to the
chat to check, and offers no Retry:

```ts
rowFace(fixture("view-sending-expired"))
=> { kind: "expired", title: "This may already be in Trip planning. Open the chat to check.", link: { kind: "chat", sessionId: "0b7d4c1e-6a2f-4e8b-9c3d-2f1a5e7b9d40" } }

rowFace(fixture("view-discarded"))
=> { kind: "discarded" }
```

## Sending a thought

Send keeps the id and text as `unsent` until `submit` answers. The input
clears on the answer, and the answer becomes a row.

```ts
let state = run(fresh(), [{ type: "edit", text: "  Call the plumber  " }]);
const unsent = submission(state, ID);
unsent
=> { id: "11111111-2222-4333-8444-555555555555", message: "Call the plumber" }

state = run(state, [{ type: "submit-started", unsent }]);
[unsentStatus(state), storedBoxScreen(state)]
=> ["Sending…", { draft: "  Call the plumber  ", unsent: { id: "11111111-2222-4333-8444-555555555555", message: "Call the plumber" } }]

const answer = { id: ID, message: "Call the plumber", createdAt: "2026-10-06T15:00:00.000Z", state: "needs-choice", reason: "routing-unavailable", choices: [{ candidateId: "general", label: "New general chat" }] };
state = run(state, [{ type: "submit-answered", view: answer }]);
[state.draft, state.unsent, unsentStatus(state)]
=> ["", null, null]

boxScreenRows(undefined, state).needsYou.map((view) => rowFace(view).title)
=> ["Could not sort this"]
```

A failed request keeps the thought. Sending the same text again reuses its id;
edited text is a new thought.

```ts
let state = run(fresh(), [{ type: "edit", text: "Call the plumber" }]);
state = run(state, [{ type: "submit-started", unsent: submission(state, ID) }, { type: "submit-failed", error: "Failed to fetch" }]);
unsentStatus(state)
=> Not sent: Failed to fetch

submission(state, OTHER_ID).id
=> 11111111-2222-4333-8444-555555555555

submission(run(state, [{ type: "edit", text: "Call the electrician" }]), OTHER_ID)
=> { id: "99999999-8888-4777-8666-555555555555", message: "Call the electrician" }
```

## Reload with a stored unsent thought

The page stored the thought and closed before `submit` answered. On reload the
text is back in the input and the page submits it again on its own, with the
same id, so the server answers with the record it may already have.

```ts
const raw = JSON.stringify({ draft: "", unsent: { id: ID, message: "Book the vet" } });
const state = restoreBoxScreen(parseStoredBoxScreen(raw));
[state.draft, unsentStatus(state), pendingRetry(state)]
=> ["Book the vet", "Waiting to send", { id: "11111111-2222-4333-8444-555555555555", message: "Book the vet" }]

pendingRetry(run(state, [{ type: "submit-started", unsent: pendingRetry(state) }]))
=> null
```

If `home` already lists that record (the answer was lost, not the request), the
row stays out of "Needs you" until the retry answers, so the thought shows once:

```ts continue
const home = { open: [{ id: ID, message: "Book the vet", createdAt: "2026-10-06T15:00:00.000Z", state: "needs-choice", reason: "uncertain", choices: [] }], recentlySent: [] };
boxScreenRows(home, state).needsYou.length
=> 0
```

A malformed stored value is dropped with a warning rather than breaking the
page, and the key is the box screen's own, never the chat composer's:

```ts
parseStoredBoxScreen("{not json")
=> { draft: "", unsent: null }

[boxScreenStorageKey({ boxSlug: "test1", scope: "" }), boxScreenStorageKey({ boxSlug: "test1", scope: "main/test1" })]
=> ["bbx-box-screen:test1", "bbx-box-screen:main/test1"]
```

## Rows merge `home` with this page's answers

An answer replaces `home`'s copy of the same record. A discarded record leaves
the screen, and a chosen one moves from "Needs you" to sent.

```ts
const home = fixture("home");
const [uncertain, notDelivered] = home.open;
let state = run(fresh(), [
  { type: "row-started", id: uncertain.id },
  { type: "row-answered", view: { ...uncertain, state: "sent", reason: undefined, choices: undefined, destination: { label: "Trip planning" } } },
  { type: "row-answered", view: { ...notDelivered, state: "discarded", destination: undefined, lastError: undefined } },
]);
const rows = boxScreenRows(home, state);
[rows.needsYou.length, rows.sent.map((view) => rowFace(view).title), state.busy]
=> [0, ["Sent to Trip planning", "Queued in Household"], []]
```

A failed choose or discard leaves the row and says what went wrong:

```ts
const state = run(fresh(), [{ type: "row-started", id: ID }, { type: "row-failed", id: ID, error: "Chat is not running" }]);
[state.busy, state.rowErrors]
=> [[], { "11111111-2222-4333-8444-555555555555": "Chat is not running" }]
```
