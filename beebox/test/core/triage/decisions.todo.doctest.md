# Triage follow-up todo application

Configured destination questions create one stable agent todo on a positive
answer. The annotation is replay-safe and legacy triage shares its deterministic
merge rules.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { simpleGit } from "simple-git";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { prepareItem } from "../../../src/core/triage/evidence/core.js";
import { compileInstructionSnapshot } from "../../../src/core/triage/snapshot.js";
import { compileTriageInstructions } from "../../../src/core/triage/instructions.js";
import { createDecisionReceipt, saveDecisionReceipt } from "../../../src/core/triage/decisions/storage.js";
import { applyDecision } from "../../../src/core/triage/decisions/apply.js";
import { replayDecisions } from "../../../src/core/triage/decisions/replay.js";
import { applyTriage } from "../../../src/core/triage/run/routing.js";
import { createCardSchemaMap } from "../../../src/schemas.js";
import { parseCardText, serializeCardText } from "../../../src/core/card-io.js";
import { movePathPreservingAnnexSymlink } from "../../../src/core/card-files/move-phase2.js";
import { getTriageTodoDate, planTriageTodoAnnotation } from "../../../src/core/triage/todo.js";
import { invariant } from "../../../src/shared/invariant.js";

async function receiptFixture(options?: { question?: string | null; tracked?: boolean }) {
  const question = options?.question === null ? null : options?.question ?? "Does this need follow-up?";
  const tracked = options?.tracked ?? false;
  const box = await makeTmpBox();
  const questionYaml = question === null ? "" : `    todo-question: ${question}\n`;
  await box.write("_content/bills/Bills.landmark.card", `---\ndestinations:\n  - for: [triage]\n    rules: Bills.\n${questionYaml}---\n`);
  await box.write("_content/inbox/staged/Paper.doc.card", "---\n# preserve this note\ntitle: Paper\nundeclared: keep-me\n---\nA bill requiring review.");
  await simpleGit(box.root).add("_content/bills/Bills.landmark.card");
  await simpleGit(box.root).commit("Add todo destination");
  if (tracked) {
    await simpleGit(box.root).add("_content/inbox/staged/Paper.doc.card");
    await simpleGit(box.root).commit("Admit paper");
  }
  const evidence = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/Paper.doc.card" });
  const instructions = await compileInstructionSnapshot(box.root);
  const destination = instructions.destinations[0];
  invariant(destination !== undefined, "Fixture needs its destination");
  invariant(question === null || destination.todoQuestion !== undefined, "Fixture needs its configured question");
  const baseJudgment = {
    outcome: "destination" as const, destinationRef: destination.ref,
    requestHash: "a".repeat(64), requestedModel: "fake-jev", returnedModel: "fake-jev",
    answer: { type: "choice" as const, choice: destination.optionId, confidence: 0.9, probabilities: { [destination.optionId]: 0.9, "no-match": 0.05, unclear: 0.05 } },
    reason: { kind: "summary" as const, text: "Bill", evidenceRefs: evidence.parts.map((part) => part.ref) },
  };
  return { box, evidence, instructions, destination, baseJudgment };
}
async function setTodoStatus(boxRoot, file, status) {
  const schemas = await createCardSchemaMap(boxRoot);
  const parsed = parseCardText(await fs.readFile(file, "utf8"), { source: file, schemas });
  const todos = parsed.fields.todos.map((todo) => ({ ...todo, status }));
  await fs.writeFile(file, serializeCardText({ schema: parsed.schema, fields: { ...parsed.fields, todos } }));
}
async function capturedError(run) {
  try { await run(); return ""; } catch (error) { return String(error); }
}
```

```ts
const { box, evidence, instructions, destination, baseJudgment } = await receiptFixture();
const receipt = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment: { ...baseJudgment, todoAnswers: { [destination.optionId]: 0.8 } } });
const applied = await applyDecision({ boxRoot: box.root, decision: receipt });
applied.application.todoAnnotation?.state
=> applied

const target = box.path("_content/inbox/triaged/bills/Paper.doc.card");
const annotated = await fs.readFile(target, "utf8");
annotated.includes("assigned: agent") && annotated.includes("by: agent") && annotated.includes("Does this need follow-up?")
=> true

