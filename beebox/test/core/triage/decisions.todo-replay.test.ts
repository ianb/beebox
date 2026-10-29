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
      requestHash: "3d4c511addf2f291fd8aa9532a1eaa140c986dcd06f6e2cecca5b85faa376898",
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
  t.check(same.results[0], replayResult({ todoAnswers: { [OPTION]: 0.8 }, requestHash: "08132d63c5211325c4f9b137867480524dbd3ea14cdcfd99d4f276938d5d6b3e" }, false));

  const no = await replayDecisions({ ...shared, instructions, jev: answer(0.1) });
  t.check(no.results[0], replayResult({ todoAnswers: { [OPTION]: 0.1 }, requestHash: "08132d63c5211325c4f9b137867480524dbd3ea14cdcfd99d4f276938d5d6b3e" }, true));

  const tie = await replayDecisions({ ...shared, instructions, jev: answer(0.5) });
  t.check(tie.results[0], replayResult({ todoAnswers: { [OPTION]: 0.5 }, requestHash: "08132d63c5211325c4f9b137867480524dbd3ea14cdcfd99d4f276938d5d6b3e" }, true));

  const changed = { ...instructions, destinations: instructions.destinations.map((destination) => ({ ...destination, todoQuestion: "Is the payment disputed?" })) };
  const newQuestion = await replayDecisions({ ...shared, instructions: changed, jev: answer(0.9) });
  t.check(newQuestion.results[0], replayResult({ todoAnswers: { [OPTION]: 0.9 }, requestHash: "eae8f04ef1ef768c30c26ea2e68ed47f7707668f3abbfde183ca2e507326f94a" }, true));

  const omitted = { ...instructions, destinations: instructions.destinations.map(({ todoQuestion: _todoQuestion, ...destination }) => destination) };
  const absent = await replayDecisions({ ...shared, instructions: omitted, jev: answer(0.9) });
  t.check(absent.results[0], replayResult({ todoAnswers: undefined, requestHash: "43b7ed78055792cf8c13ec367ec879fc1066183e6cd2aaebd35f8789bf015a97" }, true));

  t.check(await fs.readFile(path.join(box.root, sourceRef.slice(1)), "utf8"), originalBytes);
});
