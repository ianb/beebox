// # Question aging (nudge, then expire)
//
// `ageQuestions` (`src/core/question-aging.ts`) ages every pending question by
// its durable `asked-at`, never latch state: a re-notification ("nudge") fires
// once past the nudge threshold, and the question gets `expired-at` (via the
// shared guarded transition, same as `answer`/`dismiss`) past the expiry
// window. Both windows default to 30 days expire / 7 days nudge, or derive from
// a card's `expires-after` override (nudge at half). Expiry never depends on a
// notification channel being configured — only nudge *delivery* does.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, capture, isoDate, str } from "@ianbicking/tap-check/check";
import { boxSlug } from "../../src/lib/box-slug.js";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { execSync } from "node:child_process";
import {
  ageQuestions,
  DEFAULT_EXPIRE_AFTER_MS,
  DEFAULT_NUDGE_AFTER_MS,
} from "../../src/core/question-aging.js";
import { getSystemState } from "../../src/core/state.js";
import { generateContext } from "../../src/webapp/context.js";
import { addSubscription } from "../../src/core/push-subscriptions.js";
import { createFakePush } from "../../src/services/push.js";
import { readRecent } from "../../src/core/notification/log.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

const storeDir = path.join(os.tmpdir(), `bbx-qaging-${process.pid}-${Date.now()}`);
process.env.BBX_PUSH_STORE_DIR = storeDir;

const SUB = { endpoint: "https://push.example/qaging", keys: { p256dh: "p", auth: "a" } };

const ASKED_AT = new Date("2026-01-01T00:00:00Z");

function addMs(date: Date, ms: number) {
  return new Date(date.getTime() + ms);
}

function setTime(date: Date) {
  process.env.BBX_TIME = date.toISOString();
}

function question(opts: { prompt: string; askedAt?: string; expiresAfter?: string }) {
  const { prompt, askedAt, expiresAfter } = opts;
  const lines = ["---", `prompt: ${prompt}`, "input:", "  type: text"];
  if (askedAt !== undefined) lines.push(`asked-at: ${askedAt}`);
  if (expiresAfter !== undefined) lines.push(`expires-after: ${expiresAfter}`);
  lines.push("---", "");
  return lines.join("\n");
}

// Trailers on HEAD, one per line.
function headTrailers(root: string) {
  return execSync("git log -1 --format=%B", { cwd: root, stdio: "pipe" }).toString().trim();
}

// ## No nudge before the default 7-day threshold
void test("No nudge before the default 7-day threshold", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      delete process.env.BBX_TIME;
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await addSubscription({ boxSlug: await boxSlug(box.root), subscription: SUB, now: ASKED_AT });
  await box.write(
    "_bookkeeping/questions/Color.question.card",
    question({ prompt: "What color?", askedAt: ASKED_AT.toISOString() })
  );
  box.commitAll("seed question");

  setTime(addMs(ASKED_AT, DEFAULT_NUDGE_AFTER_MS - 60_000));
  const before = await ageQuestions(box.root);
  t.check(before, {
    nudged: [],
    expired: [],
  });

  // At the 7-day mark it nudges exactly once. The nudge is `quiet`, pushed to the
  // subscribed device, targets the question, and is in the notification log:

  setTime(addMs(ASKED_AT, DEFAULT_NUDGE_AFTER_MS));
  const push = createFakePush();
  const nudgedResult = await ageQuestions(box.root, { push });
  t.check(nudgedResult, {
    nudged: [
      "_bookkeeping/questions/Color.question.card",
    ],
    expired: [],
  });

  await t.checkText(push.describe(), `FakePush: 1 sent
  https://push.example/qaging → ⏰ Reminder: a question is waiting: What color?`);

  const [logged] = await readRecent(box.root, { days: 1 });
  const id = capture(any(String));
  t.check(logged?.intent, {
    kind: "intent",
    at: isoDate(),
    id,
    title: "⏰ Reminder: a question is waiting",
    body: "What color?",
    target: "question:_bookkeeping/questions/Color.question.card",
    loudness: "quiet",
    source: "question-nudge",
  });
  t.check(logged?.deliveries, [
    { kind: "delivery", at: isoDate(), notificationId: id.value, channel: "apns", status: "skipped", detail: "no-audience" },
    { kind: "delivery", at: isoDate(), notificationId: id.value, channel: "web-push", status: "sent" },
  ]);

  // A second sweep at the same age (or later, still under expiry) does not
  // re-nudge — the latch dedups it:

  setTime(addMs(ASKED_AT, DEFAULT_NUDGE_AFTER_MS + 60 * 60 * 1000));
  t.check(await ageQuestions(box.root), {
    nudged: [],
    expired: [],
  });

  // The question is still pending — nudging never sets `expired-at`:

  const card = await box.read("_bookkeeping/questions/Color.question.card");
  t.check(card, question({ prompt: "What color?", askedAt: ASKED_AT.toISOString() }));
});

