// # `bbx engine question-review check`
//
// `check` loads the box's questions, prints a brief for those that qualify, and
// saves the list in `.beebox/reviewed-questions.json` for `verify`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { checkQuestionReview } from "../../../../src/core/question-review/check/core.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";

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

// ## check lists the qualifying questions and saves the list
void test("check lists the qualifying questions and saves the list", async (t) => {
  const box = await reviewBox();
  t.teardown(async () => { await box.cleanup(); });
  const { warn } = console;
  console.warn = () => {};
  t.teardown(() => { console.warn = warn; });

  const result = await checkQuestionReview(box.root);
  t.check(result, {
    kind: "review",
    brief: any(String).matches(/- path: _bookkeeping\/questions\/Away\.question\.card\n {2}state: dismissed\n {2}prompt: Which folder\?\n {2}how_long: put away \d+ days ago/),
    questions: [
      { path: `${DIR}/Away.question.card`, prompt: "Which folder?", state: "dismissed", since: LONG_AGO, waitedMs: any(Number) },
      { path: `${DIR}/Waiting.question.card`, prompt: "Which folder?", state: "pending", since: LONG_AGO, waitedMs: any(Number) },
    ],
  });
  t.check(JSON.parse(await box.read(LATCH)), {
    reviewed: {},
    listed: [`${DIR}/Away.question.card`, `${DIR}/Waiting.question.card`].toSorted(),
  });
});

// ## check finds nothing in a box with no qualifying question
void test("check finds nothing in a box with no qualifying question", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(async () => { await box.cleanup(); });
  await box.write(`${DIR}/Fresh.question.card`, question(`asked-at: ${new Date().toISOString()}\n`));

  t.check(await checkQuestionReview(box.root), { kind: "nothing" });
});
