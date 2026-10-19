// # Replay includes destination todo outcomes
//
// Changing a follow-up question or its binary answer matters even when filing
// stays the same. Replay reports the difference without creating a todo.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { uuid } from "@ianbicking/tap-check/check";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { compileInstructionSnapshot } from "../../../src/core/triage/snapshot.js";
import { judgeItem } from "../../../src/core/triage/judge.js";
import { prepareItem } from "../../../src/core/triage/evidence/core.js";
import { createDecisionReceipt, saveDecisionReceipt } from "../../../src/core/triage/decisions/storage.js";
import { replayDecisions } from "../../../src/core/triage/decisions/replay.js";
import { createFakeJev } from "../../../src/services/jev.js";
import { fixedAnswer } from "../../../src/core/judgment/service.js";

const OPTION = "destination_be9e1e5dd37949b9372eb527e3c1a5f9884211a2a477aa69db28c28011fea4ae";
const SUMMARY = "Classifier summary: /_content/bills/Bills.landmark.card; leading probability 1.000, confidence 1.000; instructions: /_config/intake.guide.card, /_content/bills/Bills.landmark.card.";

// The replay result for a receipt judged with todo probability 0.9, re-judged with `candidate`.
function replayResult(candidate: { todoAnswers: Record<string, number> | undefined; requestHash: string }, todoOutcomeChanged: boolean) {
  const choice = { type: "choice", choice: OPTION, confidence: 1, probabilities: { [OPTION]: 1, "no-match": 0, unclear: 0 } } as const;
  const reason = { kind: "summary", text: SUMMARY, evidenceRefs: ["/_content/inbox/staged/Notice.doc.card"] } as const;
  return {
    id: uuid(),
    repetition: 1,
    historical: {
      todoAnswers: { [OPTION]: 0.9 },
      outcome: "destination",
      destinationRef: "/_content/bills/Bills.landmark.card",
      requestHash: "f7e86f65ae49bb11c8c1885e3c68f68b8412a5166866737d8d6d498635b819ca",
      requestedModel: "typesafe/jev-1.13",
      returnedModel: "fake-jev",
      answer: choice,
      reason,
    },
    model: "fake-jev",
    modelDrift: false,
    assertions: [],
    status: "evaluated",
    preparationChanged: false,
    candidate: {
      ...candidate,
      outcome: "destination",
      destinationRef: "/_content/bills/Bills.landmark.card",
      requestedModel: "fake-jev",
      returnedModel: "fake-jev",
      answer: choice,
      reason,
    },
    outcomeChanged: false,
    todoOutcomeChanged,
    probabilityDeltas: { [OPTION]: 0, "no-match": 0, unclear: 0 },
  } as const;
}

function answer(probability: number) {
  return createFakeJev({ answers: (_name, { question }) => question.type === "noul" ? { type: "noul", probability } : fixedAnswer(question, { yes: true }) });
}

void test("line 22", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L23
  const box = await makeTmpBox();
  const sourceRef = "/_content/inbox/staged/Notice.doc.card";
  const originalBytes = "---\ntitle: Notice\n---\nUtility bill is outstanding.\n";
  await box.write(sourceRef.slice(1), originalBytes);
  await box.write("_content/bills/Bills.landmark.card", "---\ndestinations:\n  - for: [triage]\n    rules: Utility bills.\n    todo-question: Does this require attention?\n---\n");
  const instructions = await compileInstructionSnapshot(box.root);
  const evidence = await prepareItem({ boxRoot: box.root, sourceRef, instructions });
  const judgment = await judgeItem(box.root, { evidence, instructions, jev: answer(0.9) });
  const receipt = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment });
  await saveDecisionReceipt(box.root, receipt);
  const shared = { boxRoot: box.root, ids: [receipt.id], maxCalls: 1 };
  const same = await replayDecisions({ ...shared, instructions, jev: answer(0.8) });
  t.check(same.results[0], replayResult({ todoAnswers: { [OPTION]: 0.8 }, requestHash: "fba23eabe64c388ffaf35f6c8157f926b90761fe5adb572d7a36a49a44a5ab4a" }, false));

  // doctest:L38
  const no = await replayDecisions({ ...shared, instructions, jev: answer(0.1) });
  t.check(no.results[0], replayResult({ todoAnswers: { [OPTION]: 0.1 }, requestHash: "fba23eabe64c388ffaf35f6c8157f926b90761fe5adb572d7a36a49a44a5ab4a" }, true));

  // doctest:L42
  const tie = await replayDecisions({ ...shared, instructions, jev: answer(0.5) });
  t.check(tie.results[0], replayResult({ todoAnswers: { [OPTION]: 0.5 }, requestHash: "fba23eabe64c388ffaf35f6c8157f926b90761fe5adb572d7a36a49a44a5ab4a" }, true));

  // doctest:L46
  const changed = { ...instructions, destinations: instructions.destinations.map((destination) => ({ ...destination, todoQuestion: "Is the payment disputed?" })) };
  const newQuestion = await replayDecisions({ ...shared, instructions: changed, jev: answer(0.9) });
  t.check(newQuestion.results[0], replayResult({ todoAnswers: { [OPTION]: 0.9 }, requestHash: "f94b5fca24342fb2a7c545aef29300991f40b3d33c8a44e5b7e1dc5ad75a6505" }, true));

  // doctest:L51
  const omitted = { ...instructions, destinations: instructions.destinations.map(({ todoQuestion: _todoQuestion, ...destination }) => destination) };
  const absent = await replayDecisions({ ...shared, instructions: omitted, jev: answer(0.9) });
  t.check(absent.results[0], replayResult({ todoAnswers: undefined, requestHash: "c984d29738092475dbf163eac9d2d2c9f1ffdedf9355a5bbab60c155d9c7d3b4" }, true));

  // doctest:L56
  t.check(await fs.readFile(path.join(box.root, sourceRef.slice(1)), "utf8"), originalBytes);
});
