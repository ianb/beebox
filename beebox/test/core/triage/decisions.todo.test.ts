// # Triage follow-up todo application
//
// Configured destination questions create one stable agent todo on a positive
// answer. The annotation is replay-safe and legacy triage shares its deterministic
// merge rules.

import { test } from "tap";
import "agent-doctest/tap";
import * as fs from "node:fs/promises";
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
import type { TodoStatus } from "../../../src/shared/todo-model.js";
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
async function setTodoStatus(boxRoot: string, { file, status }: { file: string; status: TodoStatus }) {
  const schemas = await createCardSchemaMap(boxRoot);
  const parsed = parseCardText(await fs.readFile(file, "utf8"), { source: file, schemas });
  const existing: unknown = parsed.fields.todos;
  const todos = Array.isArray(existing) ? existing.map((todo: unknown) => (typeof todo === "object" && todo !== null ? { ...todo, status } : todo)) : existing;
  await fs.writeFile(file, serializeCardText({ schema: parsed.schema, fields: { ...parsed.fields, todos } }));
}
async function capturedError(run: () => Promise<unknown>) {
  try { await run(); return ""; } catch (error) { return String(error); }
}

void test("line 64", async (t) => {
  // doctest:L65
  const { box, evidence, instructions, destination, baseJudgment } = await receiptFixture();
  const receipt = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment: { ...baseJudgment, todoAnswers: { [destination.optionId]: 0.8 } } });
  const applied = await applyDecision({ boxRoot: box.root, decision: receipt });
  t.check(applied.application.todoAnnotation?.state, "applied");

  // doctest:L71
  const target = box.path("_content/inbox/triaged/bills/Paper.doc.card");
  const annotated = await fs.readFile(target, "utf8");
  await t.checkText(annotated.includes("assigned: agent") && annotated.includes("by: agent") && annotated.includes("Does this need follow-up?"), "true");

  // doctest:L76
  await t.checkText(annotated.includes("# preserve this note") && annotated.includes("undeclared: keep-me") && annotated.includes("A bill requiring review."), "true");

  // doctest:L79
  const appliedAgain = await applyDecision({ boxRoot: box.root, decision: receipt.id });
  await t.checkText(appliedAgain.application.todoAnnotation?.todoId === applied.application.todoAnnotation?.todoId, "true");

  // doctest:L83
  const parsedAfterRepeat = await fs.readFile(target, "utf8");
  await t.checkText(parsedAfterRepeat === annotated, "true");

  // doctest:L87
  // Completion state and later notes survive a retry unchanged.
  await setTodoStatus(box.root, { file: target, status: "done" });
  const completed = await fs.readFile(target, "utf8");
  const afterCompletionRetry = await applyDecision({ boxRoot: box.root, decision: receipt.id });
  t.check(afterCompletionRetry.application.todoAnnotation?.state, "applied");

  // doctest:L94
  await t.checkText((await fs.readFile(target, "utf8")) === completed, "true");

  // doctest:L97
  const reprepared = await replayDecisions({ boxRoot: box.root, ids: [receipt.id], instructions, maxCalls: 1, prepareAgain: true, env: { BBX_JEV_FAKE: "1" } });
  t.check(reprepared.results[0]?.status, "evaluated");

  // doctest:L101
  await t.checkText(reprepared.results[0]?.error === undefined, "true");

  // doctest:L104
  t.check(reprepared.results[0]?.preparationChanged, false);

  // doctest:L107
  await box.cleanup();
});

void test("line 110", async (t) => {
  // doctest:L111
  const { box, evidence, instructions, baseJudgment } = await receiptFixture({ question: null });
  const withoutQuestion = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment: baseJudgment });
  await applyDecision({ boxRoot: box.root, decision: withoutQuestion });
  await t.checkText((await fs.readFile(box.path("_content/inbox/triaged/bills/Paper.doc.card"), "utf8")).includes("todos:"), "false");

  // doctest:L117
  await box.cleanup();
});

