# Gmail tracked working set

An email thread is tracked when one live `*.email-thread.card` exists. Moving
the card within live box content keeps it tracked. Moving it to trash or
deleting it stops tracking without changing Gmail.

```ts setup
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { initBox } from "../../src/core/box/index.js";
import { createEmailThreadTemplate } from "../../src/schemas/email-thread.js";
import { errorMessage } from "../../src/lib/error-guards.js";
import {
  createFakeGoogleGmail,
  type GmailMessage,
} from "../../src/services/google-gmail.js";
import {
  findTrackedGmailThreads,
  remainingAutomaticTrackingBudget,
} from "../../src/connectors/gmail-tracking.js";
import { parseGmailConnectorConfig } from "../../src/connectors/gmail-config.js";
import { trackGmailThread } from "../../src/connectors/gmail-track.js";
import { evaluateGmailRules } from "../../src/connectors/gmail-rules.js";
import { assertReadOnlyGwsArgs } from "../../src/connectors/gmail-gws.js";

async function writeThread(root: string, relPath: string, threadId: string): Promise<void> {
  const absPath = join(root, relPath);
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(
    absPath,
    createEmailThreadTemplate({
      threadId,
      subject: `Subject ${threadId}`,
      participants: ["sender@example.com"],
      dateStart: "2026-08-01T10:00:00.000Z",
      dateEnd: "2026-08-01T10:00:00.000Z",
      messageRefs: [],
    }),
  );
}

function gmailMessage(opts: {
  id: string;
  threadId: string;
  subject: string;
  body: string;
}): GmailMessage {
  return {
    id: opts.id,
    threadId: opts.threadId,
    labelIds: ["INBOX"],
    internalDate: "1785596400000",
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "Message-ID", value: `<${opts.id}@example.com>` },
        { name: "From", value: "sender@example.com" },
        { name: "To", value: "box@example.com" },
        { name: "Subject", value: opts.subject },
      ],
      body: { data: Buffer.from(opts.body).toString("base64url") },
    },
  };
}
```

## Card existence is authoritative

```ts
const box = await makeTmpBox();
await writeThread(box.root, "box/inbox/email/First.email-thread.card", "thread-1");

const first = await findTrackedGmailThreads(box.root);
JSON.stringify([...first].map(([id, entry]) => [id, entry.relPath]))
=> [["thread-1","box/inbox/email/First.email-thread.card"]]

await mkdir(join(box.root, "store/archive/done"), { recursive: true });
await rename(
  join(box.root, "box/inbox/email/First.email-thread.card"),
  join(box.root, "store/archive/done/First.email-thread.card"),
);
const moved = await findTrackedGmailThreads(box.root);
moved.get("thread-1")?.relPath
=> store/archive/done/First.email-thread.card

await mkdir(join(box.root, "store/trash"), { recursive: true });
await rename(
  join(box.root, "store/archive/done/First.email-thread.card"),
  join(box.root, "store/trash/First.email-thread.card"),
);
(await findTrackedGmailThreads(box.root)).size
=> 0
```

```ts cleanup
await box.cleanup();
```

Deleting the card also removes it from the tracked set. A leftover attach
scope is not itself tracking state.

```ts
const box = await makeTmpBox();
await writeThread(box.root, "box/inbox/email/Delete.email-thread.card", "thread-delete");
await mkdir(join(box.root, "box/inbox/email/Delete.attach"), { recursive: true });
await rm(join(box.root, "box/inbox/email/Delete.email-thread.card"));
(await findTrackedGmailThreads(box.root)).size
=> 0
```

```ts cleanup
await box.cleanup();
```

## Invalid or duplicate identities fail clearly

```ts
const box = await makeTmpBox();
await box.seed(
  "box/inbox/email/Broken.email-thread.card",
  "---\nsubject: Missing identity\nparticipants: []\ndate-range:\n  start: 2026-08-01T10:00:00.000Z\n  end: 2026-08-01T10:00:00.000Z\nmessages: []\n---\n",
);
let broken = "";
await findTrackedGmailThreads(box.root).catch((error: Error) => { broken = error.message; });
broken.includes("Broken.email-thread.card")
=> true
```

```ts cleanup
await box.cleanup();
```

```ts
const box = await makeTmpBox();
await writeThread(box.root, "box/inbox/email/One.email-thread.card", "same-thread");
await writeThread(box.root, "store/archive/done/Two.email-thread.card", "same-thread");
let duplicate = "";
await findTrackedGmailThreads(box.root).catch((error: Error) => { duplicate = error.message; });
duplicate.includes("same-thread") && duplicate.includes("One.email-thread.card") && duplicate.includes("Two.email-thread.card")
=> true
```

```ts cleanup
await box.cleanup();
```

