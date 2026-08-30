# Gmail tracked-working-set sync

Regular Gmail sync advances a private history cursor but creates no email
cards unless a thread is already tracked or a bounded rule selects it.

```ts setup
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { initBox } from "../../src/core/box/index.js";
import { createGmailConnector } from "../../src/connectors/gmail.js";
import { trackGmailThread } from "../../src/connectors/gmail-track.js";
import { findTrackedGmailThreads } from "../../src/connectors/gmail-tracking.js";
import { createFakeGoogleGmail } from "../../src/services/google-gmail-fake.js";
import type { GmailMessage } from "../../src/services/google-gmail-types.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

function message(opts: {
  id: string;
  threadId?: string;
  subject: string;
  labelIds?: string[];
}): GmailMessage {
  return {
    id: opts.id,
    threadId: opts.threadId ?? `t-${opts.id}`,
    labelIds: opts.labelIds ?? ["INBOX"],
    internalDate: "1785596400000",
    snippet: `Snippet ${opts.id}`,
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "Message-ID", value: `<${opts.id}@example.com>` },
        { name: "From", value: "sender@example.com" },
        { name: "To", value: "box@example.com" },
        { name: "Subject", value: opts.subject },
      ],
      body: { data: Buffer.from(`Body ${opts.id}`).toString("base64url") },
    },
  };
}

async function transientState(root: string) {
  return JSON.parse(await readFile(join(root, "config/connectors/gmail.state.json"), "utf-8"));
}
```

## A missing config file stops the sync

Gmail is enabled for the box but nothing says what to collect. That is a
misconfiguration, not a quiet no-op: degrading to "no rules" made a stalled
connector indistinguishable from a healthy idle one.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("initialize box");
const result = await createGmailConnector(box.root, createFakeGoogleGmail()).sync();
JSON.stringify({ success: result.success, created: result.created.length })
=> {"success":false,"created":0}

result.error?.includes("no configuration")
=> true
```

```ts cleanup
await box.cleanup();
```

## An empty config means no automatic cards

An explicit `{}` is the way to say "connected, nothing automatic". The initial
run establishes a history checkpoint; existing and later mail stay remote.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed("config/connectors/gmail.json", "{}\n");
box.commitAll("initialize box");
const gmail = createFakeGoogleGmail({
  labels: [{ id: "INBOX", name: "INBOX", type: "system" }],
  messages: [message({ id: "old", subject: "Existing mail" })],
});
const connector = createGmailConnector(box.root, gmail);
(await connector.sync()).created.length
=> 0

gmail.addMessage(message({ id: "new", subject: "New mail" }));
(await connector.sync()).created.length
=> 0

(await findTrackedGmailThreads(box.root)).size
=> 0

(await transientState(box.root)).historyId
=> 2
```

```ts cleanup
await box.cleanup();
```

## Procedure rules return post-sync requests

A procedure action records a bounded summary and returns one coalesced request;
it does not create an email card itself.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed("config/connectors/gmail.json", JSON.stringify({
  rules: [{
    name: "review-mail",
    query: "label:callback",
    action: {
      type: "procedure",
      ref: "config/procedures/review-mail.procedure.card",
    },
  }],
}));
box.commitAll("initialize box");
const gmail = createFakeGoogleGmail({
  labels: [{ id: "Label_7", name: "callback", type: "user" }],
});
const connector = createGmailConnector(box.root, gmail);
await connector.sync();
gmail.addMessage(message({ id: "review", subject: "Review", labelIds: ["Label_7"] }));
const result = await connector.sync();
result.created.length
=> 0

JSON.stringify(result.procedures)
=> [{"procedureRef":"config/procedures/review-mail.procedure.card","directive":"Gmail rule review-mail has new matching mail. Inspect with: bbx connector gmail pending review-mail"}]

(await transientState(box.root)).rules["review-mail"].pending[0].threadId
=> t-review
```

```ts cleanup
await box.cleanup();
```

## Legacy transient state migrates on sync

The obsolete GC timestamp is ignored and removed on the next successful state
write instead of permanently wedging upgraded connectors.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed("config/connectors/gmail.json", "{}\n");
await box.seed("config/connectors/gmail.state.json", JSON.stringify({
  historyId: "1",
  lastReconcileAt: "2026-08-01T00:00:00.000Z",
}));
box.commitAll("initialize box");
const gmail = createFakeGoogleGmail();
const result = await createGmailConnector(box.root, gmail).sync();
result.success
=> true

JSON.stringify(await transientState(box.root))
=> {"historyId":"1"}
```

```ts cleanup
await box.cleanup();
```

## Tracked cards refresh automatically

