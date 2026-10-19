// # Gmail tracked working set
//
// An email thread is tracked when one live `*.email-thread.card` exists. Moving
// the card within live box content keeps it tracked. Moving it to trash or
// deleting it stops tracking without changing Gmail.

import { test } from "tap";
import "agent-doctest/tap";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { initBox } from "../../../src/core/box/structure/core.js";
import { createEmailThreadTemplate } from "../../../src/schemas/email-thread.js";
import { errorMessage } from "../../../src/shared/error-guards.js";
import { createFakeGoogleGmail } from "../../../src/services/google-gmail-fake/core.js";
import type { GmailMessage } from "../../../src/services/google-gmail-types.js";
import {
  findTrackedGmailThreads,
  remainingAutomaticTrackingBudget,
} from "../../../src/connectors/gmail/tracking.js";
import { parseGmailConnectorConfig } from "../../../src/connectors/gmail/config.js";
import { trackGmailThread } from "../../../src/connectors/gmail/track.js";

async function writeThread({ root, relPath, threadId }: { root: string; relPath: string; threadId: string }): Promise<void> {
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

// ## Card existence is authoritative
void test("Card existence is authoritative", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L67
  const box = await makeTmpBox();
  await writeThread({ root: box.root, relPath: "_content/inbox/email/First.email-thread.card", threadId: "thread-1" });

  // doctest:L70
  const first = await findTrackedGmailThreads(box.root);
  t.check(first, new Map([
    ["thread-1", {
      threadId: "thread-1",
      absPath: join(box.root, "_content/inbox/email/First.email-thread.card"),
      relPath: "_content/inbox/email/First.email-thread.card",
    }],
  ]));

  // doctest:L74
  await mkdir(join(box.root, "_bookkeeping/archive/done"), { recursive: true });
  await rename(
    join(box.root, "_content/inbox/email/First.email-thread.card"),
    join(box.root, "_bookkeeping/archive/done/First.email-thread.card"),
  );
  const moved = await findTrackedGmailThreads(box.root);
  t.check(moved, new Map([
    ["thread-1", {
      threadId: "thread-1",
      absPath: join(box.root, "_bookkeeping/archive/done/First.email-thread.card"),
      relPath: "_bookkeeping/archive/done/First.email-thread.card",
    }],
  ]));

  // doctest:L83
  await mkdir(join(box.root, "_bookkeeping/trash"), { recursive: true });
  await rename(
    join(box.root, "_bookkeeping/archive/done/First.email-thread.card"),
    join(box.root, "_bookkeeping/trash/First.email-thread.card"),
  );
  t.check(await findTrackedGmailThreads(box.root), new Map());
});

// Deleting the card also removes it from the tracked set. A leftover attach
// scope is not itself tracking state.
void test("Deleting the card also removes it from the tracked set.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L100
  const box = await makeTmpBox();
  await writeThread({ root: box.root, relPath: "_content/inbox/email/Delete.email-thread.card", threadId: "thread-delete" });
  await mkdir(join(box.root, "_content/inbox/email/Delete.attach"), { recursive: true });
  await rm(join(box.root, "_content/inbox/email/Delete.email-thread.card"));
  t.check(await findTrackedGmailThreads(box.root), new Map());
});

// ## Invalid or duplicate identities fail clearly
void test("Invalid or duplicate identities fail clearly", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L115
  const box = await makeTmpBox();
  await box.seed(
    "_content/inbox/email/Broken.email-thread.card",
    "---\nemail:\n  subject: Missing identity\n  participants: []\n  date-range:\n    start: 2026-08-01T10:00:00.000Z\n    end: 2026-08-01T10:00:00.000Z\nmessages: []\n---\n",
  );
  let broken = "";
  await findTrackedGmailThreads(box.root).catch((error: Error) => { broken = error.message; });
  t.check(broken, `_content/inbox/email/Broken.email-thread.card: invalid email-thread frontmatter:
  - email.thread-id: required (expected string)`);
});

void test("Invalid or duplicate identities fail clearly (line 130)", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L131
  const box = await makeTmpBox();
  await writeThread({ root: box.root, relPath: "_content/inbox/email/One.email-thread.card", threadId: "same-thread" });
  await writeThread({ root: box.root, relPath: "_bookkeeping/archive/done/Two.email-thread.card", threadId: "same-thread" });
  let duplicate = "";
  await findTrackedGmailThreads(box.root).catch((error: Error) => { duplicate = error.message; });
  t.check(duplicate, "Gmail thread same-thread is tracked by more than one card: _bookkeeping/archive/done/Two.email-thread.card, _content/inbox/email/One.email-thread.card");
});

