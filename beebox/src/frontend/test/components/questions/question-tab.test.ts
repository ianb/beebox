// # Closing a question's tab
//
// Closing the tab of a pending question is "Not now": it dismisses the card
// (docs/plans/questions-beside-the-chat.md, Track B). Any other card, and a
// question that is answered, dismissed, expired, or unparseable, closes like
// any tab.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { dismissesOnClose } from "../../../src/components/questions/question-tab.js";
import type { QuestionInfo } from "../../../src/components/questions/QuestionForm/view.js";

function question(name: string, over: Partial<QuestionInfo>): QuestionInfo {
  const relativePath = `_bookkeeping/questions/${name}.question.card`;
  return { path: `/box/${relativePath}`, relativePath, name, type: "question", subdir: undefined, state: "pending", prompt: "Which?", inputType: "text", ...over };
}

void test("Only a pending question's close dismisses it", async (t) => {
  const items = [
    question("Open", {}),
    question("Done", { state: "answered" }),
    question("Later", { state: "dismissed" }),
    question("Broken", { invalid: true }),
  ];
  const at = (name: string) => `_bookkeeping/questions/${name}.question.card`;
  t.check({
    pending: dismissesOnClose(at("Open"), items),
    answered: dismissesOnClose(at("Done"), items),
    dismissed: dismissesOnClose(at("Later"), items),
    invalid: dismissesOnClose(at("Broken"), items),
    unlisted: dismissesOnClose(at("Gone"), items),
    otherCard: dismissesOnClose("_content/Box.landmark.card", items),
  }, { pending: true, answered: false, dismissed: false, invalid: false, unlisted: false, otherCard: false });
});