Once explicitly tracked, a thread is refreshed on regular connector sync. An
untracked thread arriving in the same history window is not materialized.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed("config/connectors/gmail.json", "{}\n");
box.commitAll("initialize box");
const gmail = createFakeGoogleGmail({
  labels: [{ id: "INBOX", name: "INBOX", type: "system" }],
  messages: [message({ id: "m1", threadId: "tracked", subject: "Working thread" })],
});
await trackGmailThread({
  boxRoot: box.root,
  service: gmail,
  threadId: "tracked",
  trackedBy: "explicit-command",
});
const connector = createGmailConnector(box.root, gmail);
let fetchedThreads = 0;
const originalGetThread = gmail.getThread.bind(gmail);
gmail.getThread = async (id) => {
  fetchedThreads += 1;
  return originalGetThread(id);
};
await connector.sync();
fetchedThreads
=> 0

gmail.addMessage(message({ id: "m2", threadId: "tracked", subject: "Working thread" }));
gmail.addMessage(message({ id: "other", threadId: "untracked", subject: "Other thread" }));
const result = await connector.sync();
JSON.stringify({ created: result.created.length, updated: result.updated.length })
=> {"created":2,"updated":1}

fetchedThreads
=> 1

JSON.stringify([...await findTrackedGmailThreads(box.root)].map(([id]) => id))
=> ["tracked"]
```

```ts cleanup
await box.cleanup();
```

## Automatic rules baseline and cap thread creation

Enabling a rule reports its existing match count without importing backlog.
Later matches can create cards, but the rolling cap stops an over-match and
leaves a visible pending summary in private state.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed("config/connectors/gmail.json", JSON.stringify({
  rules: [{
    name: "agent-label",
    query: "label:callback",
    action: { type: "track", budget: { threads: 1, window: "7d" } },
  }],
}));
box.commitAll("initialize box");
const gmail = createFakeGoogleGmail({
  labels: [{ id: "Label_7", name: "callback", type: "user" }],
  messages: [message({ id: "old", subject: "Old labeled", labelIds: ["Label_7"] })],
});
const connector = createGmailConnector(box.root, gmail);
(await connector.sync()).created.length
=> 0

(await transientState(box.root)).rules["agent-label"].baselineMatches
=> 1

gmail.addMessage(message({ id: "first", subject: "First new", labelIds: ["Label_7"] }));
gmail.addMessage(message({ id: "second", subject: "Second new", labelIds: ["Label_7"] }));
const result = await connector.sync();
result.created.length
=> 3

(await findTrackedGmailThreads(box.root)).size
=> 1

const state = await transientState(box.root);
state.rules["agent-label"].pending[0].threadId
=> t-second

state.rules["agent-label"].additionalMatches
=> 0
```

```ts cleanup
await box.cleanup();
```

## Expired history never causes backlog materialization

An expired cursor establishes a new checkpoint, leaves tracked cards in place, and
recounts rule matches. It does not full-list messages into Git.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed("config/connectors/gmail.json", JSON.stringify({ labels: ["callback"], action: { type: "track" } }));
box.commitAll("initialize box");
const gmail = createFakeGoogleGmail({
  labels: [{ id: "Label_7", name: "callback", type: "user" }],
  messages: [message({ id: "old", subject: "Old", labelIds: ["Label_7"] })],
});
const connector = createGmailConnector(box.root, gmail);
await connector.sync();
gmail.expireHistory();
gmail.addMessage(message({ id: "gap", subject: "During gap", labelIds: ["Label_7"] }));
const result = await connector.sync();
result.created.length
=> 0

(await transientState(box.root)).rules["shorthand"].baselineMatches
=> 2
```

```ts cleanup
await box.cleanup();
```

## Deleting a card during refresh does not retrack it

Only an explicit rule selection may create a card. If an already tracked card
disappears after discovery but before the refreshed snapshot is written, sync
leaves it untracked.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed("config/connectors/gmail.json", "{}\n");
box.commitAll("initialize box");
const gmail = createFakeGoogleGmail({
  labels: [{ id: "INBOX", name: "INBOX", type: "system" }],
  messages: [message({ id: "m1", threadId: "deleted-during-sync", subject: "Delete me" })],
});
const tracked = await trackGmailThread({
  boxRoot: box.root,
  service: gmail,
  threadId: "deleted-during-sync",
  trackedBy: "explicit-command",
});
const connector = createGmailConnector(box.root, gmail);
await connector.sync();
gmail.addMessage(message({ id: "m2", threadId: "deleted-during-sync", subject: "Delete me" }));
const originalGetThread = gmail.getThread.bind(gmail);
gmail.getThread = async (id) => {
  await rm(join(box.root, tracked.cardPath), { force: true });
  return originalGetThread(id);
};
const result = await connector.sync();
JSON.stringify({ created: result.created.length, updated: result.updated.length })
=> {"created":0,"updated":0}

(await findTrackedGmailThreads(box.root)).size
=> 0
```

```ts cleanup
await box.cleanup();
```
