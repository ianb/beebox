// # Optional destination follow-up questions
//
// A landmark can request a per-item yes/no judgment. Destinations without a
// question do not consume binary questions, and every configured question shares
// the destination classification call and its immutable evidence.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { compileInstructionSnapshot } from "../../../src/core/triage/snapshot.js";
import { compileTriageInstructions } from "../../../src/core/triage/instructions.js";
import { buildTriageRequest, judgeItem } from "../../../src/core/triage/judge.js";
import { LandmarkDestination } from "../../../src/schemas/landmark.js";
import { createFakeJev } from "../../../src/services/jev.js";
import type { JevService } from "../../../src/services/jev.js";
import type { Evidence } from "../../../src/core/triage/evidence/core.js";
import { invariant } from "../../../src/shared/invariant.js";
import { fixedAnswer } from "../../../src/core/judgment/service.js";

void test("line 20", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write("_content/bills/Bills.landmark.card", `---
destinations:
  - for: [triage]
    rules: Household bills and payment confirmations.
    todo-question: Does this bill still need payment or investigation?
---
`);
  await box.write("_content/records/Records.landmark.card", `---
destinations:
  - for: [triage]
    rules: Records kept only for reference.
---
`);
  const snapshot = await compileInstructionSnapshot(box.root);
  const bills = snapshot.destinations.find((destination) => destination.name === "bills");
  const records = snapshot.destinations.find((destination) => destination.name === "records");
  t.check(bills?.todoQuestion, "Does this bill still need payment or investigation?");

  t.check(records?.todoQuestion, undefined);

  invariant(bills && records, "fixture destinations compile");
  invariant(bills.todoQuestion, "bills destination has a todo question");
  const compiled = await compileTriageInstructions(box.root);
  const category = compiled.categories.find((destination) => destination.name === "bills");
  t.check({ todoQuestion: category?.todoQuestion, landmarkRef: category?.landmarkRef }, { todoQuestion: bills.todoQuestion, landmarkRef: bills.ref });
  t.check(compiled.doc, any(String).includes(bills.todoQuestion));

  t.check(LandmarkDestination.safeParse({ for: ["triage"], "todo-question": "   " }).success, false);

  t.check(LandmarkDestination.parse({ for: ["triage"], "todo-question": " Does this need attention? " })["todo-question"], "Does this need attention?");

  const evidence: Evidence = { version: 1, source: { ref: "/_content/inbox/staged/Bill.doc.card", digest: "a".repeat(64), gitRevision: null, attachmentRef: null }, status: "ready", parts: [{ ref: "/_content/inbox/staged/Bill.doc.card", digest: "a".repeat(64), mediaType: "text/plain", method: "native-text", toolVersion: "1", status: "ready", text: "Household utility bill: payment is outstanding.", omissions: [] }], recipe: { adapterVersion: 1, steps: ["native text"], maxTextChars: 1000 } };
  const request = buildTriageRequest({ evidence, instructions: snapshot });
  t.check(Object.keys(request.questions), ["destination", `todo_${bills.optionId}`]);

  t.check(request.questions[`todo_${bills.optionId}`]?.type, "noul");

  const yes = createFakeJev({ answers: (name, { question }) => name === "destination" ? fixedAnswer(question, { yes: true }) : { type: "noul", probability: 0.9 } });
  const judgment = await judgeItem(box.root, { evidence, instructions: snapshot, jev: yes });
  t.check(judgment, {
    todoAnswers: { [bills.optionId]: 0.9 },
    outcome: "destination",
    destinationRef: bills.ref,
    requestHash: "3f18c1b6d064cb4bd654ca9a547c8730cb37b9d0c05c5a6b19da2e4374831a6d",
    requestedModel: "typesafe/jev-1.13",
    returnedModel: "fake-jev",
    answer: {
      type: "choice",
      choice: bills.optionId,
      confidence: 1,
      probabilities: {
        [bills.optionId]: 1,
        [records.optionId]: 0,
        "no-match": 0,
        unclear: 0,
      },
    },
    reason: {
      kind: "summary",
      text: "Classifier summary: /_content/bills/Bills.landmark.card; leading probability 1.000, confidence 1.000; instructions: /_config/intake.guide.card, /_content/bills/Bills.landmark.card, /_content/records/Records.landmark.card.",
      evidenceRefs: ["/_content/inbox/staged/Bill.doc.card"],
    },
  });

  // One call carries the destination question and the follow-up question; the prompt wording is not pinned here.
  t.check(yes.judgeCalls.map((call) => Object.keys(call.questions)), [["destination", `todo_${bills.optionId}`]]);

  const no = createFakeJev({ answers: (name, { question }) => name === "destination" ? fixedAnswer(question, { yes: true }) : { type: "noul", probability: 0.1 } });
  const negative = await judgeItem(box.root, { evidence, instructions: snapshot, jev: no });
  t.check(negative.todoAnswers?.[bills.optionId], 0.1);

  // Preparation-only judgments may lack answers; an evaluated configured
  // question cannot silently disappear from the provider result.
  const missing: JevService = { ...yes, judge: async (input) => {
    const result = await yes.judge(input);
    delete result.answers[`todo_${bills.optionId}`];
    return result;
  } };
  await t.checkThrows(async () => (await judgeItem(box.root, { evidence, instructions: snapshot, jev: missing })), "TriageJudgmentError: Jev returned a missing or invalid destination todo answer");

  // Historical/no-question snapshots retain a destination-only request shape.
  const withoutQuestions = { ...snapshot, destinations: snapshot.destinations.map(({ todoQuestion: _todoQuestion, ...destination }) => destination) };
  t.check(Object.keys(buildTriageRequest({ evidence, instructions: withoutQuestions }).questions).join(","), "destination");

  const old = await judgeItem(box.root, { evidence, instructions: withoutQuestions, jev: createFakeJev({ answers: (_name, { question }) => fixedAnswer(question, { yes: true }) }) });
  t.check(old.todoAnswers, undefined);
});
