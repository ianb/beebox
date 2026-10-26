// # A select question's choices as a spoken line
//
// Beside the chat the person answers in words, so the card lists a select
// question's choices in a sentence ending (docs/implemented-plans/questions-later-and-figure-it-out.md,
// Track A); past six, the line says how many more.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { optionsLine } from "../../../../src/components/questions/QuestionBeside/options-line.js";

void test("Choices read as a sentence ending", async (t) => {
  t.check({
    none: optionsLine(undefined),
    empty: optionsLine([]),
    two: optionsLine(["Finance", "Personal"]),
    three: optionsLine(["Finance", "Personal", "Taxes"]),
    eight: optionsLine(["A", "B", "C", "D", "E", "F", "G", "H"]),
  }, {
    none: null,
    empty: null,
    two: "Finance or Personal?",
    three: "Finance, Personal, or Taxes?",
    eight: "A, B, C, D, E, F, or one of 2 more?",
  });
});
