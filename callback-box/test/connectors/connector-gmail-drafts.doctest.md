# Gmail draft uploads

The Gmail connector picks up agent-authored `email-outbound` cards under
`box/inbox/email/` and uploads them to Gmail as drafts. After upload, each
card is stamped with `gmail-draft-id` and `gmail-draft-url` so the user can
open the draft in Gmail.

```ts setup
import { join } from "node:path";
import { readFile, mkdir } from "node:fs/promises";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { initBox } from "../../src/core/box/index.js";
import { createFakeGoogleGmail } from "../../src/services/google-gmail-fake.js";
import { createGmailConnector } from "../../src/connectors/gmail.js";
```

## A new outbound (no thread) gets uploaded and stamped

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed("config/connectors/gmail.json", "{}\n");
box.commitAll("init box");

await mkdir(join(box.root, "box/inbox/email/draft-2026-04-28-hello"), { recursive: true });
await box.seed(
  "box/inbox/email/draft-2026-04-28-hello/draft-001.email-outbound.card",
  "---\ntype: email-outbound\nstatus: draft\nto: alice@example.com\nsubject: Hello\n---\nHi there.\n",
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

```ts continue
const stampedPath = "box/inbox/email/draft-2026-04-28-hello/draft-001.email-outbound.card";
const stamped = await readFile(join(box.root, stampedPath), "utf-8");
stamped.includes("gmail-draft-id: r-fake-1")
=> true

stamped.includes("gmail-draft-url: https://mail.google.com/mail/u/0/#drafts/m-fake-1")
=> true
```

The MIME we uploaded has the headers and body:

```ts continue
const raw = gmail.drafts[0].raw;
const decoded = Buffer.from(raw.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf-8");
decoded.includes("To: alice@example.com")
=> true

decoded.includes("Subject: Hello")
=> true

decoded.includes("Hi there.")
=> true
```

## A reply outbound inherits threading from the source message

When an outbound has `<in-reply-to ref="..." />`, the connector reads the
source `email-message` card's `message-id`/`thread-id` to set
`In-Reply-To`/`References` headers and threads the upload onto the existing
Gmail thread.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed("config/connectors/gmail.json", "{}\n");
box.commitAll("init box");

await mkdir(join(box.root, "box/inbox/email/thread-Test-abc12345"), { recursive: true });
await box.seed(
  "box/inbox/email/thread-Test-abc12345/msg-001.email-message.card",
  "---\ntype: email-message\nmessage-id: orig-msg-id-123\nthread-id: thread-abc12345\nfrom: alice@example.com\nto: me@example.com\ndate: 2026-02-15T10:00:00Z\nsubject: Test\nbody-file:\n  ref: msg-001.body.txt\n---\n",
);
await box.seed(
  "box/inbox/email/thread-Test-abc12345/draft-001.email-outbound.card",
  "---\ntype: email-outbound\nstatus: draft\nto: alice@example.com\nsubject: \"Re: Test\"\nin-reply-to:\n  ref: msg-001.email-message.card\n---\nThanks for the note.\n",
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

```ts continue
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

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed("config/connectors/gmail.json", "{}\n");
box.commitAll("init box");

await mkdir(join(box.root, "box/inbox/email/thread-Test-zzz99999"), { recursive: true });
await box.seed(
  "box/inbox/email/thread-Test-zzz99999/msg-001.email-message.card",
  "---\ntype: email-message\nmessage-id: abs-msg-id\nthread-id: thread-zzz99999\nfrom: a@b.com\nto: me@x.com\ndate: 2026-02-15T10:00:00Z\nsubject: X\nbody-file:\n  ref: msg-001.body.txt\n---\n",
);
// Box-anchored absolute path (leading slash, relative to box root)
await box.seed(
  "box/inbox/email/thread-Test-zzz99999/draft-001.email-outbound.card",
  "---\ntype: email-outbound\nstatus: draft\nto: a@b.com\nsubject: \"Re: X\"\nin-reply-to:\n  ref: /box/inbox/email/thread-Test-zzz99999/msg-001.email-message.card\n---\nReply 1.\n",
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

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed("config/connectors/gmail.json", "{}\n");
box.commitAll("init box");

await mkdir(join(box.root, "box/inbox/email/thread-Bad-aaa00000"), { recursive: true });
await box.seed(
  "box/inbox/email/thread-Bad-aaa00000/draft-001.email-outbound.card",
  "---\ntype: email-outbound\nstatus: draft\nto: x@y.com\nsubject: \"Re: missing\"\nin-reply-to:\n  ref: does-not-exist.email-message.card\n---\n...\n",
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
const stamped = await readFile(join(box.root, "box/inbox/email/thread-Bad-aaa00000/draft-001.email-outbound.card"), "utf-8");
stamped.includes("gmail-draft-id")
=> false
```

## Already-stamped outbounds are skipped

An outbound card with `gmail-draft-id` set has already been uploaded — the
connector leaves it alone:

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed("config/connectors/gmail.json", "{}\n");
box.commitAll("init box");

await mkdir(join(box.root, "box/inbox/email/draft-2026-04-28-already"), { recursive: true });
await box.seed(
  "box/inbox/email/draft-2026-04-28-already/draft-001.email-outbound.card",
  "---\ntype: email-outbound\nstatus: draft\nto: bob@example.com\nsubject: Already done\ngmail-draft-id: r-existing\ngmail-draft-url: https://mail.google.com/mail/u/0/#drafts/m-existing\n---\nTest.\n",
);
box.commitAll("setup");

const gmail = createFakeGoogleGmail();
const connector = createGmailConnector(box.root, gmail);
await connector.sync();

gmail.drafts.length
=> 0
```

## Received email-message cards are not picked up as outbound

A normal received `email-message` card under `box/inbox/email/` is left
alone — the connector only uploads `email-outbound` cards:

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed("config/connectors/gmail.json", "{}\n");
box.commitAll("init box");

await mkdir(join(box.root, "box/inbox/email/thread-Hello-xyz12345"), { recursive: true });
await box.seed(
  "box/inbox/email/thread-Hello-xyz12345/msg-001.email-message.card",
  "---\ntype: email-message\nmessage-id: m1-at-example.com\nthread-id: thread-xyz12345\nfrom: alice@example.com\nto: me@example.com\ndate: 2026-02-15T10:00:00Z\nsubject: Hello\nbody-file:\n  ref: msg-001.body.txt\n---\n",
);
box.commitAll("setup");

const gmail = createFakeGoogleGmail();
const connector = createGmailConnector(box.root, gmail);
await connector.sync();

gmail.drafts.length
=> 0
```
