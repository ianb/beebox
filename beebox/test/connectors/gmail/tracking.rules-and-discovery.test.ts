// # Gmail tracked working set: rules, discovery, and gws
//
// Continues [tracking.doctest.md](tracking.doctest.md). This part covers the rules baseline and its bounds, resumable history discovery, the shared tracking lock, and the read-only `gws` passthrough with its bounded capture.

import { test } from "tap";
import "agent-doctest/tap";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { errorMessage } from "../../../src/shared/error-guards.js";
import { createFakeGoogleGmail } from "../../../src/services/google-gmail-fake/core.js";
import type { GmailMessage } from "../../../src/services/google-gmail-types.js";
import { parseGmailConnectorConfig } from "../../../src/connectors/gmail/config.js";
import { withGmailTrackingLock } from "../../../src/connectors/gmail/track.js";
import { evaluateGmailRules } from "../../../src/connectors/gmail/rules.js";
import { parseGmailTransientState } from "../../../src/connectors/gmail/state.js";
import {
  discoverGmailChanges,
  GMAIL_HISTORY_REF_LIMIT,
} from "../../../src/connectors/gmail/discovery.js";
import { assertReadOnlyGwsArgs, boundedCapture } from "../../../src/connectors/gmail/gws.js";

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

type FakeGmail = ReturnType<typeof createFakeGoogleGmail>;
type GmailConfig = ReturnType<typeof parseGmailConnectorConfig>;

/** Evaluates a message whose Message-ID is unsafe, counting each Gmail search it provokes. */
async function evaluateUnsafeMessage({ gmail, config }: { gmail: FakeGmail; config: GmailConfig }) {
  const unsafe = gmailMessage({
    id: "unsafe",
    threadId: "unsafe-thread",
    subject: "Unsafe identifier",
    body: "Body",
  });
  unsafe.payload!.headers = unsafe.payload!.headers!.map((header) =>
    header.name === "Message-ID"
      ? { ...header, value: "<a@b.example) OR (label:inbox>" }
      : header,
  );
  let queries = 0;
  const originalListMessages = gmail.listMessages.bind(gmail);
  gmail.listMessages = async (opts) => {
    queries += 1;
    return originalListMessages(opts);
  };
  const result = await evaluateGmailRules({
    service: gmail,
    config,
    state: { rules: { "review-mail": { baselineAt: "2026-08-01T00:00:00.000Z" } } },
    candidates: [unsafe],
    trackedThreadIds: new Set(),
    labelMap: new Map(),
    now: new Date("2026-08-05T14:00:00.000Z"),
  });
  return { queries, unevaluatedThreadId: result.state.rules?.["review-mail"]?.unevaluated?.[0]?.threadId };
}

/** A fake Gmail with one old message under the `callback` label. */
function oldMailGmail(): FakeGmail {
  return createFakeGoogleGmail({
    labels: [{ id: "Label_7", name: "callback", type: "user" }],
    messages: [
      { ...gmailMessage({ id: "old", threadId: "old-thread", subject: "Old", body: "Old" }), labelIds: ["Label_7"] },
    ],
  });
}

/** The later matching message, already added to `gmail`. */
function addFreshMessage(gmail: FakeGmail) {
  const fresh = { ...gmailMessage({ id: "new", threadId: "new-thread", subject: "New", body: "New" }), labelIds: ["Label_7"] };
  gmail.addMessage(fresh);
  return fresh;
}

