// # Gmail draft uploads
//
// The Gmail connector picks up agent-authored `email-outbound` cards under
// `_content/inbox/email/` and uploads them to Gmail as drafts. After upload, each
// card is stamped with `gmail-draft-id` and `gmail-draft-url` so the user can
// open the draft in Gmail.

import { test } from "tap";
import "agent-doctest/tap";
import { join } from "node:path";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { initBox } from "../../../src/core/box/structure/core.js";
import { createFakeGoogleGmail } from "../../../src/services/google-gmail-fake/core.js";
import { createGmailConnector } from "../../../src/connectors/gmail/connector.js";
import { strandedDraftsHealthChecks } from "../../../src/webapp/trpc/routers/health/checks/connectors.js";

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
  t.check(result.success, true);

  // doctest:L39
  await t.checkText(gmail.drafts.length, "1");

  // The card is stamped with the returned draft id and URL:

  // doctest:L46
  const stampedPath = "_content/inbox/email/draft-2026-04-28-hello/draft-001.email-outbound.card";
  const stamped = await readFile(join(box.root, stampedPath), "utf-8");
  await t.checkText(stamped.includes("gmail-draft-id: r-fake-1"), "true");

  // doctest:L51
  await t.checkText(
    stamped.includes("gmail-draft-url: https://mail.google.com/mail/u/0/#drafts/m-fake-1")
    ,
    "true",
  );

  // The MIME we uploaded has the headers and body:

  // doctest:L58
  const raw = gmail.drafts[0]?.raw ?? "";
  const decoded = Buffer.from(raw.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf-8");
  await t.checkText(decoded.includes("To: alice@example.com"), "true");

  // doctest:L63
  await t.checkText(decoded.includes("Subject: Hello"), "true");

  // doctest:L66
  await t.checkText(decoded.includes("Hi there."), "true");
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
  await t.checkText(gmail.drafts.length, "1");

  // doctest:L101
  t.check(
    // Reply uses the source thread-id
    gmail.drafts[0]?.draft.message.threadId,
    "thread-abc12345",
  );

  // The MIME has the threading headers:

  // doctest:L109
  const raw = gmail.drafts[0]?.raw ?? "";
  const decoded = Buffer.from(raw.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf-8");
  await t.checkText(decoded.includes("In-Reply-To: orig-msg-id-123"), "true");

  // doctest:L114
  await t.checkText(decoded.includes("References: orig-msg-id-123"), "true");
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
  await t.checkText(gmail.drafts.length, "1");

  // doctest:L148
  t.check(gmail.drafts[0]?.draft.message.threadId, "thread-zzz99999");
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
  await t.checkText(
    // No draft uploaded, sync reports the error per-card
    gmail.drafts.length,
    "0",
  );

  // doctest:L179
  t.check(result.success, true);

  // doctest:L182
  t.check(
    // Inbound sync succeeded, but the failed card is named in the error, so the
    // wakeup and finalize output (and the connector activity record) show it.
    result.error?.startsWith("Draft upload failed for 1 card: _content/inbox/email/thread-Bad-aaa00000/draft-001.email-outbound.card: "),
    true,
  );

  // doctest:L187
  // No draft id. The failure is the card's own, so the reason is written on
  // the card and the connector stops retrying it.
  const cardPath = join(box.root, "_content/inbox/email/thread-Bad-aaa00000/draft-001.email-outbound.card");
  const stamped = await readFile(cardPath, "utf-8");
  t.check(`${stamped.includes("gmail-draft-id")} | ${stamped.includes("gmail-draft-error: in-reply-to ref")}`, "false | true");

  // The next sync leaves the stranded card alone: no retry and no error. The
  // dashboard lists it instead, until someone fixes the card and deletes the
  // `gmail-draft-error` line:

  // doctest:L200
  const again = await connector.sync();
  t.check(`${again.error} | ${gmail.drafts.length}`, "undefined | 0");

  // doctest:L204
  const [check] = await strandedDraftsHealthChecks(box.root);
  t.check(`${check?.name} | ${check?.message.startsWith("1 Gmail draft could not be uploaded and is no longer retried: _content/inbox/email/thread-Bad-aaa00000/draft-001.email-outbound.card")}`, "gmail-drafts | true");

  // doctest:L208
  // Fixing the card: point the ref at nothing (a new thread) and drop the error line.
  await writeFile(cardPath, "---\ntype: email-outbound\nstatus: draft\nto: x@y.com\nsubject: \"Re: missing\"\n---\n...\n");
  await connector.sync();
  t.check(`${gmail.drafts.length} | ${(await strandedDraftsHealthChecks(box.root)).length}`, "1 | 0");
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
  await t.checkText((await readFile(cardPath, "utf-8")).includes("gmail-draft-error: \"Gmail rejected the draft: Invalid To header\""), "true");

  // doctest:L237
  await box.seed(
    "_content/inbox/email/draft-2026-04-28-b/draft-001.email-outbound.card",
    "---\ntype: email-outbound\nstatus: draft\nto: bob@example.com\nsubject: Hi\n---\nHello.\n",
  );
  const offline = { ...createFakeGoogleGmail(), createDraft: async () => { throw new Error("socket hang up"); } };
  const result = await createGmailConnector(box.root, offline).sync();
  const otherPath = join(box.root, "_content/inbox/email/draft-2026-04-28-b/draft-001.email-outbound.card");
  const other = await readFile(otherPath, "utf-8");
  t.check(`${result.error?.includes("socket hang up")} | ${other.includes("gmail-draft-error")} | ${other.includes("gmail-draft-failing-since:")}`, "true | false | true");

  // The first retried failure starts a clock on the card; a later failure inside
  // the week leaves the card as it is:

  // doctest:L253
  await createGmailConnector(box.root, offline).sync();
  await t.checkText((await readFile(otherPath, "utf-8")) === other, "true");

  // ## Retried failures stop after a week
  //
  // Nothing retries forever. A draft whose upload has failed for 7 days is stranded
  // with the last error, like a card problem, and the dashboard lists it:

  // doctest:L264
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  await writeFile(otherPath, other.replace(/gmail-draft-failing-since: .*/, `gmail-draft-failing-since: ${eightDaysAgo}`));
  await createGmailConnector(box.root, offline).sync();
  const gaveUp = await readFile(otherPath, "utf-8");
  t.check(`${gaveUp.includes("gmail-draft-error: \"Upload kept failing for 7 days")} | ${gaveUp.includes("gmail-draft-failing-since")}`, "true | false");

  // doctest:L271
  t.check((await strandedDraftsHealthChecks(box.root))[0]?.message.includes("draft-2026-04-28-b"), true);

  // Deleting the error line retries it; a successful upload clears the clock:

  // doctest:L278
  await writeFile(otherPath, gaveUp.replace(/gmail-draft-error: .*\n/, "gmail-draft-failing-since: 2026-01-01T00:00:00.000Z\n"));
  const online = createFakeGoogleGmail();
  await createGmailConnector(box.root, online).sync();
  const sent = await readFile(otherPath, "utf-8");
  t.check(`${online.drafts.length} | ${sent.includes("gmail-draft-id")} | ${sent.includes("gmail-draft-failing-since")}`, "1 | true | false");
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
  await t.checkText(gmail.drafts.length, "0");
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
  await t.checkText(gmail.drafts.length, "0");
});