## Automatic tracking uses a rolling thread budget

The budget returns only events still inside the rolling window. Reaching the
limit yields zero remaining capacity; it does not create a deferred queue.

```ts
const result = remainingAutomaticTrackingBudget({
  budget: { threads: 3, windowMs: 7 * 24 * 60 * 60 * 1000 },
  events: [
    "2026-07-20T00:00:00.000Z",
    "2026-08-01T00:00:00.000Z",
    "2026-08-03T00:00:00.000Z",
    "2026-08-05T00:00:00.000Z",
  ],
  now: new Date("2026-08-05T12:00:00.000Z"),
});
JSON.stringify(result)
=> {"remaining":0,"events":["2026-08-01T00:00:00.000Z","2026-08-03T00:00:00.000Z","2026-08-05T00:00:00.000Z"]}
```

Raising the configured cap opens capacity immediately.

```ts continue
remainingAutomaticTrackingBudget({
  budget: { threads: 5, windowMs: 7 * 24 * 60 * 60 * 1000 },
  events: result.events,
  now: new Date("2026-08-05T12:00:00.000Z"),
}).remaining
=> 2
```

## Gmail rules are validated and legacy queries become bounded

No configuration means no rule can create a card.

```ts
JSON.stringify(parseGmailConnectorConfig({}).rules)
=> []
```

Track and procedure actions form a closed, validated union.

```ts
const config = parseGmailConnectorConfig({
  rules: [
    {
      name: "send-to-agent",
      query: "label:callback-box",
      action: { type: "track", budget: { threads: 10, window: "14d" } },
    },
    {
      name: "review-inbox",
      query: "label:inbox is:unread",
      action: { type: "procedure", ref: "config/procedures/review-email.procedure.card" },
    },
  ],
});
JSON.stringify(config.rules)
=> [{"name":"send-to-agent","query":"label:callback-box","action":{"type":"track","budget":{"threads":10,"windowMs":1209600000}}},{"name":"review-inbox","query":"label:inbox is:unread","action":{"type":"procedure","ref":"config/procedures/review-email.procedure.card"}}]
```

A legacy label configuration keeps its intentional routing behavior, but it
immediately gains the default 25-thread rolling seven-day budget.

```ts
const legacy = parseGmailConnectorConfig({ labels: ["callback"] });
legacy.legacy
=> true

legacy.rules[0]?.name
=> legacy-import

legacy.rules[0]?.query
=> label:callback

JSON.stringify(legacy.rules[0]?.action)
=> {"type":"track","budget":{"threads":25,"windowMs":604800000}}
```

Invalid actions and duplicate rule names fail at the config boundary.

```ts
let invalid = "";
try {
  parseGmailConnectorConfig({
    rules: [{ name: "bad", query: "label:x", action: { type: "delete" } }],
  });
} catch (error) {
  invalid = errorMessage(error);
};
invalid.includes("gmail.json")
=> true
```

```ts
let duplicateRules = "";
try {
  parseGmailConnectorConfig({
    rules: [
      { name: "same", query: "label:a", action: { type: "track" } },
      { name: "same", query: "label:b", action: { type: "track" } },
    ],
  });
} catch (error) {
  duplicateRules = errorMessage(error);
};
duplicateRules.includes("duplicate Gmail rule name")
=> true
```

## Tracking one thread is explicit and idempotent

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("initialize box");
const gmail = createFakeGoogleGmail({
  labels: [{ id: "INBOX", name: "INBOX", type: "system" }],
  messages: [
    gmailMessage({ id: "m1", threadId: "thread-track", subject: "Track me", body: "First" }),
  ],
});
const first = await trackGmailThread({
  boxRoot: box.root,
  service: gmail,
  threadId: "thread-track",
  trackedBy: "explicit-command",
});
first.created.length
=> 3

(await findTrackedGmailThreads(box.root)).size
=> 1

const second = await trackGmailThread({
  boxRoot: box.root,
  service: gmail,
  threadId: "thread-track",
  trackedBy: "explicit-command",
});
JSON.stringify({ created: second.created.length, updated: second.updated.length })
=> {"created":0,"updated":0}

gmail.addMessage(
  gmailMessage({ id: "m2", threadId: "thread-track", subject: "Track me", body: "Second" }),
);
const refreshed = await trackGmailThread({
  boxRoot: box.root,
  service: gmail,
  threadId: "thread-track",
  trackedBy: "explicit-command",
});
JSON.stringify({ created: refreshed.created.length, updated: refreshed.updated.length })
=> {"created":2,"updated":1}