// ## Rules baseline first and remain bounded
//
// Activating a rule reports the existing remote match count but does not track
// the backlog. Only later history candidates are eligible for its action.
void test("Activating a rule reports the existing remote match count but does not track...", async (t) => {
  // doctest:L51
  const gmail = oldMailGmail();
  const config = parseGmailConnectorConfig({ labels: ["callback"], action: { type: "track" } });
  const baseline = await evaluateGmailRules({
    service: gmail,
    config,
    state: {},
    candidates: [],
    trackedThreadIds: new Set(),
    labelMap: new Map([["Label_7", "callback"]]),
    now: new Date("2026-08-05T12:00:00.000Z"),
  });
  t.check(baseline.trackRequests, []);

  // doctest:L70
  t.check(baseline.state, { rules: { shorthand: { baselineAt: "2026-08-05T12:00:00.000Z", baselineMatches: 1 } } });

  // A later matching thread is selected once and consumes one rolling-budget
  // event, even if more than one changed message from that thread is examined.

  // doctest:L81
  const fresh = addFreshMessage(gmail);
  const selected = await evaluateGmailRules({
    service: gmail,
    config,
    state: baseline.state,
    candidates: [fresh, fresh],
    trackedThreadIds: new Set(),
    labelMap: new Map([["Label_7", "callback"]]),
    now: new Date("2026-08-05T13:00:00.000Z"),
  });
  t.check(selected.trackRequests, [
    {
      threadId: "new-thread",
      ruleName: "shorthand",
    },
  ]);

  // doctest:L95
  t.check(selected.state, {
    rules: {
      shorthand: {
        baselineAt: "2026-08-05T12:00:00.000Z",
        baselineMatches: 1,
        automaticTrackingEvents: ["2026-08-05T13:00:00.000Z"],
      },
    },
  });

});

void test("A spent budget and procedure rules summarize matches without tracking", async (t) => {
  const gmail = oldMailGmail();
  const fresh = addFreshMessage(gmail);

  // A spent budget leaves a visible private summary instead of creating a deferred
  // automatic-import queue.

  // doctest:L103
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
  t.check(capped.trackRequests, []);

  // doctest:L129
  t.check(capped.state, {
    rules: {
      "small-cap": {
        baselineAt: "2026-08-01T00:00:00.000Z",
        automaticTrackingEvents: ["2026-08-05T10:00:00.000Z"],
        pending: [
          {
            messageId: "new",
            threadId: "new-thread",
            from: "sender@example.com",
            subject: "New",
            date: "2026-08-01T15:00:00.000Z",
            snippet: "",
            labels: ["callback"],
            discoveredAt: "2026-08-05T13:00:00.000Z",
          },
        ],
        additionalMatches: 0,
      },
    },
  });

  // Procedure rules coalesce matching messages into one post-sync request and keep
  // the candidate content out of the directive.

  // doctest:L140
  const procedureConfig = parseGmailConnectorConfig({
    rules: [{
      name: "review-mail",
      query: "label:callback",
      action: { type: "procedure", ref: "_config/procedures/review-mail.procedure.card" },
    }],
  });
  const nonMatchingSameThread = {
    ...gmailMessage({ id: "not-matching", threadId: fresh.threadId, subject: "New", body: "New" }),
    labelIds: ["INBOX"],
  };
  const procedureResult = await evaluateGmailRules({
    service: gmail,
    config: procedureConfig,
    state: { rules: { "review-mail": { baselineAt: "2026-08-01T00:00:00.000Z" } } },
    candidates: [nonMatchingSameThread, fresh],
    trackedThreadIds: new Set(),
    labelMap: new Map([["Label_7", "callback"]]),
    now: new Date("2026-08-05T13:00:00.000Z"),
  });
  t.check(procedureResult.procedures, [
    {
      procedureRef: "_config/procedures/review-mail.procedure.card",
      directive: "Gmail rule review-mail has new matching mail. Inspect with: bbx connector gmail pending review-mail",
    },
  ]);

  // doctest:L163
  t.check(procedureResult.state, {
    rules: {
      "review-mail": {
        baselineAt: "2026-08-01T00:00:00.000Z",
        pending: [
          {
            messageId: "new",
            threadId: "new-thread",
            from: "sender@example.com",
            subject: "New",
            date: "2026-08-01T15:00:00.000Z",
            snippet: "",
            labels: ["callback"],
            discoveredAt: "2026-08-05T13:00:00.000Z",
          },
        ],
        additionalMatches: 0,
      },
    },
  });

});

