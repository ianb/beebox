// # Replay includes destination todo outcomes
//
// Changing a follow-up question or its binary answer matters even when filing
// stays the same. Replay reports the difference without creating a todo.

import { test } from "tap";
import "agent-doctest/tap";
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
  await t.checkText(same.results[0]?.status === "evaluated" && same.results[0].todoOutcomeChanged === false, "true");

  // doctest:L38
  const no = await replayDecisions({ ...shared, instructions, jev: answer(0.1) });
  await t.checkText(no.results[0]?.outcomeChanged === false && no.results[0].todoOutcomeChanged === true, "true");

  // doctest:L42
  const tie = await replayDecisions({ ...shared, instructions, jev: answer(0.5) });
  t.check(tie.results[0]?.todoOutcomeChanged, true);

  // doctest:L46
  const changed = { ...instructions, destinations: instructions.destinations.map((destination) => ({ ...destination, todoQuestion: "Is the payment disputed?" })) };
  const newQuestion = await replayDecisions({ ...shared, instructions: changed, jev: answer(0.9) });
  t.check(newQuestion.results[0]?.todoOutcomeChanged, true);

  // doctest:L51
  const omitted = { ...instructions, destinations: instructions.destinations.map(({ todoQuestion: _todoQuestion, ...destination }) => destination) };
  const absent = await replayDecisions({ ...shared, instructions: omitted, jev: answer(0.9) });
  t.check(absent.results[0]?.todoOutcomeChanged, true);

  // doctest:L56
  await t.checkText(await fs.readFile(path.join(box.root, sourceRef.slice(1)), "utf8") === originalBytes, "true");
});
