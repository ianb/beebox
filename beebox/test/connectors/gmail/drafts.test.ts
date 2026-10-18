// # Gmail draft uploads
//
// The Gmail connector picks up agent-authored `email-outbound` cards under
// `_content/inbox/email/` and uploads them to Gmail as drafts. After upload, each
// card is stamped with `gmail-draft-id` and `gmail-draft-url` so the user can
// open the draft in Gmail.

import { test } from "tap";
import "agent-doctest/tap";
import { any, isoDate, str } from "agent-doctest/check";
import { join } from "node:path";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { initBox } from "../../../src/core/box/structure/core.js";
import { createFakeGoogleGmail } from "../../../src/services/google-gmail-fake/core.js";
import { createGmailConnector } from "../../../src/connectors/gmail/connector.js";
import { strandedDraftsHealthChecks } from "../../../src/webapp/trpc/routers/health/checks/connectors.js";

/** The drafts a fake Gmail holds, with each raw MIME message decoded. */
function uploaded(gmail: ReturnType<typeof createFakeGoogleGmail>) {
  return gmail.drafts.map((d) => ({
    draft: d.draft,
    raw: Buffer.from(d.raw.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf-8"),
  }));
}

const DRAFT = (threadId: string) => ({ id: "r-fake-1", message: { id: "m-fake-1", threadId, labelIds: ["DRAFT"] } });
const MIME_TAIL = "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n";

// ## A new outbound (no thread) gets uploaded and stamped
void test("A new outbound (no thread) gets uploaded and stamped", async (t) => {
  // doctest:L21
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed("_config/connectors/gmail.json", "{}\n");
  box.commitAll("init box");

  // doctest:L26
  await mkdir(join(box.root, "_content/inbox/email/draft-2026-04-28-hello"), { recursive: true });
  await box.seed(
    "_content/inbox/email/draft-2026-04-28-hello/draft-001.email-outbound.card",
    "---\ntype: email-outbound\nstatus: draft\nto: alice@example.com\nsubject: Hello\n---\nHi there.\n",
  );
  box.commitAll("agent writes draft");

  // doctest:L33
  const gmail = createFakeGoogleGmail();
  const connector = createGmailConnector(box.root, gmail);
  const result = await connector.sync();
  t.check(result, {
    success: true,
    created: [],
    updated: ["_content/inbox/email/draft-2026-04-28-hello/draft-001.email-outbound.card"],
    procedures: [],
  });

  // doctest:L39
  t.check(uploaded(gmail), [{
    draft: DRAFT("t-fake-1"),
    raw: `To: alice@example.com\r\nSubject: Hello\r\n${MIME_TAIL}Hi there.\n`,
  }]);

  // The card is stamped with the returned draft id and URL:

  // doctest:L46
  const stampedPath = "_content/inbox/email/draft-2026-04-28-hello/draft-001.email-outbound.card";
  const stamped = await readFile(join(box.root, stampedPath), "utf-8");
  t.check(stamped, `---
type: email-outbound
status: draft
to: alice@example.com
subject: Hello
gmail-draft-id: r-fake-1
gmail-draft-url: https://mail.google.com/mail/u/0/#drafts/m-fake-1
---
Hi there.
`);

});

// ## A reply outbound inherits threading from the source message
//
// When an outbound has `<in-reply-to ref="..." />`, the connector reads the
// source `email-message` card's `email.message-id`/`email.thread-id` to set
// `In-Reply-To`/`References` headers and threads the upload onto the existing
// Gmail thread.
void test("When an outbound has <in-reply-to ref=\"...\" />, the connector reads the sourc...", async (t) => {
  // doctest:L78
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed("_config/connectors/gmail.json", "{}\n");
  box.commitAll("init box");

  // doctest:L83
  await mkdir(join(box.root, "_content/inbox/email/thread-Test-abc12345"), { recursive: true });
  await box.seed(
    "_content/inbox/email/thread-Test-abc12345/msg-001.email-message.card",
    "---\ntype: email-message\nemail:\n  message-id: orig-msg-id-123\n  thread-id: thread-abc12345\n  from: alice@example.com\n  to: me@example.com\n  received: 2026-02-15T10:00:00Z\n  subject: Test\nbody-file:\n  ref: msg-001.body.txt\n---\n",
  );
  await box.seed(
    "_content/inbox/email/thread-Test-abc12345/draft-001.email-outbound.card",
    "---\ntype: email-outbound\nstatus: draft\nto: alice@example.com\nsubject: \"Re: Test\"\nin-reply-to:\n  ref: msg-001.email-message.card\n---\nThanks for the note.\n",
  );
  box.commitAll("agent writes reply draft");

  // doctest:L94
  const gmail = createFakeGoogleGmail();
  const connector = createGmailConnector(box.root, gmail);
  await connector.sync();

  // doctest:L98
  // Reply uses the source thread-id, and the MIME has the threading headers
  t.check(uploaded(gmail), [{
    draft: DRAFT("thread-abc12345"),
    raw: `To: alice@example.com\r\nSubject: Re: Test\r\nIn-Reply-To: orig-msg-id-123\r\nReferences: orig-msg-id-123\r\n${MIME_TAIL}Thanks for the note.\n`,
  }]);

});

// ## Threading also works with box-relative or box-anchored absolute refs
//
// Agents sometimes write `<in-reply-to>` with a longer path. All three forms
// resolve to the same source card:
void test("Agents sometimes write <in-reply-to> with a longer path.", async (t) => {
  // doctest:L124
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed("_config/connectors/gmail.json", "{}\n");
  box.commitAll("init box");

  // doctest:L129
  await mkdir(join(box.root, "_content/inbox/email/thread-Test-zzz99999"), { recursive: true });
  await box.seed(
    "_content/inbox/email/thread-Test-zzz99999/msg-001.email-message.card",
    "---\ntype: email-message\nemail:\n  message-id: abs-msg-id\n  thread-id: thread-zzz99999\n  from: a@b.com\n  to: me@x.com\n  received: 2026-02-15T10:00:00Z\n  subject: X\nbody-file:\n  ref: msg-001.body.txt\n---\n",
  );
  // Box-anchored absolute path (leading slash, relative to box root)
  await box.seed(
    "_content/inbox/email/thread-Test-zzz99999/draft-001.email-outbound.card",
    "---\ntype: email-outbound\nstatus: draft\nto: a@b.com\nsubject: \"Re: X\"\nin-reply-to:\n  ref: /_content/inbox/email/thread-Test-zzz99999/msg-001.email-message.card\n---\nReply 1.\n",
  );
  box.commitAll("setup");

  // doctest:L141
  const gmail = createFakeGoogleGmail();
  const connector = createGmailConnector(box.root, gmail);
  await connector.sync();

  // doctest:L145
  t.check(uploaded(gmail), [{
    draft: DRAFT("thread-zzz99999"),
    raw: `To: a@b.com\r\nSubject: Re: X\r\nIn-Reply-To: abs-msg-id\r\nReferences: abs-msg-id\r\n${MIME_TAIL}Reply 1.\n`,
  }]);
});

// ## A reply draft with an unresolvable in-reply-to ref reports the error
//
// If the agent writes a draft whose `in-reply-to` doesn't point to a real
// source card, we'd rather fail loud than upload it as a brand-new thread
// the user only notices is wrong after opening Gmail:
void test("If the agent writes a draft whose in-reply-to doesn't point to a real source...", async (t) => {
  // doctest:L159
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed("_config/connectors/gmail.json", "{}\n");
  box.commitAll("init box");

  // doctest:L164
  await mkdir(join(box.root, "_content/inbox/email/thread-Bad-aaa00000"), { recursive: true });
  await box.seed(
    "_content/inbox/email/thread-Bad-aaa00000/draft-001.email-outbound.card",
    "---\ntype: email-outbound\nstatus: draft\nto: x@y.com\nsubject: \"Re: missing\"\nin-reply-to:\n  ref: does-not-exist.email-message.card\n---\n...\n",
  );
  box.commitAll("setup");

  // doctest:L171
  const gmail = createFakeGoogleGmail();
  const connector = createGmailConnector(box.root, gmail);
  const result = await connector.sync();

  // doctest:L175
  // No draft uploaded, sync reports the error per-card
  t.check(gmail.drafts, []);

  // doctest:L179
  // Inbound sync succeeded, but the failed card is named in the error, so the
  // wakeup and finalize output (and the connector activity record) show it.
  const badCard = "_content/inbox/email/thread-Bad-aaa00000/draft-001.email-outbound.card";
  const reason = str`in-reply-to ref "does-not-exist.email-message.card" did not resolve to a readable email-message card with email.message-id and email.thread-id (looked at ${box.root}/_content/inbox/email/thread-Bad-aaa00000/does-not-exist.email-message.card)`;
  t.check(result, {
    success: true,
    created: [],
    updated: [badCard],
    procedures: [],
    // The error text is cut at a fixed length, partway through the tmp path.
    error: str`Draft upload failed for 1 card: ${badCard}: in-reply-to ref "does-not-exist.email-message.card" did not resolve to a readable email-message card with email.message-id and email.thread-id (looked at ${any(String)}…`,
  });

  // doctest:L187
  // No draft id. The failure is the card's own, so the reason is written on
  // the card and the connector stops retrying it.
  const cardPath = join(box.root, "_content/inbox/email/thread-Bad-aaa00000/draft-001.email-outbound.card");
  const stamped = await readFile(cardPath, "utf-8");
  t.check(stamped, str`---
type: email-outbound
status: draft
to: x@y.com
subject: "Re: missing"
in-reply-to:
  ref: does-not-exist.email-message.card
gmail-draft-error: ${reason}
---
...
`);

  // The next sync leaves the stranded card alone: no retry and no error. The
  // dashboard lists it instead, until someone fixes the card and deletes the
  // `gmail-draft-error` line:

  // doctest:L200
  const again = await connector.sync();
  t.check(again, { success: true, created: [], updated: [], procedures: [] });
  t.check(gmail.drafts, []);

  // doctest:L204
  const [check] = await strandedDraftsHealthChecks(box.root);
  t.check(check, {
    name: "gmail-drafts",
    ok: false,
    message: str`1 Gmail draft could not be uploaded and is no longer retried: ${badCard} (${reason}). Fix the card, then delete its gmail-draft-error line to retry.`,
    severity: "warning",
  });

  // doctest:L208
  // Fixing the card: point the ref at nothing (a new thread) and drop the error line.
  await writeFile(cardPath, "---\ntype: email-outbound\nstatus: draft\nto: x@y.com\nsubject: \"Re: missing\"\n---\n...\n");
  await connector.sync();
  t.check(uploaded(gmail), [{
    draft: DRAFT("t-fake-1"),
    raw: `To: x@y.com\r\nSubject: Re: missing\r\n${MIME_TAIL}...\n`,
  }]);
  t.check(await strandedDraftsHealthChecks(box.root), []);
});

// ## A draft Gmail rejects is stranded; a transient failure is retried
//
// Gmail refusing a draft as malformed (HTTP 400) cannot be fixed by retrying.
// A network or auth failure can, so it leaves the card untouched:
void test("Gmail refusing a draft as malformed (HTTP 400) cannot be fixed by retrying.", async (t) => {
  // doctest:L221
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed("_config/connectors/gmail.json", "{}\n");
  await box.seed(
    "_content/inbox/email/draft-2026-04-28-a/draft-001.email-outbound.card",
    "---\ntype: email-outbound\nstatus: draft\nto: not an address\nsubject: Hi\n---\nHello.\n",
  );
  box.commitAll("setup");

  // doctest:L230
  const gmail = createFakeGoogleGmail();
  gmail.rejectDrafts = "Invalid To header";
  await createGmailConnector(box.root, gmail).sync();
  const cardPath = join(box.root, "_content/inbox/email/draft-2026-04-28-a/draft-001.email-outbound.card");
  t.check(await readFile(cardPath, "utf-8"), `---
type: email-outbound
status: draft
to: not an address
subject: Hi
gmail-draft-error: "Gmail rejected the draft: Invalid To header"
---
Hello.
`);

  // doctest:L237
  await box.seed(
    "_content/inbox/email/draft-2026-04-28-b/draft-001.email-outbound.card",
    "---\ntype: email-outbound\nstatus: draft\nto: bob@example.com\nsubject: Hi\n---\nHello.\n",
  );
  const offline = { ...createFakeGoogleGmail(), createDraft: async () => { throw new Error("socket hang up"); } };
  const result = await createGmailConnector(box.root, offline).sync();
  const otherPath = join(box.root, "_content/inbox/email/draft-2026-04-28-b/draft-001.email-outbound.card");
  const other = await readFile(otherPath, "utf-8");
  t.check(result, {
    success: true,
    created: [],
    updated: ["_content/inbox/email/draft-2026-04-28-b/draft-001.email-outbound.card"],
    procedures: [],
    error: "Draft upload failed for 1 card: _content/inbox/email/draft-2026-04-28-b/draft-001.email-outbound.card: socket hang up",
  });
  t.check(other, str`---
type: email-outbound
status: draft
to: bob@example.com
subject: Hi
gmail-draft-failing-since: ${isoDate()}
---
Hello.
`);

  // The first retried failure starts a clock on the card; a later failure inside
  // the week leaves the card as it is:

  // doctest:L253
  await createGmailConnector(box.root, offline).sync();
  t.check(await readFile(otherPath, "utf-8"), other);

  // ## Retried failures stop after a week
  //
  // Nothing retries forever. A draft whose upload has failed for 7 days is stranded
  // with the last error, like a card problem, and the dashboard lists it:

  // doctest:L264
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  await writeFile(otherPath, other.replace(/gmail-draft-failing-since: .*/, `gmail-draft-failing-since: ${eightDaysAgo}`));
  await createGmailConnector(box.root, offline).sync();
  const gaveUp = await readFile(otherPath, "utf-8");
  t.check(gaveUp, `---
type: email-outbound
status: draft
to: bob@example.com
subject: Hi
gmail-draft-error: "Upload kept failing for 7 days, since ${eightDaysAgo}: socket hang up"
---
Hello.
`);

  // doctest:L271
  t.check(await strandedDraftsHealthChecks(box.root), [{
    name: "gmail-drafts",
    ok: false,
    message: `2 Gmail drafts could not be uploaded and are no longer retried: _content/inbox/email/draft-2026-04-28-a/draft-001.email-outbound.card (Gmail rejected the draft: Invalid To header); _content/inbox/email/draft-2026-04-28-b/draft-001.email-outbound.card (Upload kept failing for 7 days, since ${eightDaysAgo}: socket hang up). Fix the card, then delete its gmail-draft-error line to retry.`,
    severity: "warning",
  }]);

  // Deleting the error line retries it; a successful upload clears the clock:

  // doctest:L278
  await writeFile(otherPath, gaveUp.replace(/gmail-draft-error: .*\n/, "gmail-draft-failing-since: 2026-01-01T00:00:00.000Z\n"));
  const online = createFakeGoogleGmail();
  await createGmailConnector(box.root, online).sync();
  const sent = await readFile(otherPath, "utf-8");
  t.check(uploaded(online), [{
    draft: DRAFT("t-fake-1"),
    raw: `To: bob@example.com\r\nSubject: Hi\r\n${MIME_TAIL}Hello.\n`,
  }]);
  t.check(sent, `---
type: email-outbound
status: draft
to: bob@example.com
subject: Hi
gmail-draft-id: r-fake-1
gmail-draft-url: https://mail.google.com/mail/u/0/#drafts/m-fake-1
---
Hello.
`);
});

// ## Already-stamped outbounds are skipped
//
// An outbound card with `gmail-draft-id` set has already been uploaded — the
// connector leaves it alone:
void test("An outbound card with gmail-draft-id set has already been uploaded — the conn...", async (t) => {
  // doctest:L292
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed("_config/connectors/gmail.json", "{}\n");
  box.commitAll("init box");

  // doctest:L297
  await mkdir(join(box.root, "_content/inbox/email/draft-2026-04-28-already"), { recursive: true });
  await box.seed(
    "_content/inbox/email/draft-2026-04-28-already/draft-001.email-outbound.card",
    "---\ntype: email-outbound\nstatus: draft\nto: bob@example.com\nsubject: Already done\ngmail-draft-id: r-existing\ngmail-draft-url: https://mail.google.com/mail/u/0/#drafts/m-existing\n---\nTest.\n",
  );
  box.commitAll("setup");

  // doctest:L304
  const gmail = createFakeGoogleGmail();
  const connector = createGmailConnector(box.root, gmail);
  await connector.sync();

  // doctest:L308
  t.check(gmail.drafts, []);
});

// ## Received email-message cards are not picked up as outbound
//
// A normal received `email-message` card under `_content/inbox/email/` is left
// alone — the connector only uploads `email-outbound` cards:
void test("A normal received email-message card under content/inbox/email/ is left alone...", async (t) => {
  // doctest:L318
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed("_config/connectors/gmail.json", "{}\n");
  box.commitAll("init box");

  // doctest:L323
  await mkdir(join(box.root, "_content/inbox/email/thread-Hello-xyz12345"), { recursive: true });
  await box.seed(
    "_content/inbox/email/thread-Hello-xyz12345/msg-001.email-message.card",
    "---\ntype: email-message\nemail:\n  message-id: m1-at-example.com\n  thread-id: thread-xyz12345\n  from: alice@example.com\n  to: me@example.com\n  received: 2026-02-15T10:00:00Z\n  subject: Hello\nbody-file:\n  ref: msg-001.body.txt\n---\n",
  );
  box.commitAll("setup");

  // doctest:L330
  const gmail = createFakeGoogleGmail();
  const connector = createGmailConnector(box.root, gmail);
  await connector.sync();

  // doctest:L334
  t.check(gmail.drafts, []);
});
