# Gmail draft uploads

The Gmail connector picks up agent-authored draft email-message cards under
`box/inbox/email/` and uploads them to Gmail as drafts. After upload, each
card is stamped with `gmail-draft-id` and `gmail-draft-url` so the user can
open the draft in Gmail.

```ts setup
import { join } from "node:path";
import { readFile, mkdir } from "node:fs/promises";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import { initBox } from "../src/core/box.js";
import { createFakeGoogleGmail } from "../src/services/google-gmail.js";
import { createGmailConnector } from "../src/connectors/gmail.js";
```

## A new draft (no thread) gets uploaded and stamped

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await mkdir(join(box.root, "box/inbox/email/draft-2026-04-28-hello"), { recursive: true });
await box.seed(
  "box/inbox/email/draft-2026-04-28-hello/draft-001.email-message.card",
  '<email-message status="draft">\n<to>alice@example.com</to>\n<subject>Hello</subject>\n<body>Hi there.</body>\n</email-message>\n',
);
box.commitAll("agent writes draft");

const gmail = createFakeGoogleGmail();
const connector = createGmailConnector(box.root, gmail);
const result = await connector.sync();
result.success
=> true

gmail.drafts.length
=> 1
```

The card is stamped with the returned draft id and URL:

``` continue
const stampedPath = "box/inbox/email/draft-2026-04-28-hello/draft-001.email-message.card";
const stamped = await readFile(join(box.root, stampedPath), "utf-8");
stamped.includes('gmail-draft-id="r-fake-1"')
=> true

