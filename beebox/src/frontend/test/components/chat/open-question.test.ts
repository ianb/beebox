// # Which pending question the empty root chat asks
//
// `pickOpenQuestion` chooses the newest pending question by `asked-at`, then by
// path, and counts the others (docs/implemented-plans/front-door.md, Track A). A pending
// card that failed to parse has no prompt to ask: it is never chosen, but it
// counts, so "and N more" still reaches it on the Questions page. Answered,
// dismissed, and expired cards take no part. `openQuestionLine` lists a select
// question's options in the sentence; text and confirm prompts read as written.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { composerPlaceholder, moreQuestionsLabel, openQuestionLine, pickOpenQuestion } from "../../../src/components/chat/open-question.js";
import type { QuestionInfo } from "../../../src/components/questions/QuestionForm.js";

const DIR = "_bookkeeping/questions";
function card(name: string, extra: Partial<QuestionInfo>): QuestionInfo {
  return { path: `/box/${DIR}/${name}.question.card`, relativePath: `${DIR}/${name}.question.card`, name, type: "question", subdir: undefined, state: "pending", prompt: `${name}?`, inputType: "text", ...extra };
}

// The filenames sort opposite to their `asked-at`: `A` is the newest ask with
// the earliest name, so the choice is by time, not by name. The invalid pending
// card and the answered card are not chosen; only the invalid one is counted.
void test("The newest pending question by asked-at is chosen; invalid pending cards only count", async (t) => {
  const items = [
    card("A", { askedAt: "2026-10-20T10:00:00Z", memo: "Why I ask." }),
    card("B", { askedAt: "2026-10-19T10:00:00Z" }),
    card("Broken", { invalid: true, prompt: undefined, inputType: undefined, state: undefined }),
    card("Done", { state: "answered", askedAt: "2026-10-21T10:00:00Z" }),
  ];
  t.check(pickOpenQuestion(items), {
    path: `${DIR}/A.question.card`,
    prompt: "A?",
    memo: "Why I ask.",
    inputType: "text",
    options: [],
    optionsBeyond: 0,
    more: 2,
  });
  // Without asked-at, the later path wins, and a blank memo is no memo.
  t.check(pickOpenQuestion([card("A", { memo: "  " }), card("B", {})])?.path, `${DIR}/B.question.card`);
  t.check(pickOpenQuestion([card("A", { memo: "  " })])?.memo, null);
  // Nothing pending, or only a broken pending card: nothing to ask.
  t.check(pickOpenQuestion([card("Done", { state: "answered" })]), null);
  t.check(pickOpenQuestion([card("Broken", { invalid: true, prompt: undefined })]), null);
  // Past six options the line keeps six and says how many more the Questions page holds.
  const many = pickOpenQuestion([card("Pick", { inputType: "select", options: ["A", "B", "C", "D", "E", "F", "G", "H"] })]);
  t.check({ options: many?.options, beyond: many?.optionsBeyond }, { options: ["A", "B", "C", "D", "E", "F"], beyond: 2 });
});

void test("A select question lists its options in the line; the count reads 'and N more'", async (t) => {
  t.check({
    select: openQuestionLine({ prompt: "Where do receipts go?", inputType: "select", options: ["Finance", "Personal", "Taxes"], optionsBeyond: 0 }),
    two: openQuestionLine({ prompt: "Where do receipts go?", inputType: "select", options: ["Finance", "Personal"], optionsBeyond: 0 }),
    one: openQuestionLine({ prompt: "Where do receipts go?", inputType: "select", options: ["Finance"], optionsBeyond: 0 }),
    many: openQuestionLine({ prompt: "Which room?", inputType: "select", options: ["A", "B", "C", "D", "E", "F"], optionsBeyond: 2 }),
    text: openQuestionLine({ prompt: "What do you want to keep track of here?", inputType: "text", options: [], optionsBeyond: 0 }),
    confirm: openQuestionLine({ prompt: "Is the stove back?", inputType: "confirm", options: [], optionsBeyond: 0 }),
    none: moreQuestionsLabel(0),
    some: moreQuestionsLabel(38),
  }, {
    select: "Where do receipts go? Finance, Personal, or Taxes?",
    two: "Where do receipts go? Finance or Personal?",
    one: "Where do receipts go? Finance?",
    many: "Which room? A, B, C, D, E, F, or one of 2 more?",
    text: "What do you want to keep track of here?",
    confirm: "Is the stove back?",
    none: null,
    some: "and 38 more",
  });
});

// ## The composer asks the question only while the chat is empty
//
// A tab stays `unstarted` while it holds its reservation receipt, so the chat
// can have a sent message and still carry the open question. The placeholder
// follows the same guard as the openers: no messages and nothing streaming.
void test("The composer placeholder is the prompt only before the first message", async (t) => {
  const openQuestion = pickOpenQuestion([card("A", { askedAt: "2026-10-20T10:00:00Z", prompt: "What do you want to keep track of here?" })]);
  t.check({
    empty: composerPlaceholder({ openQuestion, messageCount: 0, isStreaming: false }),
    oneMessage: composerPlaceholder({ openQuestion, messageCount: 1, isStreaming: false }),
    streaming: composerPlaceholder({ openQuestion, messageCount: 0, isStreaming: true }),
    noQuestion: composerPlaceholder({ openQuestion: null, messageCount: 0, isStreaming: false }),
  }, {
    empty: "What do you want to keep track of here?",
    oneMessage: undefined,
    streaming: undefined,
    noQuestion: undefined,
  });
});
