# Google Gmail service

Fake Google Gmail maintains in-memory messages, labels, and attachments.

```ts setup
import { createFakeGoogleGmail } from "../src/services/google-gmail.js";
import { withCallLog, printCalls } from "../src/services/call-log.js";
```

## Empty by default

```ts
const svc = createFakeGoogleGmail();
(await svc.listMessages({})).messages.length
=> 0
```

## Listing returns id + threadId refs

```ts
const svc = createFakeGoogleGmail({
  messages: [
    { id: "m1", threadId: "t1" },
    { id: "m2", threadId: "t1" },
    { id: "m3", threadId: "t2" },
  ],
});
const result = await svc.listMessages({ q: "label:inbox" });
JSON.stringify(result.messages.map(m => m.id))
=> ["m1","m2","m3"]
```

## Fetching a message

```ts
const svc = createFakeGoogleGmail({
  messages: [
    {
      id: "m1",
      threadId: "t1",
      labelIds: ["INBOX"],
      snippet: "Hello there",
      internalDate: "1700000000000",
      payload: {
        mimeType: "text/plain",
        headers: [{ name: "Subject", value: "Hi" }],
        body: { data: "SGVsbG8" },
      },
    },
  ],
});
const msg = await svc.getMessage("m1");
msg.snippet
=> Hello there
```

```ts continue
msg.payload?.headers?.[0]?.value
=> Hi
```

## Missing message throws

```ts
const svc = createFakeGoogleGmail();
let err = null;
await svc.getMessage("missing").catch((e) => { err = e.message; });
err
=> Message not found: missing
```

## Attachments are keyed by messageId:attachmentId

```ts
const svc = createFakeGoogleGmail({
  attachments: new Map([
    ["m1:a1", { data: "ZmlsZQ", size: 4 }],
  ]),
});
const att = await svc.getAttachment("m1", "a1");
att.size
=> 4
```

## Listing labels

```ts
const svc = createFakeGoogleGmail({
  labels: [
    { id: "INBOX", name: "INBOX", type: "system" },
    { id: "Label_1", name: "Work", type: "user" },
  ],
});
(await svc.listLabels()).map(l => l.name).join(", ")
=> INBOX, Work
```

## History tracking

Messages passed at construction predate history (no records). `addMessage`
and `addLabelsToMessage` advance the historyId and record changes, which
`listHistory` replays from a checkpoint:

```ts
const svc = createFakeGoogleGmail({
  messages: [{ id: "m0", threadId: "t0" }],
});
const before = await svc.getProfile();
before.historyId
=> 1

svc.addMessage({ id: "m1", threadId: "t1", labelIds: ["INBOX"] });
svc.addLabelsToMessage({ id: "m0", labelIds: ["Label_1"] });
const result = await svc.listHistory({ startHistoryId: before.historyId });
result.historyId
=> 3

JSON.stringify(result.history[0]?.messagesAdded?.[0]?.message.id)
=> "m1"

JSON.stringify(result.history[1]?.labelsAdded?.[0]?.labelIds)
=> ["Label_1"]

// Replaying from the latest checkpoint returns nothing new
(await svc.listHistory({ startHistoryId: result.historyId })).history.length
=> 0
```

`expireHistory` invalidates stored checkpoints, like Gmail aging out
history — `listHistory` then throws NotFoundError and callers fall back to
a full list:

```ts continue
svc.expireHistory();
let err = null;
await svc.listHistory({ startHistoryId: result.historyId }).catch((e) => { err = e.message; });
err
=> History not found: 3
```

## Call logging

```ts
const svc = withCallLog(createFakeGoogleGmail());
await svc.listMessages({ q: "label:inbox" });
printCalls(svc.callLog, "listMessages")
=> listMessages({"q":"label:inbox"})
```

## Creating drafts

The fake assigns sequential `r-fake-N` / `m-fake-N` IDs and stores each
draft (with the raw MIME) on `.drafts` for inspection.

```ts
const svc = createFakeGoogleGmail();
const draft = await svc.createDraft({ raw: "VG86IGFsaWNl" });
draft.id
=> r-fake-1
```

```ts continue
draft.message.id
=> m-fake-1

JSON.stringify(draft.message.labelIds)
=> ["DRAFT"]

svc.drafts.length
=> 1

svc.drafts[0]?.raw
=> VG86IGFsaWNl
```

When `threadId` is passed it is preserved on the returned draft (so reply
drafts thread onto an existing conversation).

```ts
const svc = createFakeGoogleGmail();
const draft = await svc.createDraft({ raw: "Zm9v", threadId: "t-existing" });
draft.message.threadId
=> t-existing
```
