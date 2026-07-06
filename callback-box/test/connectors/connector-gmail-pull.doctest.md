# Gmail pull sync

The Gmail connector pulls matching messages into `box/inbox/email/` as
thread/message cards. Dedup is by Gmail message id (`seenGmailIds` in
`gmail-state.json`, uncapped), checked **before** fetching, so re-listing a
mailbox never re-fetches message bodies. Steady-state syncs use the Gmail
history API from a checkpoint stored in transient state; the full query
listing only runs on the first sync or when the checkpoint expires.

Note: the fake's `listMessages` evaluates only the `label:` subset of the query
(see the service doctest), so full-list scenarios below seed messages carrying
the matching label.

```ts setup
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { initBox } from "../../src/core/box/index.js";
import {
  createFakeGoogleGmail,
  type GmailMessage,
} from "../../src/services/google-gmail.js";
import { withCallLog, printCalls } from "../../src/services/call-log.js";
import { createGmailConnector } from "../../src/connectors/gmail.js";
import { buildGmailQuery } from "../../src/connectors/gmail-pull.js";

function makeGmailMessage(opts: {
  id: string;
  subject: string;
  labelIds: string[];
}): GmailMessage {
  return {
    id: opts.id,
    threadId: `t-${opts.id}`,
    labelIds: opts.labelIds,
    internalDate: "1600000000000",
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "Message-ID", value: `<${opts.id}@example.com>` },
        { name: "From", value: "alice@example.com" },
        { name: "To", value: "me@example.com" },
        { name: "Subject", value: opts.subject },
      ],
      body: { data: "SGVsbG8" },
    },
  };
}

async function readState(root: string) {
  return JSON.parse(
    await readFile(join(root, "config/connectors/gmail-state.json"), "utf-8"),
  );
}
```

## Query building

No date filter anywhere — a configured query or label set is used as-is, and
the bare default is plain `label:inbox` (history incrementality bounds the
sync cost instead of an `after:` floor):

```ts
buildGmailQuery({ query: "from:boss is:starred" })
=> from:boss is:starred

buildGmailQuery({ labels: ["ledger", "callback"] })
=> label:ledger OR label:callback

buildGmailQuery({})
=> label:inbox
```

## Labels config: first sync imports all labeled mail, regardless of age

A labels config means explicit routing — everything carrying the label flows
in on the first sync, even messages received years ago (there is no date
filter to exclude them).

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed("config/connectors/gmail.json", JSON.stringify({ labels: ["callback"] }));
box.commitAll("init box");

const gmail = withCallLog(createFakeGoogleGmail({
  labels: [{ id: "Label_7", name: "callback", type: "user" }],
  messages: [
    makeGmailMessage({ id: "m1", subject: "Old labeled mail", labelIds: ["Label_7"] }),
  ],
}));
const connector = createGmailConnector(box.root, gmail);
const result = await connector.sync();
result.success
=> true

// thread card + message card + body file
result.created.length
=> 3

JSON.stringify((await readState(box.root)).seenGmailIds)
=> ["m1"]
```

The second sync goes through the history API: no full re-list, no message
re-fetch.

```ts continue
gmail.callLog.length = 0;
const second = await connector.sync();
second.created.length
=> 0

JSON.stringify(printCalls(gmail.callLog, "listMessages"))
=> ""

JSON.stringify(printCalls(gmail.callLog, "getMessage"))
=> ""

printCalls(gmail.callLog, "listHistory")
=> listHistory({"startHistoryId":"1"})
```

New labeled mail arrives — picked up via history, fetching only the one new
message:

```ts continue
await gmail.addMessage(makeGmailMessage({ id: "m2", subject: "Fresh mail", labelIds: ["Label_7"] }));
const third = await connector.sync();
third.created.length
=> 3

printCalls(gmail.callLog, "getMessage")
=> getMessage("m2")