// ## Expiry at the default 30-day window
//
// No push subscription exists here: expiry still runs, and only
// nudge delivery is gated on a channel.
void test("No push subscription exists here:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      delete process.env.BBX_TIME;
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await box.write(
    "_bookkeeping/questions/Stale.question.card",
    question({ prompt: "Still relevant?", askedAt: ASKED_AT.toISOString() })
  );
  box.commitAll("seed question");

  setTime(addMs(ASKED_AT, DEFAULT_EXPIRE_AFTER_MS));
  const result = await ageQuestions(box.root);
  t.check(result, {
    nudged: [],
    expired: [
      "_bookkeeping/questions/Stale.question.card",
    ],
  });

  const card = await box.read("_bookkeeping/questions/Stale.question.card");
  t.check(
    card,
    `---
type: question
prompt: Still relevant?
input:
  type: text
asked-at: 2026-01-01T00:00:00.000Z
expired-at: 2026-01-31T00:00:00.000Z
---
`,
  );

  // The commit carries the `Expired-By` trailer:

  t.check(headTrailers(box.root), "Expire question: Stale.question\n\nExpired-By: question-aging");

  // Expired questions drop out of the pending count and pending-questions list:

  const state = await getSystemState(box.root);
  t.check(state.questions, [
    {
      path: str`${any(String)}/_bookkeeping/questions/Stale.question.card`,
      relativePath: "_bookkeeping/questions/Stale.question.card",
      name: "Stale",
      type: "question",
      subdir: undefined,
      state: "expired",
    },
  ]);

  const { pendingQuestions } = await generateContext(box.root);
  t.check(pendingQuestions, []);
});

// ## `expires-after` override: nudge at half, expire at the full window
//
// A 10-day override nudges at 5 days (half), not the default 7:
void test("A 10-day override nudges at 5 days (half), not the default 7:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      delete process.env.BBX_TIME;
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await addSubscription({ boxSlug: await boxSlug(box.root), subscription: SUB, now: ASKED_AT });
  const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;
  await box.write(
    "_bookkeeping/questions/Deadline.question.card",
    question({ prompt: "Confirm by Friday?", askedAt: ASKED_AT.toISOString(), expiresAfter: "P10D" })
  );
  box.commitAll("seed question");

  setTime(addMs(ASKED_AT, TEN_DAYS_MS / 2 - 60_000));
  t.check(await ageQuestions(box.root), {
    nudged: [],
    expired: [],
  });

  // The fake push stands in for the server's keys: a nudge whose web push is
  // skipped `unconfigured` is not sent, so it is not latched (Track A of
  // docs/plans/on-demand-job-triggers.md).

  setTime(addMs(ASKED_AT, TEN_DAYS_MS / 2));
  t.check(await ageQuestions(box.root, { push: createFakePush() }), {
    nudged: [
      "_bookkeeping/questions/Deadline.question.card",
    ],
    expired: [],
  });

  // Past the full 10-day override window it expires (not the 30-day default):

  setTime(addMs(ASKED_AT, TEN_DAYS_MS));
  t.check(await ageQuestions(box.root), {
    nudged: [],
    expired: [
      "_bookkeeping/questions/Deadline.question.card",
    ],
  });
});

// ## Missing `asked-at` warns and skips, never crashes
//
// A pending question with no `asked-at` (shouldn't exist post-migration, but
// the sweep degrades loudly rather than throwing):
void test("A pending question with no asked-at (shouldn't exist post-migration, but the...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      delete process.env.BBX_TIME;
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await box.write(
    "_bookkeeping/questions/NoAskedAt.question.card",
    "---\nprompt: When was this asked?\ninput:\n  type: text\n---\n"
  );
  box.commitAll("seed question");

  setTime(addMs(ASKED_AT, DEFAULT_EXPIRE_AFTER_MS));
  t.check(await ageQuestions(box.root), {
    nudged: [],
    expired: [],
  });

  const card = await box.read("_bookkeeping/questions/NoAskedAt.question.card");
  t.check(card, "---\nprompt: When was this asked?\ninput:\n  type: text\n---\n");
});

// ## Race-loser: already-answered questions are simply not pending
//
// The shared `withQuestionTransition` primitive (`question-transition.ts`)
// re-checks state after acquiring both locks and skips silently when it's no
// longer in the allowed set — that's exercised directly by the `answer`/
// `dismiss` tests' "already answered" cases. A true cross-process race
// between the sweep and a simultaneous answer can't be manufactured in a
// single-process sequential test without invasive mocking of the transition
// internals; the observable case here is the simpler one: a question answered
// before the sweep runs never appears in its pending scan at all, so it's
// untouched.
void test("The shared withQuestionTransition primitive (question-transition.ts) re-check...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      delete process.env.BBX_TIME;
      await fs.rm(storeDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await box.write(
    "_bookkeeping/questions/AlreadyAnswered.question.card",
    question({ prompt: "Still open?", askedAt: ASKED_AT.toISOString() })
      .replace("---\n", "---\nanswered-at: 2026-01-02T00:00:00Z\nanswer:\n  text: Yes\n"),
  );
  box.commitAll("seed question");

  setTime(addMs(ASKED_AT, DEFAULT_EXPIRE_AFTER_MS));
  t.check(await ageQuestions(box.root), {
    nudged: [],
    expired: [],
  });

  const card = await box.read("_bookkeeping/questions/AlreadyAnswered.question.card");
  t.check(
    card,
    question({ prompt: "Still open?", askedAt: ASKED_AT.toISOString() }).replace(
      "---\n",
      "---\nanswered-at: 2026-01-02T00:00:00Z\nanswer:\n  text: Yes\n",
    ),
  );
});
