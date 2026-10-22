// # Gmail tracked-working-set sync
//
// Regular Gmail sync advances a private history cursor but creates no email
// cards unless a thread is already tracked or a bounded rule selects it.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate } from "@ianbicking/tap-check/check";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { initBox } from "../../src/core/box/structure/core.js";
import { createGmailConnector } from "../../src/connectors/gmail/connector.js";
import { trackGmailThread } from "../../src/connectors/gmail/track.js";
import { findTrackedGmailThreads } from "../../src/connectors/gmail/tracking.js";
import { createFakeGoogleGmail } from "../../src/services/google-gmail-fake/core.js";
import type { GmailMessage } from "../../src/services/google-gmail-types.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

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
  return JSON.parse(await readFile(join(root, "_bookkeeping/connectors/gmail.state.json"), "utf-8"));
}

// ## A missing config file stops the sync
//
// Gmail is enabled for the box but nothing says what to collect. That is a
// misconfiguration, not a quiet no-op: degrading to "no rules" made a stalled
// connector indistinguishable from a healthy idle one.
void test("Gmail is enabled for the box but nothing says what to collect.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  box.commitAll("initialize box");
  const result = await createGmailConnector(box.root, createFakeGoogleGmail()).sync();
  t.check(result, {
    success: false,
    created: [],
    updated: [],
    error: "Gmail sync failed: Invalid _config/connectors/gmail.json: file not found — Gmail is enabled for this box but has no configuration",
  });
});

// ## An empty config means no automatic cards
//
// An explicit `{}` is the way to say "connected, nothing automatic". The initial
// run establishes a history checkpoint; existing and later mail stay remote.
void test("An explicit {} is the way to say \"connected, nothing automatic\".", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed("_config/connectors/gmail.json", "{}\n");
  box.commitAll("initialize box");
  const gmail = createFakeGoogleGmail({
    labels: [{ id: "INBOX", name: "INBOX", type: "system" }],
    messages: [message({ id: "old", subject: "Existing mail" })],
  });
  const connector = createGmailConnector(box.root, gmail);
  t.check(await connector.sync(), { success: true, created: [], updated: [], procedures: [] });

  gmail.addMessage(message({ id: "new", subject: "New mail" }));
  t.check(await connector.sync(), { success: true, created: [], updated: [], procedures: [] });

  t.check(await findTrackedGmailThreads(box.root), new Map());

  t.check(await transientState(box.root), { historyId: "2" });
});