annotated.includes("# preserve this note") && annotated.includes("undeclared: keep-me") && annotated.includes("A bill requiring review.")
=> true

const appliedAgain = await applyDecision({ boxRoot: box.root, decision: receipt.id });
appliedAgain.application.todoAnnotation?.todoId === applied.application.todoAnnotation?.todoId
=> true

const parsedAfterRepeat = await fs.readFile(target, "utf8");
parsedAfterRepeat === annotated
=> true

// Completion state and later notes survive a retry unchanged.
await setTodoStatus(box.root, target, "done");
const completed = await fs.readFile(target, "utf8");
const afterCompletionRetry = await applyDecision({ boxRoot: box.root, decision: receipt.id });
afterCompletionRetry.application.todoAnnotation?.state
=> applied

(await fs.readFile(target, "utf8")) === completed
=> true

const reprepared = await replayDecisions({ boxRoot: box.root, ids: [receipt.id], instructions, maxCalls: 1, prepareAgain: true, env: { BBX_JEV_FAKE: "1" } });
reprepared.results[0]?.status
=> evaluated

reprepared.results[0]?.error === undefined
=> true

reprepared.results[0]?.preparationChanged
=> false

await box.cleanup();
```

```ts
const { box, evidence, instructions, baseJudgment } = await receiptFixture({ question: null });
const withoutQuestion = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment: baseJudgment });
await applyDecision({ boxRoot: box.root, decision: withoutQuestion });
(await fs.readFile(box.path("_content/inbox/triaged/bills/Paper.doc.card"), "utf8")).includes("todos:")
=> false

await box.cleanup();
```

```ts
const { box, evidence, instructions, destination, baseJudgment } = await receiptFixture();
await fs.writeFile(box.path("_content/inbox/staged/Paper.txt"), "Raw admitted text.");
const rawEvidence = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/Paper.txt" });
const raw = createDecisionReceipt({ boxRoot: box.root, evidence: rawEvidence, instructions, judgment: { ...baseJudgment, reason: { ...baseJudgment.reason, evidenceRefs: rawEvidence.parts.map((part) => part.ref) }, todoAnswers: { [destination.optionId]: 0.9 } } });
let rawError = "";
rawError = await capturedError(() => applyDecision({ boxRoot: box.root, decision: raw }));
rawError.includes("positive follow-up requires a card with frontmatter")
=> true

const rawStillStaged = await fs.access(box.path("_content/inbox/staged/Paper.txt")).then(() => true, () => false);
rawStillStaged
=> true

await box.cleanup();
```

```ts
const { box, evidence, instructions, destination, baseJudgment } = await receiptFixture();
const receipt = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment: { ...baseJudgment, todoAnswers: { [destination.optionId]: 0.95 } } });
const from = box.path("_content/inbox/staged/Paper.doc.card");
const to = box.path("_content/inbox/triaged/bills/Paper.doc.card");
const plan = await planTriageTodoAnnotation({ file: from, boxRoot: box.root, destinationRef: destination.ref, question: destination.todoQuestion, created: await getTriageTodoDate(box.root) });
receipt.application.state = "applied";
receipt.application.todoAnnotation = { state: "pending", todoId: plan.todoId, beforeDigest: plan.beforeDigest, afterDigest: plan.afterDigest, created: await getTriageTodoDate(box.root) };
await saveDecisionReceipt(box.root, receipt);
await movePathPreservingAnnexSymlink(from, to);
const git = simpleGit(box.root);
await git.add(["_content/inbox/triaged/bills/Paper.doc.card", `_bookkeeping/triage/decisions/${receipt.id}.json`]);
await git.commit(`Route paper\n\nTriage-Decision: ${receipt.id}\nTriage-Classifier: fake-jev`);
await fs.writeFile(to, plan.after); // Simulate a crash after the atomic todo replacement.

const resumed = await applyDecision({ boxRoot: box.root, decision: receipt.id });
resumed.application.todoAnnotation?.state
=> applied

const exactReplay = await replayDecisions({ boxRoot: box.root, ids: [receipt.id], instructions, maxCalls: 1, prepareAgain: true, env: { BBX_JEV_FAKE: "1" } });
exactReplay.results[0]?.status
=> evaluated