JSON.stringify((await readState(box.root)).seenGmailIds)
=> ["m1","m2"]
```

## Labeling an old message routes it into the box

The labeling-as-routing case: a message that never matched (no `callback`
label) gets the label later. The history API surfaces the labelsAdded change
— received date is irrelevant.

```ts continue
await gmail.addMessage(makeGmailMessage({ id: "m3", subject: "Unrelated", labelIds: ["INBOX"] }));
const fourth = await connector.sync();
// Not labeled callback — history change filtered out, nothing imported
fourth.created.length
=> 0

await gmail.addLabelsToMessage({ id: "m3", labelIds: ["Label_7"] });
const fifth = await connector.sync();
fifth.created.length
=> 3

JSON.stringify((await readState(box.root)).seenGmailIds)
=> ["m1","m2","m3"]
```

## Expired history checkpoint falls back to a full list, without duplicates

Gmail only retains history for a limited time. When the stored checkpoint
404s, the connector re-lists the full query; seen-id dedup keeps the fallback
from re-importing (note: zero getMessage calls for the three seen messages).

```ts continue
await gmail.expireHistory();
await gmail.addMessage(makeGmailMessage({ id: "m4", subject: "Arrived during gap", labelIds: ["Label_7"] }));
gmail.callLog.length = 0;
const sixth = await connector.sync();
sixth.created.length
=> 3

printCalls(gmail.callLog, "getMessage")
=> getMessage("m4")

printCalls(gmail.callLog, "listMessages")
=> listMessages({"q":"label:callback","maxResults":100})
```

## Bare label:inbox default: baseline sync marks seen without importing

With no connector config at all, the first sync would otherwise import the
user's entire inbox as cards. Instead it records every current match as seen
and imports nothing — only mail arriving (or moved to inbox) afterwards flows
in.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

const gmail = createFakeGoogleGmail({
  messages: [
    makeGmailMessage({ id: "old1", subject: "Ancient inbox mail", labelIds: ["INBOX"] }),
    makeGmailMessage({ id: "old2", subject: "More backlog", labelIds: ["INBOX"] }),
  ],
});
const connector = createGmailConnector(box.root, gmail);
const result = await connector.sync();
result.created.length
=> 0

JSON.stringify((await readState(box.root)).seenGmailIds)
=> ["old1","old2"]
```

From then on, new inbox mail and re-inboxed old mail both flow in via
history:

```ts continue
await gmail.addMessage(makeGmailMessage({ id: "new1", subject: "Just arrived", labelIds: ["INBOX"] }));
const second = await connector.sync();
second.created.length
=> 3

// An archived message (history record exists, but no INBOX label) is ignored
// until the user moves it back to the inbox.
await gmail.addMessage(makeGmailMessage({ id: "arch1", subject: "Archived", labelIds: [] }));
(await connector.sync()).created.length
=> 0

await gmail.addLabelsToMessage({ id: "arch1", labelIds: ["INBOX"] });
(await connector.sync()).created.length
=> 3
```

## Legacy state migration: pre-upgrade boxes don't re-import

Boxes synced before `seenGmailIds` existed have Message-ID headers in
`seenMessageIds`. Those are checked after fetch; on a hit the Gmail id is
recorded so the next sync skips the fetch entirely.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed("config/connectors/gmail.json", JSON.stringify({ labels: ["callback"] }));
await box.seed(
  "config/connectors/gmail-state.json",
  JSON.stringify({ seenMessageIds: ["<m1@example.com>"] }),
);
box.commitAll("init box");

const gmail = withCallLog(createFakeGoogleGmail({
  labels: [{ id: "Label_7", name: "callback", type: "user" }],
  messages: [
    makeGmailMessage({ id: "m1", subject: "Imported pre-upgrade", labelIds: ["Label_7"] }),
  ],
}));
const connector = createGmailConnector(box.root, gmail);
const result = await connector.sync();
// Fetched once for the legacy check, but not re-imported
result.created.length
=> 0

JSON.stringify((await readState(box.root)).seenGmailIds)
=> ["m1"]

gmail.callLog.length = 0;
await connector.sync();
JSON.stringify(printCalls(gmail.callLog, "getMessage"))
=> ""
```
