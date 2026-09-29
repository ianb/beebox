# Replay includes destination todo outcomes

Changing a follow-up question or its binary answer matters even when filing
stays the same. Replay reports the difference without creating a todo.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { compileInstructionSnapshot } from "../../../src/core/triage/snapshot.js";
import { judgeItem } from "../../../src/core/triage/judge.js";
import { prepareItem } from "../../../src/core/triage/evidence/core.js";
import { createDecisionReceipt, saveDecisionReceipt } from "../../../src/core/triage/decisions/storage.js";
import { replayDecisions } from "../../../src/core/triage/decisions/replay.js";
import { createFakeJev } from "../../../src/services/jev.js";
import { fixedAnswer } from "../../../src/core/judgment/service.js";
function answer(probability) {
  return createFakeJev({ answers: (_name, { question }) => question.type === "noul" ? { type: "noul", probability } : fixedAnswer(question, { yes: true }) });
}
```

```ts
const box = await makeTmpBox();
const sourceRef = "/_content/inbox/staged/Notice.memo.card";
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
same.results[0].status === "evaluated" && same.results[0].todoOutcomeChanged === false
=> true

const no = await replayDecisions({ ...shared, instructions, jev: answer(0.1) });
no.results[0].outcomeChanged === false && no.results[0].todoOutcomeChanged === true
=> true

const tie = await replayDecisions({ ...shared, instructions, jev: answer(0.5) });
tie.results[0].todoOutcomeChanged
=> true

const changed = { ...instructions, destinations: instructions.destinations.map((destination) => ({ ...destination, todoQuestion: "Is the payment disputed?" })) };
const newQuestion = await replayDecisions({ ...shared, instructions: changed, jev: answer(0.9) });
newQuestion.results[0].todoOutcomeChanged
=> true

const omitted = { ...instructions, destinations: instructions.destinations.map(({ todoQuestion, ...destination }) => destination) };
const absent = await replayDecisions({ ...shared, instructions: omitted, jev: answer(0.9) });
absent.results[0].todoOutcomeChanged
=> true

await fs.readFile(path.join(box.root, sourceRef.slice(1)), "utf8") === originalBytes
=> true
```

```ts cleanup
await box.cleanup();
```