void test("A stage rule and unsafe Message-IDs", async (t) => {
  const gmail = oldMailGmail();
  const fresh = addFreshMessage(gmail);
  const procedureConfig = parseGmailConnectorConfig({
    rules: [{
      name: "review-mail",
      query: "label:callback",
      action: { type: "procedure", ref: "_config/procedures/review-mail.procedure.card" },
    }],
  });

  // A `stage` rule records the same summary and stops there: no card is requested
  // and nothing is woken. That is the state a rule sits in while its procedure is
  // still being written.

  // doctest:L172
  const stageConfig = parseGmailConnectorConfig({
    rules: [{ name: "watch-mail", query: "label:callback", action: { type: "stage" } }],
  });
  const stageResult = await evaluateGmailRules({
    service: gmail,
    config: stageConfig,
    state: { rules: { "watch-mail": { baselineAt: "2026-08-01T00:00:00.000Z" } } },
    candidates: [fresh],
    trackedThreadIds: new Set(),
    labelMap: new Map([["Label_7", "callback"]]),
    now: new Date("2026-08-05T13:00:00.000Z"),
  });
  t.check({ trackRequests: stageResult.trackRequests, procedures: stageResult.procedures }, {
    trackRequests: [],
    procedures: [],
  });

  // doctest:L187
  t.check(stageResult.state, {
    rules: {
      "watch-mail": {
        baselineAt: "2026-08-01T00:00:00.000Z",
        pending: [
          {
            messageId: "new",
            threadId: "new-thread",
            from: "sender@example.com",
            subject: "New",
            date: "2026-08-01T15:00:00.000Z",
            snippet: "",
            labels: ["callback"],
            discoveredAt: "2026-08-05T13:00:00.000Z",
          },
        ],
        additionalMatches: 0,
      },
    },
  });

  // New mail on a thread the box already holds is still staged. `stage` records
  // whatever the eventual procedure would have seen — skipping tracked threads
  // (as `track` does) would drop that mail from the backlog for good.

  // doctest:L196
  const alreadyTracked = await evaluateGmailRules({
    service: gmail,
    config: stageConfig,
    state: { rules: { "watch-mail": { baselineAt: "2026-08-01T00:00:00.000Z" } } },
    candidates: [fresh],
    trackedThreadIds: new Set([fresh.threadId]),
    labelMap: new Map([["Label_7", "callback"]]),
    now: new Date("2026-08-05T13:00:00.000Z"),
  });
  t.check(alreadyTracked.state, {
    rules: {
      "watch-mail": {
        baselineAt: "2026-08-01T00:00:00.000Z",
        pending: [
          {
            messageId: "new",
            threadId: "new-thread",
            from: "sender@example.com",
            subject: "New",
            date: "2026-08-01T15:00:00.000Z",
            snippet: "",
            labels: ["callback"],
            discoveredAt: "2026-08-05T13:00:00.000Z",
          },
        ],
        additionalMatches: 0,
      },
    },
  });

  // Messages without a safe RFC Message-ID are reported as unevaluated instead of
  // being interpolated into Gmail's search syntax or silently treated as a miss.

  // doctest:L213
  const unsafe = await evaluateUnsafeMessage({ gmail, config: procedureConfig });
  t.check(unsafe, { queries: 0, unevaluatedThreadId: "unsafe-thread" });
});

// ## History discovery is bounded and resumable
//
// A single oversized history record is consumed across sync checkpoints rather
// than loaded all at once or truncated.
void test("A single oversized history record is consumed across sync checkpoints rather...", async (t) => {
  // doctest:L252
  const gmail = createFakeGoogleGmail();
  const refs = Array.from({ length: GMAIL_HISTORY_REF_LIMIT + 1 }, (_, index) => ({
    message: { id: `message-${index}`, threadId: `thread-${index}` },
  }));
  let requestedMaxResults: number | undefined;
  gmail.listHistory = async (opts) => {
    requestedMaxResults = opts.maxResults;
    return {
      history: [{ id: "2", messagesAdded: refs }],
      historyId: "2",
    };
  };
  const firstPage = await discoverGmailChanges({ service: gmail, startHistoryId: "1" });
  t.check({ ...firstPage, refs: firstPage.refs.map((ref) => ref.id), requestedMaxResults }, {
    refs: Array.from({ length: 500 }, (_, index) => `message-${index}`),
    historyId: "1",
    historyResume: { startHistoryId: "1", refOffset: 500 },
    historyExpired: false,
    requestedMaxResults: 100,
  });

  // doctest:L271
  const secondPage = await discoverGmailChanges({
    service: gmail,
    startHistoryId: firstPage.historyId,
    resume: firstPage.historyResume,
  });
  t.check({ ...secondPage, refs: secondPage.refs.map((ref) => ref.id) }, {
    refs: ["message-500"],
    historyId: "2",
    historyResume: undefined,
    historyExpired: false,
  });
});