void test("line 120", async (t) => {
  // doctest:L121
  const { box, instructions, destination, baseJudgment } = await receiptFixture();
  await fs.writeFile(box.path("_content/inbox/staged/Paper.txt"), "Raw admitted text.");
  const rawEvidence = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/Paper.txt" });
  const raw = createDecisionReceipt({ boxRoot: box.root, evidence: rawEvidence, instructions, judgment: { ...baseJudgment, reason: { ...baseJudgment.reason, evidenceRefs: rawEvidence.parts.map((part) => part.ref) }, todoAnswers: { [destination.optionId]: 0.9 } } });
  let rawError = "";
  rawError = await capturedError(() => applyDecision({ boxRoot: box.root, decision: raw }));
  await t.checkText(rawError.includes("positive follow-up requires a card with frontmatter"), "true");

  // doctest:L130
  const rawStillStaged = await fs.access(box.path("_content/inbox/staged/Paper.txt")).then(() => true, () => false);
  t.check(rawStillStaged, true);

  // doctest:L134
  await box.cleanup();
});

void test("line 137", async (t) => {
  // doctest:L138
  const { box, evidence, instructions, destination, baseJudgment } = await receiptFixture();
  const receipt = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment: { ...baseJudgment, todoAnswers: { [destination.optionId]: 0.95 } } });
  const from = box.path("_content/inbox/staged/Paper.doc.card");
  const to = box.path("_content/inbox/triaged/bills/Paper.doc.card");
  invariant(destination.todoQuestion, "Fixture destination has a todo question");
  const plan = await planTriageTodoAnnotation({ file: from, boxRoot: box.root, destinationRef: destination.ref, question: destination.todoQuestion, created: await getTriageTodoDate(box.root) });
  receipt.application.state = "applied";
  receipt.application.todoAnnotation = { state: "pending", todoId: plan.todoId, beforeDigest: plan.beforeDigest, afterDigest: plan.afterDigest, created: await getTriageTodoDate(box.root) };
  await saveDecisionReceipt(box.root, receipt);
  await movePathPreservingAnnexSymlink(from, to);
  const git = simpleGit(box.root);
  await git.add(["_content/inbox/triaged/bills/Paper.doc.card", `_bookkeeping/triage/decisions/${receipt.id}.json`]);
  await git.commit(`Route paper\n\nTriage-Decision: ${receipt.id}\nTriage-Classifier: fake-jev`);
  await fs.writeFile(to, plan.after); // Simulate a crash after the atomic todo replacement.

  // doctest:L153
  const resumed = await applyDecision({ boxRoot: box.root, decision: receipt.id });
  t.check(resumed.application.todoAnnotation?.state, "applied");

  // doctest:L157
  const exactReplay = await replayDecisions({ boxRoot: box.root, ids: [receipt.id], instructions, maxCalls: 1, prepareAgain: true, env: { BBX_JEV_FAKE: "1" } });
  t.check(exactReplay.results[0]?.status, "evaluated");

  // doctest:L161
  await t.checkText(exactReplay.results[0]?.error === undefined, "true");

  // doctest:L164
  await t.checkText(exactReplay.results[0]?.preparationChanged === false, "true");

  // doctest:L167
  await box.cleanup();
});

void test("line 170", async (t) => {
  // doctest:L171
  const { box, evidence, instructions, destination, baseJudgment } = await receiptFixture();
  const negative = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment: { ...baseJudgment, todoAnswers: { [destination.optionId]: 0.5 } } });
  const missing = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment: { ...baseJudgment, todoAnswers: undefined } });
  let missingError = "";
  missingError = await capturedError(() => applyDecision({ boxRoot: box.root, decision: missing }));
  await t.checkText(missingError.includes("Missing recorded todo answer") && missingError.includes("judge a new decision") && !missingError.includes("retry apply:"), "true");

  // doctest:L179
  await applyDecision({ boxRoot: box.root, decision: negative });
  const negativeText = await fs.readFile(box.path("_content/inbox/triaged/bills/Paper.doc.card"), "utf8");
  await t.checkText(negativeText.includes("todos:"), "false");

  // doctest:L184
  await box.cleanup();
});