exactReplay.results[0]?.error === undefined
=> true

exactReplay.results[0]?.preparationChanged === false
=> true

await box.cleanup();
```

```ts
const { box, evidence, instructions, destination, baseJudgment } = await receiptFixture();
const negative = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment: { ...baseJudgment, todoAnswers: { [destination.optionId]: 0.5 } } });
const missing = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment: { ...baseJudgment, todoAnswers: undefined } });
let missingError = "";
missingError = await capturedError(() => applyDecision({ boxRoot: box.root, decision: missing }));
missingError.includes("Missing recorded todo answer") && missingError.includes("judge a new decision") && !missingError.includes("retry apply:")
=> true

await applyDecision({ boxRoot: box.root, decision: negative });
const negativeText = await fs.readFile(box.path("_content/inbox/triaged/bills/Paper.doc.card"), "utf8");
negativeText.includes("todos:")
=> false

await box.cleanup();
```

```ts
const { box, evidence, instructions, destination, baseJudgment } = await receiptFixture();
const held = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment: { ...baseJudgment, outcome: "unclear", destinationRef: null, answer: { ...baseJudgment.answer, choice: "unclear", probabilities: { [destination.optionId]: 0.1, "no-match": 0.1, unclear: 0.8 } } } });
await applyDecision({ boxRoot: box.root, decision: held });
const heldText = await fs.readFile(box.path("_content/inbox/triaged/_unsure/Paper.doc.card"), "utf8");
heldText.includes("todos:")
=> false

const corrected = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment: { ...baseJudgment, todoAnswers: { [destination.optionId]: 0.9 } }, originalDecisionId: held.id });
corrected.resolution = { destinationRef: destination.ref, sourceRef: "/_bookkeeping/questions/example.question.card", actor: "user" };
corrected.application.from = held.application.to;
corrected.application.to = "/_content/inbox/triaged/bills/Paper.doc.card";
await saveDecisionReceipt(box.root, corrected);
const correctedApplied = await applyDecision({ boxRoot: box.root, decision: corrected });
correctedApplied.application.todoAnnotation?.state
=> applied

await box.cleanup();
```

```ts
const box = await makeTmpBox();
await box.write("_content/bills/Bills.landmark.card", "---\ndestinations:\n  - for: [triage]\n    rules: Bills.\n    todo-question: Does this need follow-up?\n---\n");
await box.write("_content/inbox/staged/Legacy.doc.card", "---\ntitle: Legacy\n---\nBill.");
const compiled = await compileTriageInstructions(box.root);
const category = compiled.categories[0];
const response = (todo) => applyTriage({ boxRoot: box.root, categories: compiled.categories, decisions: [{ file: "Legacy.doc.card", category: category.name, confidence: "confident", reason: "Bill", todo }] });
await response(true);
(await fs.readFile(box.path("_content/inbox/triaged/bills/Legacy.doc.card"), "utf8")).includes("assigned: agent")
=> true

await box.write("_content/inbox/staged/No.doc.card", "---\ntitle: No\n---\nBill.");
await applyTriage({ boxRoot: box.root, categories: compiled.categories, decisions: [{ file: "No.doc.card", category: category.name, confidence: "confident", reason: "Bill", todo: false }] });
(await fs.readFile(box.path("_content/inbox/triaged/bills/No.doc.card"), "utf8")).includes("todos:")
=> false

await box.cleanup();
```

```ts
const { box, destination } = await receiptFixture();
const file = box.path("_content/inbox/staged/Paper.doc.card");
const original = await fs.readFile(file, "utf8");
await fs.writeFile(file, original.replace("title: Paper", "title: Paper\ntodos:\n  - id: existing\n    text: Keep this task\n    status: done\n    recheck: never\n    unknown: keep-this-too # task note"));
const addition = await planTriageTodoAnnotation({ file, boxRoot: box.root, destinationRef: destination.ref, question: destination.todoQuestion, created: await getTriageTodoDate(box.root) });
addition.after.includes("unknown: keep-this-too # task note") && addition.after.includes("status: done") && addition.after.includes("recheck: never") && addition.after.includes(addition.todoId)
=> true

await box.cleanup();
```

```ts cleanup
```