// Legacy GC timestamps are discarded while owned state remains validated.
void test("Legacy GC timestamps are discarded while owned state remains validated.", async (t) => {
  // doctest:L286
  t.check(
    parseGmailTransientState({
      historyId: "42",
      lastReconcileAt: "2026-08-01T00:00:00.000Z",
    }),
    {
    historyId: "42",
  },
  );
});

// Explicit tracking and scheduled sync share one lock, so their state and card
// writes cannot overlap.
void test("Explicit tracking and scheduled sync share one lock, so their state and card...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L297
  const box = await makeTmpBox();
  const events: string[] = [];
  let releaseFirst!: () => void;
  const holdFirst = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let firstEntered!: () => void;
  const entered = new Promise<void>((resolve) => { firstEntered = resolve; });
  const first = withGmailTrackingLock({
    boxRoot: box.root,
    purpose: "first",
    action: async () => {
      events.push("first-start");
      firstEntered();
      await holdFirst;
      events.push("first-end");
    },
  });
  await entered;
  const second = withGmailTrackingLock({
    boxRoot: box.root,
    purpose: "second",
    action: async () => { events.push("second"); },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  t.check(events, [
    "first-start",
  ]);

  // doctest:L323
  releaseFirst();
  await Promise.all([first, second]);
  t.check(events, [
    "first-start",
    "first-end",
    "second",
  ]);
});

// ## The gws passthrough is remote-read-only
//
// The wrapper keeps upstream command names, but accepts only Gmail reads and
// introspection before it mints a token or starts the child process.
void test("The wrapper keeps upstream command names, but accepts only Gmail reads and in...", async (t) => {
  // doctest:L339
  t.check(assertReadOnlyGwsArgs(["gmail", "users", "messages", "list", "--params", '{"userId":"me"}']), undefined);
  t.check(assertReadOnlyGwsArgs(["gmail", "+read", "--id", "abc"]), undefined);
  t.check(assertReadOnlyGwsArgs(["schema", "gmail.users.threads.get"]), undefined);
});

void test("The gws passthrough is remote-read-only", async (t) => {
  // doctest:L347
  let rejected = "";
  try {
    assertReadOnlyGwsArgs(["gmail", "users", "messages", "modify"]);
  } catch (error) {
    rejected = errorMessage(error);
  };
  t.check(rejected, "Rejected non-read-only gws command: gmail users messages modify");
});

void test("The gws passthrough is remote-read-only (line 357)", async (t) => {
  // doctest:L358
  let nonGmail = "";
  try {
    assertReadOnlyGwsArgs(["drive", "files", "list"]);
  } catch (error) {
    nonGmail = errorMessage(error);
  };
  t.check(nonGmail, "Rejected non-read-only gws command: drive files list");
});

// ## A captured gws stream is bounded, and says so only when it dropped something
//
// The server runs `gws` on behalf of a delegating caller, so a command that prints
// a mailbox's worth of output must not become the box server's memory problem.
// What it must not do either is announce a truncation that never happened — output
// that fits comes back exactly as the child wrote it.
void test("The server runs gws on behalf of a delegating caller, so a command that print...", async (t) => {
  // doctest:L376
  const small = boundedCapture(100);
  small.add("one ");
  small.add("two");
  t.check(small.text(), "one two");

  // Past the limit the overflow is counted rather than kept, across however many
  // chunks the child's stream arrived in.

  // doctest:L387
  const tight = boundedCapture(5);
  tight.add("abcd");
  tight.add("efgh");
  t.check(tight.text(), "abcde\n…(3 further characters dropped)");
});