// ## Procedure rules return post-sync requests
//
// A procedure action records a bounded summary and returns one coalesced request;
// it does not create an email card itself.
void test("A procedure action records a bounded summary and returns one coalesced reques...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed("_config/connectors/gmail.json", JSON.stringify({
    rules: [{
      name: "review-mail",
      query: "label:callback",
      action: {
        type: "procedure",
        ref: "_config/procedures/review-mail.procedure.card",
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
  t.check(result, {
    success: true,
    created: [],
    updated: [],
    procedures: [
      {
        procedureRef: "_config/procedures/review-mail.procedure.card",
        directive: "Gmail rule review-mail has new matching mail. Inspect with: bbx connector gmail pending review-mail",
      },
    ],
  });

  t.check(await transientState(box.root), {
    historyId: "2",
    rules: {
      "review-mail": {
        baselineAt: isoDate(),
        baselineMatches: 0,
        pending: [
          {
            messageId: "review",
            threadId: "t-review",
            from: "sender@example.com",
            subject: "Review",
            date: "2026-08-01T15:00:00.000Z",
            snippet: "Snippet review",
            labels: ["callback"],
            discoveredAt: isoDate(),
          },
        ],
        additionalMatches: 0,
      },
    },
  });
});

// ## Legacy transient state migrates on sync
//
// The obsolete GC timestamp is ignored and removed on the next successful state
// write instead of permanently wedging upgraded connectors.
void test("The obsolete GC timestamp is ignored and removed on the next successful state...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed("_config/connectors/gmail.json", "{}\n");
  await box.seed("_bookkeeping/connectors/gmail.state.json", JSON.stringify({
    historyId: "1",
    lastReconcileAt: "2026-08-01T00:00:00.000Z",
  }));
  box.commitAll("initialize box");
  const gmail = createFakeGoogleGmail();
  const result = await createGmailConnector(box.root, gmail).sync();
  t.check(result, { success: true, created: [], updated: [], procedures: [] });

  t.check(await transientState(box.root), {
    historyId: "1",
  });
});

// ## Tracked cards refresh automatically
//
// Once explicitly tracked, a thread is refreshed on regular connector sync. An
// untracked thread arriving in the same history window is not materialized.
void test("Once explicitly tracked, a thread is refreshed on regular connector sync.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed("_config/connectors/gmail.json", "{}\n");
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
  t.check(fetchedThreads, 0);

  gmail.addMessage(message({ id: "m2", threadId: "tracked", subject: "Working thread" }));
  gmail.addMessage(message({ id: "other", threadId: "untracked", subject: "Other thread" }));
  const result = await connector.sync();
  t.check(result, {
    success: true,
    created: [
      "_content/inbox/email/thread-Working_thread-tracked.attach/msg-002.email-message.card",
      "_content/inbox/email/thread-Working_thread-tracked.attach/msg-002.attach/msg-002.body.txt",
    ],
    updated: ["_content/inbox/email/thread-Working_thread-tracked.email-thread.card"],
    procedures: [],
  });

  t.check(fetchedThreads, 1);

  t.check(await findTrackedGmailThreads(box.root), new Map([
    ["tracked", {
      threadId: "tracked",
      absPath: join(box.root, "_content/inbox/email/thread-Working_thread-tracked.email-thread.card"),
      relPath: "_content/inbox/email/thread-Working_thread-tracked.email-thread.card",
    }],
  ]));
});

// ## Automatic rules baseline and cap thread creation
//
// Enabling a rule reports its existing match count without importing backlog.
// Later matches can create cards, but the rolling cap stops an over-match and
// leaves a visible pending summary in private state.
void test("Enabling a rule reports its existing match count without importing backlog.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed("_config/connectors/gmail.json", JSON.stringify({
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
  t.check(await connector.sync(), { success: true, created: [], updated: [], procedures: [] });

  t.check(await transientState(box.root), {
    rules: { "agent-label": { baselineAt: isoDate(), baselineMatches: 1 } },
    historyId: "1",
  });

  gmail.addMessage(message({ id: "first", subject: "First new", labelIds: ["Label_7"] }));
  gmail.addMessage(message({ id: "second", subject: "Second new", labelIds: ["Label_7"] }));
  const result = await connector.sync();
  t.check(result, {
    success: true,
    created: [
      "_content/inbox/email/thread-First_new-t-first.attach/msg-001.email-message.card",
      "_content/inbox/email/thread-First_new-t-first.attach/msg-001.attach/msg-001.body.txt",
      "_content/inbox/email/thread-First_new-t-first.email-thread.card",
    ],
    updated: [],
    procedures: [],
  });

  t.check(await findTrackedGmailThreads(box.root), new Map([
    ["t-first", {
      threadId: "t-first",
      absPath: join(box.root, "_content/inbox/email/thread-First_new-t-first.email-thread.card"),
      relPath: "_content/inbox/email/thread-First_new-t-first.email-thread.card",
    }],
  ]));

  const state = await transientState(box.root);
  t.check(state, {
    historyId: "3",
    rules: {
      "agent-label": {
        baselineAt: isoDate(),
        baselineMatches: 1,
        automaticTrackingEvents: [isoDate()],
        pending: [
          {
            messageId: "second",
            threadId: "t-second",
            from: "sender@example.com",
            subject: "Second new",
            date: "2026-08-01T15:00:00.000Z",
            snippet: "Snippet second",
            labels: ["callback"],
            discoveredAt: isoDate(),
          },
        ],
        additionalMatches: 0,
      },
    },
  });
});

