// # Closing a question's tab
//
// Closing the tab of a pending question is "Not now": it dismisses the card
// (docs/implemented-plans/questions-beside-the-chat.md, Track B). Any other card, and a
// question that is answered, dismissed, expired, or unparseable, closes like
// any tab.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { dismissesOnClose, pickArrivalQuestion } from "../../../src/components/questions/question-close.js";
import { questionToggle } from "../../../src/components/questions/question-tab.js";
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

// ## The question counter in a chat
//
// It puts away the pending question in front (hiding, not Later: it stays
// pending), else brings the newest pending question beside the chat, else
// opens the Questions page (docs/implemented-plans/questions-later-and-figure-it-out.md,
// Track B).
void test("The question counter hides the question in front, else shows the newest", async (t) => {
  const at = (name: string) => `_bookkeeping/questions/${name}.question.card`;
  const items = [
    question("Old", { askedAt: "2026-10-01T00:00:00Z" }),
    question("New", { askedAt: "2026-10-20T00:00:00Z" }),
    question("Done", { state: "answered", askedAt: "2026-10-25T00:00:00Z" }),
  ];
  t.check({
    inFront: questionToggle(at("Old"), items),
    answeredInFront: questionToggle(at("Done"), items),
    otherCard: questionToggle("_content/Box.landmark.card", items),
    nothing: questionToggle(null, items),
    nonePending: questionToggle(null, [items[2]].filter((q) => q !== undefined)),
  }, {
    inFront: { kind: "hide", path: at("Old") },
    answeredInFront: { kind: "open", path: at("New") },
    otherCard: { kind: "open", path: at("New") },
    nothing: { kind: "open", path: at("New") },
    nonePending: { kind: "page" },
  });
});

function arrivalQuestion(over: Partial<QuestionInfo> & Pick<QuestionInfo, "relativePath">): QuestionInfo {
  const name = over.relativePath.split("/").at(-1) ?? "";
  return { path: `/box/${over.relativePath}`, name, type: "question", subdir: undefined, state: "pending", prompt: "Which?", inputType: "text", ...over };
}

// ## The newest pending question is picked
//
// Newest by `asked-at`, then by path; answered, dismissed, and unparseable
// cards are never picked, and a card with no `asked-at` sorts oldest.
void test("The newest pending question is picked", async (t) => {
  t.check({
    newest: pickArrivalQuestion([
      arrivalQuestion({ relativePath: "_bookkeeping/questions/z-old.question.card", askedAt: "2026-09-01T00:00:00Z" }),
      arrivalQuestion({ relativePath: "_bookkeeping/questions/a-new.question.card", askedAt: "2026-10-20T00:00:00Z" }),
      arrivalQuestion({ relativePath: "_bookkeeping/questions/undated.question.card" }),
    ]),
    skipped: pickArrivalQuestion([
      arrivalQuestion({ relativePath: "_bookkeeping/questions/answered.question.card", askedAt: "2026-10-24T00:00:00Z", state: "answered" }),
      arrivalQuestion({ relativePath: "_bookkeeping/questions/dismissed.question.card", askedAt: "2026-10-23T00:00:00Z", state: "dismissed" }),
      arrivalQuestion({ relativePath: "_bookkeeping/questions/broken.question.card", askedAt: "2026-10-22T00:00:00Z", invalid: true }),
      arrivalQuestion({ relativePath: "_bookkeeping/questions/pending.question.card", askedAt: "2026-10-01T00:00:00Z" }),
    ]),
    none: pickArrivalQuestion([]),
  }, {
    newest: "_bookkeeping/questions/a-new.question.card",
    skipped: "_bookkeeping/questions/pending.question.card",
    none: null,
  });
});
