// # Question alerts (finalize-time sweep)
//
// `checkPendingQuestionsAndNotify` diffs the box's currently-pending questions
// against a per-box latch and notifies the boxholder about newly-pending ones —
// no per-producer hook, just a sweep. Each question notifies once while it stays
// pending. A new question is a `dot` (a badge on the phone); a question
// carrying `urgency: time-bound` makes the sweep `quiet`, which a subscribed
// browser receives.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { boxSlug } from "../../src/lib/box-slug.js";
import { strict as assert } from "node:assert";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { makeTmpBox, type TmpBox } from "../helpers/test-helpers.js";
import { checkPendingQuestionsAndNotify, loadQuestionLatch } from "../../src/core/question-alert.js";
import { addSubscription } from "../../src/core/push-subscriptions.js";
import { createFakePush } from "../../src/services/push.js";
import { readRecent } from "../../src/core/notification/log.js";

const storeDir = path.join(os.tmpdir(), `bbx-qalert-${process.pid}-${Date.now()}`);
process.env.BBX_PUSH_STORE_DIR = storeDir;

const NOW = new Date("2026-06-29T12:00:00Z");
const SUB = { endpoint: "https://push.example/d1", keys: { p256dh: "p", auth: "a" } };

function question(prompt: string, urgency?: string) {
  const extra = urgency === undefined ? "" : `urgency: ${urgency}\n`;
  return `---\nprompt: ${prompt}\ninput:\n  type: text\n${extra}---\n`;
}

// The newest logged intent: its loudness, target, and each delivery.
async function lastLogged(box: TmpBox) {
  const n = (await readRecent(box.root, { days: 1, now: NOW })).at(-1);
  assert.ok(n);
  const deliveries = n.deliveries.map((d) => `${d.channel} ${d.status}${d.detail ? `: ${d.detail}` : ""}`);
  return [`${n.intent.loudness} → ${n.intent.target}`, ...deliveries].join("\n");
}


// ## A newly-pending question notifies once, then latches
void test("A newly-pending question notifies once, then latches", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      await fs.rm(storeDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await addSubscription({ boxSlug: await boxSlug(box.root), subscription: SUB, now: NOW });
  await box.seed("_bookkeeping/questions/Color.question.card", question("What color?"));
  box.commitAll("seed question");

  const push = createFakePush();
  const first = await checkPendingQuestionsAndNotify(box.root, { now: NOW, push });
  t.check(first?.notified, [
    "_bookkeeping/questions/Color.question.card",
  ]);

  // It is a `dot` targeting the question card. A dot goes to paired phones only,
  // and this box has none, so the subscribed browser gets nothing:

  await t.checkText(await lastLogged(box), `dot → question:_bookkeeping/questions/Color.question.card
apns skipped: no-audience`);

  t.check(push.sent, []);

  // A second sweep finds nothing new (the question is latched):

  t.check(await checkPendingQuestionsAndNotify(box.root, { now: NOW, push }), null);

  // ## A second question notifies only the new one

  await box.seed("_bookkeeping/questions/Size.question.card", question("What size?"));
  const third = await checkPendingQuestionsAndNotify(box.root, { now: NOW, push });
  t.check(third?.notified, [
    "_bookkeeping/questions/Size.question.card",
  ]);

  // ## A time-bound question is `quiet`
  //
  // A question that blocks something with a date sends a muted notification, so
  // the subscribed browser receives it, deep-linked to the card:

  await box.seed("_bookkeeping/questions/Form.question.card", question("Sign the form by Friday?", "time-bound"));
  await checkPendingQuestionsAndNotify(box.root, { now: NOW, push });
  await t.checkText(await lastLogged(box), `quiet → question:_bookkeeping/questions/Form.question.card
apns skipped: no-audience
web-push sent`);

  const slug = await boxSlug(box.root);
  t.check(push.sent, [
    {
      endpoint: "https://push.example/d1",
      payload: {
        icon: `${slug}/icon-192.png`,
        title: "❓ A question needs an answer",
        body: "- Sign the form by Friday?",
        url: `/${slug}/browse/_bookkeeping/questions/Form.question.card`,
        tag: undefined,
        silent: true,
      },
    },
  ]);
});

// ## Nobody to reach is latched; missing keys are not
//
// With no paired phone and no subscribed browser, the sweep still sends: every
// channel is skipped `no-audience`, which counts as sent (a retry cannot reach
// anyone), so the question is latched and not announced again. A subscribed
// browser with no VAPID keys in the sending process is skipped `unconfigured`:
// not sent, so the question stays out of the latch for the next finalize.
void test("Nobody to reach is latched; missing keys are not", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(async () => {
    await box.cleanup();
    await fs.rm(storeDir, { recursive: true, force: true });
  });
  for (const name of ["BBX_VAPID_PUBLIC_KEY", "BBX_VAPID_PRIVATE_KEY", "BBX_NOTIFY_FAKE", "BBX_PUSH_FAKE"]) delete process.env[name];
  await box.seed("_bookkeeping/questions/Color.question.card", question("What color?"));
  box.commitAll("seed");

  const nobody = await checkPendingQuestionsAndNotify(box.root, { now: NOW });
  const again = await checkPendingQuestionsAndNotify(box.root, { now: NOW });
  const nobodyLog = await lastLogged(box);

  // Now a browser subscribes, and a time-bound question (a `quiet` one, which
  // web push carries) arrives while this process has no keys.
  await addSubscription({ boxSlug: await boxSlug(box.root), subscription: SUB, now: NOW });
  await box.seed("_bookkeeping/questions/Form.question.card", question("Sign the form by Friday?", "time-bound"));
  const warn = console.warn;
  const warnings: string[] = [];
  console.warn = (line: string) => warnings.push(line);
  let unconfigured;
  try {
    unconfigured = await checkPendingQuestionsAndNotify(box.root, { now: NOW });
  } finally {
    console.warn = warn;
  }
  t.check({ nobody, again, nobodyLog, unconfigured, warnings, latch: (await loadQuestionLatch(box.root)).paths }, {
    nobody: { notified: ["_bookkeeping/questions/Color.question.card"] },
    again: null,
    nobodyLog: `dot → question:_bookkeeping/questions/Color.question.card
apns skipped: no-audience`,
    unconfigured: null,
    warnings: ["Question alert for 1 question(s) not sent: apns skipped (no-audience), web-push skipped (unconfigured)"],
    latch: ["_bookkeeping/questions/Color.question.card"],
  });
});
