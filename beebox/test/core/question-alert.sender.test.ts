// # Question nudge and alert latch only what was sent
//
// `bbx finalize` sends the question nudge (`question-aging.ts`) and the
// question alert (`question-alert.ts`) through a `NotifySender`, the box server
// from a tooling child. A send that throws, comes back `failed`, or is skipped
// `unconfigured` leaves no latch entry, so the next finalize sends again; a
// send skipped `no-audience` everywhere is latched (nobody to reach). See
// docs/plans/on-demand-job-triggers.md, Track A.

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { checkPendingQuestionsAndNotify, loadQuestionLatch } from "../../src/core/question-alert.js";
import { ageQuestions, DEFAULT_NUDGE_AFTER_MS } from "../../src/core/question-aging.js";
import type { NotifySender } from "../../src/core/notify-boxholder.js";
import type { Delivery } from "../../src/core/notification/intent.js";

const ASKED_AT = new Date("2026-01-01T00:00:00Z");
const NUDGE_AT = new Date(ASKED_AT.getTime() + DEFAULT_NUDGE_AFTER_MS);
const QUESTION = "_bookkeeping/questions/Color.question.card";
const CARD = `---\nprompt: What color?\ninput:\n  type: text\nasked-at: ${ASKED_AT.toISOString()}\n---\n`;

type Outcome = "throws" | Delivery[];

const OUTCOMES: Record<string, Outcome> = {
  throws: "throws",
  failed: [{ channel: "web-push", status: "failed", detail: "boom" }],
  unconfigured: [
    { channel: "apns", status: "skipped", detail: "no-audience" },
    { channel: "web-push", status: "skipped", detail: "unconfigured" },
  ],
};
const NO_AUDIENCE: Delivery[] = [
  { channel: "apns", status: "skipped", detail: "no-audience" },
  { channel: "web-push", status: "skipped", detail: "no-audience" },
];

/** A sender that answers every send with `outcome` and records each send's source. */
function fakeSender(outcome: Outcome): NotifySender & { sends: string[] } {
  const sends: string[] = [];
  return {
    sends,
    send: ({ intent }) => {
      sends.push(intent.source);
      if (outcome === "throws") return Promise.reject(new Error("The box's server could not be reached"));
      return Promise.resolve({ id: "n1", deliveries: outcome, shown: false });
    },
  };
}

async function questionBox() {
  const box = await makeTmpBox({ git: true });
  await box.write(QUESTION, CARD);
  box.commitAll("seed question");
  return box;
}

function quiet(t: Test): string[] {
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (line: string) => warnings.push(line);
  t.teardown(() => {
    console.warn = warn;
  });
  return warnings;
}

void test("An alert that did not go out is not latched", async (t) => {
  const box = await questionBox();
  t.teardown(() => box.cleanup());
  const warnings = quiet(t);

  // Each failing sender is called twice: the first sweep latched nothing, so
  // the second announces the question again.
  const seen: Record<string, unknown> = {};
  for (const [name, outcome] of Object.entries(OUTCOMES)) {
    const sender = fakeSender(outcome);
    const now = new Date();
    const first = await checkPendingQuestionsAndNotify(box.root, { now, sender });
    const second = await checkPendingQuestionsAndNotify(box.root, { now, sender });
    seen[name] = { first, second, sends: sender.sends, latch: (await loadQuestionLatch(box.root)).paths };
  }
  const notLatched = { first: null, second: null, sends: ["question-alert", "question-alert"], latch: [] };
  t.check(seen, { throws: notLatched, failed: notLatched, unconfigured: notLatched });
  t.check(warnings.slice(0, 2), [
    "Question alert for 1 question(s) not sent: The box's server could not be reached",
    "Question alert for 1 question(s) not sent: The box's server could not be reached",
  ]);

  // Nobody to reach is sent: latched, and the next sweep is quiet.
  const sender = fakeSender(NO_AUDIENCE);
  t.check(await checkPendingQuestionsAndNotify(box.root, { now: new Date(), sender }), { notified: [QUESTION] });
  t.check(await checkPendingQuestionsAndNotify(box.root, { now: new Date(), sender }), null);
  t.check({ sends: sender.sends, latch: (await loadQuestionLatch(box.root)).paths }, { sends: ["question-alert"], latch: [QUESTION] });
});

void test("A nudge that did not go out is not latched", async (t) => {
  const box = await questionBox();
  process.env.BBX_TIME = NUDGE_AT.toISOString();
  t.teardown(async () => {
    delete process.env.BBX_TIME;
    await box.cleanup();
  });
  const warnings = quiet(t);

  const seen: Record<string, unknown> = {};
  for (const [name, outcome] of Object.entries(OUTCOMES)) {
    const sender = fakeSender(outcome);
    const first = await ageQuestions(box.root, { sender });
    const second = await ageQuestions(box.root, { sender });
    seen[name] = { first: first.nudged, second: second.nudged, sends: sender.sends, nudged: (await loadQuestionLatch(box.root)).nudged };
  }
  const notLatched = { first: [], second: [], sends: ["question-nudge", "question-nudge"], nudged: {} };
  t.check(seen, { throws: notLatched, failed: notLatched, unconfigured: notLatched });
  t.check(warnings.slice(2, 4), [
    `Question nudge for ${QUESTION} not sent: web-push failed (boom)`,
    `Question nudge for ${QUESTION} not sent: web-push failed (boom)`,
  ]);

  const sender = fakeSender(NO_AUDIENCE);
  t.check((await ageQuestions(box.root, { sender })).nudged, [QUESTION]);
  t.check((await ageQuestions(box.root, { sender })).nudged, []);
  t.check({ sends: sender.sends, nudged: (await loadQuestionLatch(box.root)).nudged }, {
    sends: ["question-nudge"],
    nudged: { [QUESTION]: NUDGE_AT.toISOString() },
  });
});
