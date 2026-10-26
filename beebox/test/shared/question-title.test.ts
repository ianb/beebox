// # A question card's title from its prompt
//
// A question with no `title:` is named by the first sentence of its prompt,
// cut at a word to fit a tab, so an untitled card reads as its question and
// not its filename (docs/implemented-plans/questions-later-and-figure-it-out.md). The
// schema's `summarize` (tabs, listings) and the frontend's `cardTitle` (the
// card's heading) both use it.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { questionTitle } from "../../src/shared/question-title.js";
import { cardTitle } from "../../src/core/loader-registry.js";
import { QuestionSchema } from "../../src/schemas/question.js";

void test("The first sentence, cut at a word past sixty characters", async (t) => {
  t.check({
    short: questionTitle("Which folder should this receipt go in?"),
    firstSentence: questionTitle("Review photo-003: confirm description and back-of-photo text are accurate. Photo 3 needs review."),
    long: questionTitle("Should I note in the box briefing that you regularly brain-dump mixed items in one message?"),
    spaces: questionTitle("  What do you\n want to keep track of here?  "),
  }, {
    short: "Which folder should this receipt go in?",
    firstSentence: "Review photo-003: confirm description and back-of-photo…",
    long: "Should I note in the box briefing that you regularly…",
    spaces: "What do you want to keep track of here?",
  });
});

// A card's own `title:` wins; without one the prompt names it, not the filename.
void test("A question card is titled by its title, else its prompt", async (t) => {
  const fields = { type: "question", prompt: "Where does the hinge receipt belong?", input: { type: "text" } };
  const input = (extra: Record<string, unknown>) => ({ path: "/box/_bookkeeping/questions/Triage_x.question.card", relativePath: "_bookkeeping/questions/Triage_x.question.card", name: "Triage_x", type: "question", fields: { ...fields, ...extra } });
  t.check({
    titled: cardTitle(input({ title: "Hinge receipt folder" }), QuestionSchema),
    untitled: cardTitle(input({}), QuestionSchema),
  }, {
    titled: "Hinge receipt folder",
    untitled: "Where does the hinge receipt belong?",
  });
});