// ## Automatic tracking uses a rolling thread budget
//
// The budget returns only events still inside the rolling window. Reaching the
// limit yields zero remaining capacity; it does not create a deferred queue.
void test("The budget returns only events still inside the rolling window.", async (t) => {
  // doctest:L150
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
  t.check(result, {
    remaining: 0,
    events: [
      "2026-08-01T00:00:00.000Z",
      "2026-08-03T00:00:00.000Z",
      "2026-08-05T00:00:00.000Z",
    ],
  });

  // Raising the configured cap opens capacity immediately.

  // doctest:L167
  t.check(
    remainingAutomaticTrackingBudget({
      budget: { threads: 5, windowMs: 7 * 24 * 60 * 60 * 1000 },
      events: result.events,
      now: new Date("2026-08-05T12:00:00.000Z"),
    }),
    {
      remaining: 2,
      events: ["2026-08-01T00:00:00.000Z", "2026-08-03T00:00:00.000Z", "2026-08-05T00:00:00.000Z"],
    },
  );
});

// ## Gmail rules are validated and the shorthand becomes bounded
//
// No configuration means no rule can create a card.
void test("No configuration means no rule can create a card.", async (t) => {
  // doctest:L180
  t.check(parseGmailConnectorConfig({}), { rules: [], gc: undefined, gcIntervalHours: undefined });
});

// Track and procedure actions form a closed, validated union.
void test("Track and procedure actions form a closed, validated union.", async (t) => {
  // doctest:L187
  const config = parseGmailConnectorConfig({
    rules: [
      {
        name: "send-to-agent",
        query: "label:beebox",
        action: { type: "track", budget: { threads: 10, window: "14d" } },
      },
      {
        name: "review-inbox",
        query: "label:inbox is:unread",
        action: { type: "procedure", ref: "_config/procedures/review-email.procedure.card" },
      },
    ],
  });
  t.check(config, {
    rules: [
      {
        name: "send-to-agent",
        query: "label:beebox",
        action: { type: "track", budget: { threads: 10, windowMs: 1209600000 } },
      },
      {
        name: "review-inbox",
        query: "label:inbox is:unread",
        action: { type: "procedure", ref: "_config/procedures/review-email.procedure.card" },
      },
    ],
    gc: undefined,
    gcIntervalHours: undefined,
  });
});

// The `labels`/`query` shorthand expands to one rule carrying its own action, and
// a `track` action gains the default 25-thread rolling seven-day budget.
void test("The labels/query shorthand expands to one rule carrying its own action, and a...", async (t) => {
  // doctest:L209
  const shorthand = parseGmailConnectorConfig({
    labels: ["callback"],
    action: { type: "track" },
  });
  t.check(shorthand, {
    rules: [
      {
        name: "shorthand",
        query: "label:callback",
        action: { type: "track", budget: { threads: 25, windowMs: 604800000 } },
      },
    ],
    gc: undefined,
    gcIntervalHours: undefined,
  });
});

// `stage` is the third action: record the match and do nothing else.
void test("stage is the third action:", async (t) => {
  // doctest:L226
  const staged = parseGmailConnectorConfig({
    labels: ["callback"],
    action: { type: "stage" },
  });
  t.check(staged, {
    rules: [{ name: "shorthand", query: "label:callback", action: { type: "stage" } }],
    gc: undefined,
    gcIntervalHours: undefined,
  });
});

// The shorthand can route to a procedure instead, which creates no cards.
void test("The shorthand can route to a procedure instead, which creates no cards.", async (t) => {
  // doctest:L237
  const routed = parseGmailConnectorConfig({
    query: "label:inbox is:unread",
    action: { type: "procedure", ref: "_config/procedures/review-email.procedure.card" },
  });
  t.check(routed, {
    rules: [
      {
        name: "shorthand",
        query: "label:inbox is:unread",
        action: { type: "procedure", ref: "_config/procedures/review-email.procedure.card" },
      },
    ],
    gc: undefined,
    gcIntervalHours: undefined,
  });
});

