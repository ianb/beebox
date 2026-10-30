// # `bbx engine question-review verify`
//
// `verify` fails for a listed question still put away without a decision, and
// latches the rest so they are not taken up again for 14 days.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate } from "@ianbicking/tap-check/check";
import { checkQuestionReview } from "../../../src/core/question-review/check/core.js";
import { verifyQuestionReview } from "../../../src/core/question-review/verify.js";
import { executeQuestionDecide } from "../../../src/core/commands/question-decide.js";
import { executeQuestionReraise } from "../../../src/core/commands/question-reraise.js";
import { createCollectorContext } from "../../../src/core/command-runner.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

const DIR = "_bookkeeping/questions";
const LATCH = ".beebox/reviewed-questions.json";

function question(extra: string): string {
  return `---\nprompt: Which folder?\ninput:\n  type: text\n${extra}---\n`;
}

const LONG_AGO = "2026-01-01T09:00:00-07:00";

async function reviewBox() {
  const box = await makeTmpBox({ git: true });
  await box.write(`${DIR}/Away.question.card`, question(`asked-at: ${LONG_AGO}\ndismissed-at: ${LONG_AGO}\n`));
  await box.write(`${DIR}/Waiting.question.card`, question(`asked-at: ${LONG_AGO}\n`));
  await box.write(`${DIR}/Fresh.question.card`, question(`asked-at: ${new Date().toISOString()}\n`));
  await box.write(`${DIR}/Answered.question.card`, question(`asked-at: ${LONG_AGO}\nanswered-at: ${LONG_AGO}\nanswer:\n  text: x\n`));
  await box.write(`${DIR}/Broken.question.card`, "---\nprompt: [\n---\n");
  return box;
}

// ## verify fails for a question left put away, and does not latch it
void test("verify fails for a question left put away, and does not latch it", async (t) => {
  const box = await reviewBox();
  t.teardown(async () => { await box.cleanup(); });
  const { warn } = console;
  console.warn = () => {};
  t.teardown(() => { console.warn = warn; });
  await checkQuestionReview(box.root);

  const result = await verifyQuestionReview(box.root);
  t.check(result, {
    unsettled: [{ path: `${DIR}/Away.question.card`, reason: any(String) }],
    settledCount: 1,
  });
  t.check(JSON.parse(await box.read(LATCH)).reviewed, { [`${DIR}/Waiting.question.card`]: isoDate() });

  // Tomorrow's check still lists the left question; the latched one waits out its window.
  t.check(await checkQuestionReview(box.root), {
    kind: "review",
    brief: any(String),
    questions: [{ path: `${DIR}/Away.question.card`, prompt: "Which folder?", state: "dismissed", since: LONG_AGO, waitedMs: any(Number) }],
  });
});

// ## verify passes once the put-away question is decided or asked again
void test("verify passes once the put-away question is decided or asked again", async (t) => {
  const box = await reviewBox();
  t.teardown(async () => { await box.cleanup(); });
  const { warn } = console;
  console.warn = () => {};
  t.teardown(() => { console.warn = warn; });
  await box.write(`${DIR}/Away2.question.card`, question(`asked-at: ${LONG_AGO}\ndismissed-at: ${LONG_AGO}\n`));
  await checkQuestionReview(box.root);

  const { ctx } = createCollectorContext(box.root);
  t.check(
    await executeQuestionDecide(ctx, { question: `${DIR}/Away.question.card`, decision: "d", reasoning: "r", undo: "u" }),
    { success: true, data: { path: `${DIR}/Away.question.card` } },
  );
  t.check(
    await executeQuestionReraise(ctx, { question: `${DIR}/Away2.question.card` }),
    { success: true, data: { path: `${DIR}/Away2.question.card` } },
  );

  t.check(await verifyQuestionReview(box.root), { unsettled: [], settledCount: 3 });
  t.check(JSON.parse(await box.read(LATCH)).reviewed, {
    [`${DIR}/Away.question.card`]: isoDate(),
    [`${DIR}/Away2.question.card`]: isoDate(),
    [`${DIR}/Waiting.question.card`]: isoDate(),
  });
});