gmail.drafts.length
=> 0
```

```ts cleanup
await box.cleanup();
```

## Rules baseline first and remain bounded

Activating a rule reports the existing remote match count but does not track
the backlog. Only later history candidates are eligible for its action.

```ts
const gmail = createFakeGoogleGmail({
  labels: [{ id: "Label_7", name: "callback", type: "user" }],
  messages: [
    { ...gmailMessage({ id: "old", threadId: "old-thread", subject: "Old", body: "Old" }), labelIds: ["Label_7"] },
  ],
});
const config = parseGmailConnectorConfig({ labels: ["callback"] });
const baseline = await evaluateGmailRules({
  service: gmail,
  config,
  state: {},
  candidates: [],
  trackedThreadIds: new Set(),
  labelMap: new Map([["Label_7", "callback"]]),
  now: new Date("2026-08-05T12:00:00.000Z"),
});
baseline.trackRequests.length
=> 0

baseline.state.rules?.["legacy-import"]?.additionalMatches
=> 1
```

A later matching thread is selected once and consumes one rolling-budget
event, even if more than one changed message from that thread is examined.

```ts continue
const fresh = { ...gmailMessage({ id: "new", threadId: "new-thread", subject: "New", body: "New" }), labelIds: ["Label_7"] };
gmail.addMessage(fresh);
const selected = await evaluateGmailRules({
  service: gmail,
  config,
  state: baseline.state,
  candidates: [fresh, fresh],
  trackedThreadIds: new Set(),
  labelMap: new Map([["Label_7", "callback"]]),
  now: new Date("2026-08-05T13:00:00.000Z"),
});
JSON.stringify(selected.trackRequests)
=> [{"threadId":"new-thread","ruleName":"legacy-import"}]

selected.state.rules?.["legacy-import"]?.automaticTrackingEvents?.length
=> 1
```

A spent budget leaves a visible private summary instead of creating a deferred
automatic-import queue.

```ts continue
const cappedConfig = parseGmailConnectorConfig({
  rules: [{
    name: "small-cap",
    query: "label:callback",
    action: { type: "track", budget: { threads: 1, window: "7d" } },
  }],
});
const capped = await evaluateGmailRules({
  service: gmail,
  config: cappedConfig,
  state: {
    rules: {
      "small-cap": {
        baselineAt: "2026-08-01T00:00:00.000Z",
        automaticTrackingEvents: ["2026-08-05T10:00:00.000Z"],
      },
    },
  },
  candidates: [fresh],
  trackedThreadIds: new Set(),
  labelMap: new Map([["Label_7", "callback"]]),
  now: new Date("2026-08-05T13:00:00.000Z"),
});
capped.trackRequests.length
=> 0

capped.state.rules?.["small-cap"]?.pending?.[0]?.threadId
=> new-thread

capped.state.rules?.["small-cap"]?.additionalMatches
=> 1
```

Procedure rules coalesce matching messages into one post-sync request and keep
the candidate content out of the directive.

```ts continue
const procedureConfig = parseGmailConnectorConfig({
  rules: [{
    name: "review-mail",
    query: "label:callback",
    action: { type: "procedure", ref: "config/procedures/review-mail.procedure.card" },
  }],
});
const procedureResult = await evaluateGmailRules({
  service: gmail,
  config: procedureConfig,
  state: { rules: { "review-mail": { baselineAt: "2026-08-01T00:00:00.000Z" } } },
  candidates: [fresh, fresh],
  trackedThreadIds: new Set(),
  labelMap: new Map([["Label_7", "callback"]]),
  now: new Date("2026-08-05T13:00:00.000Z"),
});
JSON.stringify(procedureResult.procedures)
=> [{"procedureRef":"config/procedures/review-mail.procedure.card","directive":"Gmail rule review-mail has new matching mail. Inspect with: cb connector gmail pending review-mail"}]

procedureResult.state.rules?.["review-mail"]?.pending?.length
=> 1
```

## The gws passthrough is remote-read-only

The wrapper keeps upstream command names, but accepts only Gmail reads and
introspection before it mints a token or starts the child process.

```ts
assertReadOnlyGwsArgs(["gmail", "users", "messages", "list", "--params", '{"userId":"me"}']);
assertReadOnlyGwsArgs(["gmail", "+read", "--id", "abc"]);
assertReadOnlyGwsArgs(["schema", "gmail.users.threads.get"]);
true
=> true
```

```ts
let rejected = "";
try {
  assertReadOnlyGwsArgs(["gmail", "users", "messages", "modify"]);
} catch (error) {
  rejected = errorMessage(error);
};
rejected
=> Rejected non-read-only gws command: gmail users messages modify
```

```ts
let nonGmail = "";
try {
  assertReadOnlyGwsArgs(["drive", "files", "list"]);
} catch (error) {
  nonGmail = errorMessage(error);
};
nonGmail.includes("Rejected")
=> true
```