// The action is required, never implied. A shorthand without one is an error
// rather than a silent `track` — the whole point, since tracking creates cards.
void test("The action is required, never implied.", async (t) => {
  // doctest:L249
  await t.checkThrows(async () => (parseGmailConnectorConfig({ labels: ["callback"] })), "MissingGmailActionError");
});

// An action with nothing to match is equally an error, so a stray action cannot
// sit in a config doing nothing.
//
// `query` and `labels` are two spellings of the same shorthand. Setting both is an
// error rather than a precedence rule, because the losing one would sit in the
// file looking effective while matching nothing.
void test("An action with nothing to match is equally an error, so a stray action cannot...", async (t) => {
  // doctest:L261
  await t.checkThrows(async () => (parseGmailConnectorConfig({ query: "is:unread", labels: ["a"], action: { type: "track" } })), "AmbiguousGmailShorthandError");
});

void test("Gmail rules are validated and the shorthand becomes bounded", async (t) => {
  // doctest:L266
  await t.checkThrows(async () => (parseGmailConnectorConfig({ action: { type: "track" } })), "StrayGmailActionError");

  // doctest:L269
  await t.checkThrows(async () => (parseGmailConnectorConfig({ rules: [{ name: "a", query: "label:x", action: { type: "track" } }], action: { type: "track" } })), "StrayGmailActionError");
});

// Invalid actions and duplicate rule names fail at the config boundary.
void test("Invalid actions and duplicate rule names fail at the config boundary.", async (t) => {
  // doctest:L276
  let invalid = "";
  try {
    parseGmailConnectorConfig({
      rules: [{ name: "bad", query: "label:x", action: { type: "delete" } }],
    });
  } catch (error) {
    invalid = errorMessage(error);
  };
  t.check(invalid, "Invalid _config/connectors/gmail.json: Invalid discriminator value. Expected 'track' | 'procedure' | 'stage'");
});

void test("Gmail rules are validated and the shorthand becomes bounded (line 288)", async (t) => {
  // doctest:L289
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
  t.check(duplicateRules, "Invalid _config/connectors/gmail.json: duplicate Gmail rule name: same");
});

// ## Tracking one thread is explicit and idempotent
void test("Tracking one thread is explicit and idempotent", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L307
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
  t.check(first, {
    cardPath: "_content/inbox/email/thread-Track_me-ad-track.email-thread.card",
    created: [
      "_content/inbox/email/thread-Track_me-ad-track.attach/msg-001.email-message.card",
      "_content/inbox/email/thread-Track_me-ad-track.attach/msg-001.attach/msg-001.body.txt",
      "_content/inbox/email/thread-Track_me-ad-track.email-thread.card",
    ],
    updated: [],
  });

  // doctest:L325
  t.check(await findTrackedGmailThreads(box.root), new Map([
    ["thread-track", {
      threadId: "thread-track",
      absPath: join(box.root, "_content/inbox/email/thread-Track_me-ad-track.email-thread.card"),
      relPath: "_content/inbox/email/thread-Track_me-ad-track.email-thread.card",
    }],
  ]));

  // doctest:L328
  const second = await trackGmailThread({
    boxRoot: box.root,
    service: gmail,
    threadId: "thread-track",
    trackedBy: "explicit-command",
  });
  t.check(second, { cardPath: "_content/inbox/email/thread-Track_me-ad-track.email-thread.card", created: [], updated: [] });

  // doctest:L337
  gmail.addMessage(
    gmailMessage({ id: "m2", threadId: "thread-track", subject: "Track me", body: "Second" }),
  );
  const refreshed = await trackGmailThread({
    boxRoot: box.root,
    service: gmail,
    threadId: "thread-track",
    trackedBy: "explicit-command",
  });
  t.check(refreshed, {
    cardPath: "_content/inbox/email/thread-Track_me-ad-track.email-thread.card",
    created: [
      "_content/inbox/email/thread-Track_me-ad-track.attach/msg-002.email-message.card",
      "_content/inbox/email/thread-Track_me-ad-track.attach/msg-002.attach/msg-002.body.txt",
    ],
    updated: ["_content/inbox/email/thread-Track_me-ad-track.email-thread.card"],
  });

  // doctest:L349
  t.check(gmail.drafts, []);
});