void test("line 187", async (t) => {
  // doctest:L188
  const { box, evidence, instructions, destination, baseJudgment } = await receiptFixture();
  const held = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment: { ...baseJudgment, outcome: "unclear", destinationRef: null, answer: { ...baseJudgment.answer, choice: "unclear", probabilities: { [destination.optionId]: 0.1, "no-match": 0.1, unclear: 0.8 } } } });
  await applyDecision({ boxRoot: box.root, decision: held });
  const heldText = await fs.readFile(box.path("_content/inbox/triaged/_unsure/Paper.doc.card"), "utf8");
  await t.checkText(heldText.includes("todos:"), "false");

  // doctest:L195
  const corrected = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment: { ...baseJudgment, todoAnswers: { [destination.optionId]: 0.9 } }, originalDecisionId: held.id });
  corrected.resolution = { destinationRef: destination.ref, sourceRef: "/_bookkeeping/questions/example.question.card", actor: "user" };
  corrected.application.from = held.application.to;
  corrected.application.to = "/_content/inbox/triaged/bills/Paper.doc.card";
  await saveDecisionReceipt(box.root, corrected);
  const correctedApplied = await applyDecision({ boxRoot: box.root, decision: corrected });
  t.check(correctedApplied.application.todoAnnotation?.state, "applied");

  // doctest:L204
  await box.cleanup();
});

void test("line 207", async (t) => {
  // doctest:L208
  const box = await makeTmpBox();
  await box.write("_content/bills/Bills.landmark.card", "---\ndestinations:\n  - for: [triage]\n    rules: Bills.\n    todo-question: Does this need follow-up?\n---\n");
  await box.write("_content/inbox/staged/Legacy.doc.card", "---\ntitle: Legacy\n---\nBill.");
  const compiled = await compileTriageInstructions(box.root);
  const category = compiled.categories[0];
  invariant(category, "Fixture needs its category");
  const response = (todo: boolean) => applyTriage({ boxRoot: box.root, categories: compiled.categories, decisions: [{ file: "Legacy.doc.card", category: category.name, confidence: "confident", reason: "Bill", todo }] });
  await response(true);
  await t.checkText((await fs.readFile(box.path("_content/inbox/triaged/bills/Legacy.doc.card"), "utf8")).includes("assigned: agent"), "true");

  // doctest:L219
  await box.write("_content/inbox/staged/No.doc.card", "---\ntitle: No\n---\nBill.");
  await applyTriage({ boxRoot: box.root, categories: compiled.categories, decisions: [{ file: "No.doc.card", category: category.name, confidence: "confident", reason: "Bill", todo: false }] });
  await t.checkText((await fs.readFile(box.path("_content/inbox/triaged/bills/No.doc.card"), "utf8")).includes("todos:"), "false");

  // doctest:L224
  await box.cleanup();
});

void test("line 227", async (t) => {
  // doctest:L228
  const { box, destination } = await receiptFixture();
  const file = box.path("_content/inbox/staged/Paper.doc.card");
  const original = await fs.readFile(file, "utf8");
  await fs.writeFile(file, original.replace("title: Paper", "title: Paper\ntodos:\n  - id: existing\n    text: Keep this task\n    status: done\n    recheck: never\n    unknown: keep-this-too # task note"));
  invariant(destination.todoQuestion, "Fixture destination has a todo question");
  const addition = await planTriageTodoAnnotation({ file, boxRoot: box.root, destinationRef: destination.ref, question: destination.todoQuestion, created: await getTriageTodoDate(box.root) });
  await t.checkText(addition.after.includes("unknown: keep-this-too # task note") && addition.after.includes("status: done") && addition.after.includes("recheck: never") && addition.after.includes(addition.todoId), "true");

  // doctest:L237
  await box.cleanup();
});
