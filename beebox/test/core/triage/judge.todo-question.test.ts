// # Optional destination follow-up questions
//
// A landmark can request a per-item yes/no judgment. Destinations without a
// question do not consume binary questions, and every configured question shares
// the destination classification call and its immutable evidence.

import { test } from "tap";
import "agent-doctest/tap";
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
  // doctest:L21
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

  // doctest:L41
  await t.checkText(records?.todoQuestion === undefined, "true");

  // doctest:L44
  invariant(bills && records, "fixture destinations compile");
  invariant(bills.todoQuestion, "bills destination has a todo question");
  const compiled = await compileTriageInstructions(box.root);
  const category = compiled.categories.find((destination) => destination.name === "bills");
  await t.checkText(category?.todoQuestion === bills.todoQuestion && category?.landmarkRef === bills.ref && compiled.doc.includes(bills.todoQuestion), "true");

  // doctest:L51
  t.check(LandmarkDestination.safeParse({ for: ["triage"], "todo-question": "   " }).success, false);

  // doctest:L54
  t.check(LandmarkDestination.parse({ for: ["triage"], "todo-question": " Does this need attention? " })["todo-question"], "Does this need attention?");

  // doctest:L57
  const evidence: Evidence = { version: 1, source: { ref: "/_content/inbox/staged/Bill.doc.card", digest: "a".repeat(64), gitRevision: null, attachmentRef: null }, status: "ready", parts: [{ ref: "/_content/inbox/staged/Bill.doc.card", digest: "a".repeat(64), mediaType: "text/plain", method: "native-text", toolVersion: "1", status: "ready", text: "Household utility bill: payment is outstanding.", omissions: [] }], recipe: { adapterVersion: 1, steps: ["native text"], maxTextChars: 1000 } };
  const request = buildTriageRequest({ evidence, instructions: snapshot });
  await t.checkText(Object.keys(request.questions).length, "2");

  // doctest:L62
  t.check(request.questions[`todo_${bills.optionId}`]?.type, "noul");

  // doctest:L65
  const yes = createFakeJev({ answers: (name, { question }) => name === "destination" ? fixedAnswer(question, { yes: true }) : { type: "noul", probability: 0.9 } });
  const judgment = await judgeItem(box.root, { evidence, instructions: snapshot, jev: yes });
  await t.checkText(judgment.destinationRef === bills.ref && judgment.todoAnswers?.[bills.optionId] === 0.9, "true");

  // doctest:L70
  await t.checkText(yes.judgeCalls.length, "1");

  // doctest:L73
  const no = createFakeJev({ answers: (name, { question }) => name === "destination" ? fixedAnswer(question, { yes: true }) : { type: "noul", probability: 0.1 } });
  const negative = await judgeItem(box.root, { evidence, instructions: snapshot, jev: no });
  t.check(negative.todoAnswers?.[bills.optionId], 0.1);

  // doctest:L78
  // Preparation-only judgments may lack answers; an evaluated configured
  // question cannot silently disappear from the provider result.
  const missing: JevService = { ...yes, judge: async (input) => {
    const result = await yes.judge(input);
    delete result.answers[`todo_${bills.optionId}`];
    return result;
  } };
  await t.checkThrows(async () => (await judgeItem(box.root, { evidence, instructions: snapshot, jev: missing })), "TriageJudgmentError: Jev returned a missing or invalid destination todo answer");

  // doctest:L88
  // Historical/no-question snapshots retain a destination-only request shape.
  const withoutQuestions = { ...snapshot, destinations: snapshot.destinations.map(({ todoQuestion: _todoQuestion, ...destination }) => destination) };
  t.check(Object.keys(buildTriageRequest({ evidence, instructions: withoutQuestions }).questions).join(","), "destination");

  // doctest:L93
  const old = await judgeItem(box.root, { evidence, instructions: withoutQuestions, jev: createFakeJev({ answers: (_name, { question }) => fixedAnswer(question, { yes: true }) }) });
  await t.checkText(old.todoAnswers === undefined, "true");
});