stamped.includes('gmail-draft-url="https://mail.google.com/mail/u/0/#drafts/m-fake-1"')
=> true
```

The MIME we uploaded has the headers and body:

``` continue
const raw = gmail.drafts[0].raw;
const decoded = Buffer.from(raw.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf-8");
decoded.includes("To: alice@example.com")
=> true

decoded.includes("Subject: Hello")
=> true

decoded.includes("Hi there.")
=> true
```

## A reply draft inherits threading from the source message

When a draft has `<in-reply-to ref="..." />`, the connector reads the source
card's `message-id`/`thread-id` to set `In-Reply-To` and `References`
headers and threads the upload onto the existing Gmail thread.

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await mkdir(join(box.root, "box/inbox/email/thread-Test-abc12345"), { recursive: true });
await box.seed(
  "box/inbox/email/thread-Test-abc12345/msg-001.email-message.card",
  '<email-message message-id="orig-msg-id-123" thread-id="thread-abc12345">\n<from>alice@example.com</from>\n<to>me@example.com</to>\n<subject>Test</subject>\n<body-file>msg-001.body.txt</body-file>\n</email-message>\n',
);
await box.seed(
  "box/inbox/email/thread-Test-abc12345/draft-001.email-message.card",
  '<email-message status="draft">\n<to>alice@example.com</to>\n<subject>Re: Test</subject>\n<in-reply-to ref="msg-001.email-message.card" />\n<body>Thanks for the note.</body>\n</email-message>\n',
);
box.commitAll("agent writes reply draft");

const gmail = createFakeGoogleGmail();
const connector = createGmailConnector(box.root, gmail);
await connector.sync();

gmail.drafts.length
=> 1

// Reply uses the source thread-id
gmail.drafts[0].draft.message.threadId
=> thread-abc12345
```

The MIME has the threading headers:

``` continue
const raw = gmail.drafts[0].raw;
const decoded = Buffer.from(raw.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf-8");
decoded.includes("In-Reply-To: orig-msg-id-123")
=> true

decoded.includes("References: orig-msg-id-123")
=> true
```

## Threading also works with box-relative or box-anchored absolute refs

Agents sometimes write `<in-reply-to>` with a longer path. All three forms
resolve to the same source card:

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await mkdir(join(box.root, "box/inbox/email/thread-Test-zzz99999"), { recursive: true });
await box.seed(
  "box/inbox/email/thread-Test-zzz99999/msg-001.email-message.card",
  '<email-message message-id="abs-msg-id" thread-id="thread-zzz99999">\n<from>a@b.com</from>\n<to>me@x.com</to>\n<subject>X</subject>\n<body-file>msg-001.body.txt</body-file>\n</email-message>\n',
);
// Box-anchored absolute path (leading slash, relative to box root)
await box.seed(
  "box/inbox/email/thread-Test-zzz99999/draft-001.email-message.card",
  '<email-message status="draft">\n<to>a@b.com</to>\n<subject>Re: X</subject>\n<in-reply-to ref="/box/inbox/email/thread-Test-zzz99999/msg-001.email-message.card" />\n<body>Reply 1.</body>\n</email-message>\n',
);
box.commitAll("setup");

const gmail = createFakeGoogleGmail();
const connector = createGmailConnector(box.root, gmail);
await connector.sync();

gmail.drafts.length
=> 1

gmail.drafts[0].draft.message.threadId
=> thread-zzz99999
```

## A reply draft with an unresolvable in-reply-to ref reports the error

If the agent writes a draft whose `in-reply-to` doesn't point to a real
source card, we'd rather fail loud than upload it as a brand-new thread
the user only notices is wrong after opening Gmail:

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await mkdir(join(box.root, "box/inbox/email/thread-Bad-aaa00000"), { recursive: true });
await box.seed(
  "box/inbox/email/thread-Bad-aaa00000/draft-001.email-message.card",
  '<email-message status="draft">\n<to>x@y.com</to>\n<subject>Re: missing</subject>\n<in-reply-to ref="does-not-exist.email-message.card" />\n<body>...</body>\n</email-message>\n',
);
box.commitAll("setup");

const gmail = createFakeGoogleGmail();
const connector = createGmailConnector(box.root, gmail);
const result = await connector.sync();

// No draft uploaded, sync reports the error per-card
gmail.drafts.length
=> 0

result.success
=> true

// Card stays unstamped so the user can fix the ref and retry on next sync
const stamped = await readFile(join(box.root, "box/inbox/email/thread-Bad-aaa00000/draft-001.email-message.card"), "utf-8");
stamped.includes("gmail-draft-id")
=> false
```

## Already-stamped drafts are skipped

A draft card with `gmail-draft-id` set has already been uploaded — the
connector leaves it alone:

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await mkdir(join(box.root, "box/inbox/email/draft-2026-04-28-already"), { recursive: true });
await box.seed(
  "box/inbox/email/draft-2026-04-28-already/draft-001.email-message.card",
  '<email-message status="draft" gmail-draft-id="r-existing" gmail-draft-url="https://mail.google.com/mail/u/0/#drafts/m-existing">\n<to>bob@example.com</to>\n<subject>Already done</subject>\n<body>Test.</body>\n</email-message>\n',
);
box.commitAll("setup");

const gmail = createFakeGoogleGmail();
const connector = createGmailConnector(box.root, gmail);
await connector.sync();

gmail.drafts.length
=> 0
```

## Received messages are not treated as drafts

A normal received `email-message` card (status absent or "received") is left
alone — only `status="draft"` cards trigger upload:

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await mkdir(join(box.root, "box/inbox/email/thread-Hello-xyz12345"), { recursive: true });
await box.seed(
  "box/inbox/email/thread-Hello-xyz12345/msg-001.email-message.card",
  '<email-message message-id="<m1@example.com>" thread-id="thread-xyz12345">\n<from>alice@example.com</from>\n<to>me@example.com</to>\n<subject>Hello</subject>\n<body-file>msg-001.body.txt</body-file>\n</email-message>\n',
);
box.commitAll("setup");

const gmail = createFakeGoogleGmail();
const connector = createGmailConnector(box.root, gmail);
await connector.sync();

gmail.drafts.length
=> 0
```