// ## Expired history never causes backlog materialization
//
// An expired cursor establishes a new checkpoint, leaves tracked cards in place, and
// recounts rule matches. It does not full-list messages into Git.
void test("An expired cursor establishes a new checkpoint, leaves tracked cards in place...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed("_config/connectors/gmail.json", JSON.stringify({ labels: ["callback"], action: { type: "track" } }));
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
  t.check(result, { success: true, created: [], updated: [], procedures: [] });

  t.check(await transientState(box.root), {
    historyId: "3",
    rules: { shorthand: { baselineAt: isoDate(), baselineMatches: 2 } },
  });
});

// ## Deleting a card during refresh does not retrack it
//
// Only an explicit rule selection may create a card. If an already tracked card
// disappears after discovery but before the refreshed snapshot is written, sync
// leaves it untracked.
void test("Only an explicit rule selection may create a card.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed("_config/connectors/gmail.json", "{}\n");
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
  t.check(result, { success: true, created: [], updated: [], procedures: [] });

  t.check(await findTrackedGmailThreads(box.root), new Map());
});

// ## A message deleted after history named it does not stop sync
//
// Gmail history keeps naming a message after it is deleted, and fetching it is
// not found. Sync skips it, handles the rest of the window, and advances the
// cursor. A failure here used to keep `historyId` in place, so every later sync
// replayed the same history and failed the same way.
void test("A message deleted after history named it does not stop sync", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed("_config/connectors/gmail.json", JSON.stringify({
    rules: [{ name: "agent-label", query: "label:callback", action: { type: "track" } }],
  }));
  box.commitAll("initialize box");
  const gmail = createFakeGoogleGmail({
    labels: [{ id: "Label_7", name: "callback", type: "user" }],
  });
  const connector = createGmailConnector(box.root, gmail);
  await connector.sync();
  gmail.addMessage(message({ id: "deleted", subject: "Deleted", labelIds: ["Label_7"] }));
  gmail.addMessage(message({ id: "kept", subject: "Kept", labelIds: ["Label_7"] }));
  gmail.deleteMessage("deleted");
  const result = await connector.sync();
  t.check(result, {
    success: true,
    created: [
      "_content/inbox/email/thread-Kept-t-kept.attach/msg-001.email-message.card",
      "_content/inbox/email/thread-Kept-t-kept.attach/msg-001.attach/msg-001.body.txt",
      "_content/inbox/email/thread-Kept-t-kept.email-thread.card",
    ],
    updated: [],
    procedures: [],
  });

  t.check(await transientState(box.root), {
    historyId: "4",
    rules: {
      "agent-label": {
        baselineAt: isoDate(),
        baselineMatches: 0,
        automaticTrackingEvents: [isoDate()],
      },
    },
  });
});

// ## A tracked thread deleted in Gmail keeps its card
//
// Deleting the card is how a person untracks a thread; Gmail deleting the
// thread is not. Sync skips the thread, leaves the card as it was, and
// advances the cursor.
void test("A tracked thread deleted in Gmail keeps its card", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed("_config/connectors/gmail.json", "{}\n");
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
  await connector.sync();
  gmail.addMessage(message({ id: "m2", threadId: "tracked", subject: "Working thread" }));
  gmail.deleteMessage("m1");
  gmail.deleteMessage("m2");
  t.check(await connector.sync(), { success: true, created: [], updated: [], procedures: [] });

  t.check(await transientState(box.root), { historyId: "4" });
  t.check(await findTrackedGmailThreads(box.root), new Map([
    ["tracked", {
      threadId: "tracked",
      absPath: join(box.root, "_content/inbox/email/thread-Working_thread-tracked.email-thread.card"),
      relPath: "_content/inbox/email/thread-Working_thread-tracked.email-thread.card",
    }],
  ]));
});
