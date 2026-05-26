# Google Gmail service

Fake Google Gmail maintains in-memory messages, labels, and attachments.

```ts setup
import { createFakeGoogleGmail } from "../src/services/google-gmail.js";
import { withCallLog, printCalls } from "../src/services/call-log.js";
```

## Empty by default

```
const svc = createFakeGoogleGmail();
(await svc.listMessages({})).messages.length
=> 0
```

## Listing returns id + threadId refs

```
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

```
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

``` continue
msg.payload?.headers?.[0]?.value
=> Hi
```

## Missing message throws

```
const svc = createFakeGoogleGmail();
let err = null;
await svc.getMessage("missing").catch((e) => { err = e.message; });
err
=> Message not found: missing
```

## Attachments are keyed by messageId:attachmentId

```
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

```
const svc = createFakeGoogleGmail({
  labels: [
    { id: "INBOX", name: "INBOX", type: "system" },
    { id: "Label_1", name: "Work", type: "user" },
  ],
});
(await svc.listLabels()).map(l => l.name).join(", ")
=> INBOX, Work
```

## Call logging

```
const svc = withCallLog(createFakeGoogleGmail());
await svc.listMessages({ q: "label:inbox" });
printCalls(svc.callLog, "listMessages")
=> listMessages({"q":"label:inbox"})
```

## Creating drafts

The fake assigns sequential `r-fake-N` / `m-fake-N` IDs and stores each
draft (with the raw MIME) on `.drafts` for inspection.

```
const svc = createFakeGoogleGmail();
const draft = await svc.createDraft({ raw: "VG86IGFsaWNl" });
draft.id
=> r-fake-1
```

``` continue
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

```
const svc = createFakeGoogleGmail();
const draft = await svc.createDraft({ raw: "Zm9v", threadId: "t-existing" });
draft.message.threadId
=> t-existing
```
