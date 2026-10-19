// # Question follow-up job schema
//
// Created by the answer command when a question is answered — carries the
// directive, the answer, and (when the question declared one) the `learning`
// passthrough so the follow-up agent doesn't need to re-read the question
// card's frontmatter shape. See `test/schemas/question.test.ts` for the
// question card itself and `docs/implemented-plans/questions-end-to-end.md` for the
// two-product contract.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  QuestionFollowupJobSchema,
  createQuestionFollowupJobTemplate,
} from "../../src/schemas/question-followup-job.js";

// ## `learning` is an optional passthrough, same shape as the question's
void test("`learning` is an optional passthrough, same shape as the question's", async (t) => {
  const accepts = (extra: Record<string, unknown>) => QuestionFollowupJobSchema.frontmatterSchema.safeParse({
    type: "question-followup-job",
    source: "question-answer",
    description: "Follow up",
    "question-ref": { ref: "_bookkeeping/questions/X.question.card" },
    directive: "Do the thing",
    answer: "yes",
    ...extra,
  }).success;

  t.check(accepts({}), true);

  t.check(accepts({ learning: { sink: "guide", proposal: "Items like this belong in category A." } }), true);

  t.check(accepts({ learning: { sink: "guide" } }), false);
});

// ## Template without `learning`
void test("Template without `learning`", async (t) => {
  await t.checkText(
    createQuestionFollowupJobTemplate({
      description: "Follow up on answered question: What color?",
      questionRef: "_bookkeeping/questions/X.question.card",
      directive: "File it.",
      answer: "blue",
    }),
    `---
description: "Follow up on answered question: What color?"
question-ref:
  ref: _bookkeeping/questions/X.question.card
directive: File it.
answer: blue
---`,
  );
});

// ## Template with `learning`
void test("Template with `learning`", async (t) => {
  await t.checkText(
    createQuestionFollowupJobTemplate({
      description: "Follow up on answered question: What color?",
      questionRef: "_bookkeeping/questions/X.question.card",
      directive: "File it.",
      answer: "blue",
      learning: { sink: "guide", proposal: "Items like this belong in category A." },
    }),
    `---
description: "Follow up on answered question: What color?"
question-ref:
  ref: _bookkeeping/questions/X.question.card
directive: File it.
answer: blue
learning:
  sink: guide
  proposal: Items like this belong in category A.
---`,
  );
});
