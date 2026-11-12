// # Triage follow-up todo application
//
// Configured destination questions create one stable agent todo on a positive
// answer. The annotation is replay-safe and legacy triage shares its deterministic
// merge rules.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { uuid } from "@ianbicking/tap-check/check";
import * as fs from "node:fs/promises";
import { simpleGit } from "simple-git";
import { makeTmpBox } from "../../helpers/test-helpers.js";
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
import { planTriageTodoAnnotation } from "../../../src/core/triage/todo.js";
import { boxLocalDay } from "../../../src/core/box/local-day.js";
import type { TodoStatus } from "../../../src/shared/todo-model.js";
import { invariant } from "../../../src/shared/invariant.js";

const TODO_ID = "triage-8d406452c222";
const TODO_TEXT = "Review this item and follow up as needed: “Does this need follow-up?”";

// The `todos:` entry triage adds for a positive answer, as the file writes it.
function todoEntry(created: string, extra: string): string {
  return `  - text: "${TODO_TEXT}"
    id: ${TODO_ID}
    assigned: agent
    by: agent
    created: ${created}
    see-also:
      - ref: /_content/bills/Bills.landmark.card
${extra}`;
}

const NO_TODO_TEXT = `---
# preserve this note
title: Paper
undeclared: keep-me
---
A bill requiring review.`;

const OPTION = "destination_be9e1e5dd37949b9372eb527e3c1a5f9884211a2a477aa69db28c28011fea4ae";
const SUMMARY = "Classifier summary: /_content/bills/Bills.landmark.card; leading probability 1.000, confidence 1.000; instructions: /_config/intake.guide.card, /_content/bills/Bills.landmark.card.";

// The replay result for a recorded decision judged with todo probability `recorded`,
// re-judged with the fake classifier (which answers every question yes).
function replayResult(recorded: number) {
  return {
    id: uuid(),
    repetition: 1,
    historical: {
      todoAnswers: { [OPTION]: recorded },
      outcome: "destination",
      destinationRef: "/_content/bills/Bills.landmark.card",
      requestHash: "a".repeat(64),
      requestedModel: "fake-jev",
      returnedModel: "fake-jev",
      answer: { type: "choice", choice: OPTION, confidence: 0.9, probabilities: { [OPTION]: 0.9, "no-match": 0.05, unclear: 0.05 } },
      reason: { kind: "summary", text: "Bill", evidenceRefs: ["/_content/inbox/staged/Paper.doc.card"] },
    },
    model: "fake-jev",
    modelDrift: false,
    assertions: [],
    status: "evaluated",
    preparationChanged: false,
    candidate: {
      todoAnswers: { [OPTION]: 1 },
      outcome: "destination",
      destinationRef: "/_content/bills/Bills.landmark.card",
      requestHash: "f952fcf7dbb321fd055327246e67362521498554788da642379d2927f99a1a89",
      requestedModel: "fake-jev",
      returnedModel: "fake-jev",
      answer: { type: "choice", choice: OPTION, confidence: 1, probabilities: { [OPTION]: 1, "no-match": 0, unclear: 0 } },
      reason: { kind: "summary", text: SUMMARY, evidenceRefs: ["/_content/inbox/staged/Paper.doc.card"] },
    },
    outcomeChanged: false,
    todoOutcomeChanged: false,
    probabilityDeltas: { [OPTION]: 0.09999999999999998, "no-match": -0.05, unclear: -0.05 },
  } as const;
}

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
  const { box, evidence, instructions, destination, baseJudgment } = await receiptFixture();
  const receipt = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment: { ...baseJudgment, todoAnswers: { [destination.optionId]: 0.8 } } });
  const applied = await applyDecision({ boxRoot: box.root, decision: receipt });
  t.check(applied.application.todoAnnotation?.state, "applied");

  const target = box.path("_content/inbox/triaged/bills/Paper.doc.card");
  const annotated = await fs.readFile(target, "utf8");
  const created = await boxLocalDay(box.root);
  t.check(annotated, `---
# preserve this note
title: Paper
undeclared: keep-me
todos:
${todoEntry(created, "")}---
A bill requiring review.`);

  const appliedAgain = await applyDecision({ boxRoot: box.root, decision: receipt.id });
  t.check(appliedAgain.application.todoAnnotation, applied.application.todoAnnotation);

  const parsedAfterRepeat = await fs.readFile(target, "utf8");
  t.check(parsedAfterRepeat, annotated);

  // Completion state and later notes survive a retry unchanged.
  await setTodoStatus(box.root, { file: target, status: "done" });
  const completed = await fs.readFile(target, "utf8");
  t.check(completed, `---
title: Paper
todos:
${todoEntry(created, "    status: done\n")}---
A bill requiring review.`);
  const afterCompletionRetry = await applyDecision({ boxRoot: box.root, decision: receipt.id });
  t.check(afterCompletionRetry.application.todoAnnotation?.state, "applied");

  t.check(await fs.readFile(target, "utf8"), completed);

  const reprepared = await replayDecisions({ boxRoot: box.root, ids: [receipt.id], instructions, maxCalls: 1, prepareAgain: true, env: { BBX_JEV_FAKE: "1" } });
  t.check(reprepared.results[0], replayResult(0.8));

  await box.cleanup();
});

void test("line 110", async (t) => {
  const { box, evidence, instructions, baseJudgment } = await receiptFixture({ question: null });
  const withoutQuestion = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment: baseJudgment });
  await applyDecision({ boxRoot: box.root, decision: withoutQuestion });
  t.check(await fs.readFile(box.path("_content/inbox/triaged/bills/Paper.doc.card"), "utf8"), NO_TODO_TEXT);

  await box.cleanup();
});

void test("line 120", async (t) => {
  const { box, instructions, destination, baseJudgment } = await receiptFixture();
  await fs.writeFile(box.path("_content/inbox/staged/Paper.txt"), "Raw admitted text.");
  const rawEvidence = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/Paper.txt" });
  const raw = createDecisionReceipt({ boxRoot: box.root, evidence: rawEvidence, instructions, judgment: { ...baseJudgment, reason: { ...baseJudgment.reason, evidenceRefs: rawEvidence.parts.map((part) => part.ref) }, todoAnswers: { [destination.optionId]: 0.9 } } });
  let rawError = "";
  rawError = await capturedError(() => applyDecision({ boxRoot: box.root, decision: raw }));
  t.check(rawError, `TriageReceiptError: Triage receipt: Incomplete decision ${raw.id}: Cannot annotate triage target ${box.path("_content/inbox/staged/Paper.txt")}: positive follow-up requires a card with frontmatter`);

  const rawStillStaged = await fs.access(box.path("_content/inbox/staged/Paper.txt")).then(() => true, () => false);
  t.check(rawStillStaged, true);

  await box.cleanup();
});

void test("line 137", async (t) => {
  const { box, evidence, instructions, destination, baseJudgment } = await receiptFixture();
  const receipt = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment: { ...baseJudgment, todoAnswers: { [destination.optionId]: 0.95 } } });
  const from = box.path("_content/inbox/staged/Paper.doc.card");
  const to = box.path("_content/inbox/triaged/bills/Paper.doc.card");
  invariant(destination.todoQuestion, "Fixture destination has a todo question");
  const plan = await planTriageTodoAnnotation({ file: from, boxRoot: box.root, destinationRef: destination.ref, question: destination.todoQuestion, created: await boxLocalDay(box.root) });
  receipt.application.state = "applied";
  receipt.application.todoAnnotation = { state: "pending", todoId: plan.todoId, beforeDigest: plan.beforeDigest, afterDigest: plan.afterDigest, created: await boxLocalDay(box.root) };
  await saveDecisionReceipt(box.root, receipt);
  await movePathPreservingAnnexSymlink(from, to);
  const git = simpleGit(box.root);
  await git.add(["_content/inbox/triaged/bills/Paper.doc.card", `_bookkeeping/triage/decisions/${receipt.id}.json`]);
  await git.commit(`Route paper\n\nTriage-Decision: ${receipt.id}\nTriage-Classifier: fake-jev`);
  await fs.writeFile(to, plan.after); // Simulate a crash after the atomic todo replacement.

  const resumed = await applyDecision({ boxRoot: box.root, decision: receipt.id });
  t.check(resumed.application.todoAnnotation?.state, "applied");

  const exactReplay = await replayDecisions({ boxRoot: box.root, ids: [receipt.id], instructions, maxCalls: 1, prepareAgain: true, env: { BBX_JEV_FAKE: "1" } });
  t.check(exactReplay.results[0], replayResult(0.95));
  await box.cleanup();
});

void test("line 170", async (t) => {
  const { box, evidence, instructions, destination, baseJudgment } = await receiptFixture();
  const negative = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment: { ...baseJudgment, todoAnswers: { [destination.optionId]: 0.5 } } });
  const missing = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment: { ...baseJudgment, todoAnswers: undefined } });
  let missingError = "";
  missingError = await capturedError(() => applyDecision({ boxRoot: box.root, decision: missing }));
  t.check(missingError, `TriageReceiptError: Triage receipt: Incomplete decision ${missing.id}: Triage receipt: Missing recorded todo answer for configured destination /_content/bills/Bills.landmark.card; make the evidence readable, then prepare and judge a new decision for the held item. Retrying this correction cannot supply the missing answer`);

  await applyDecision({ boxRoot: box.root, decision: negative });
  const negativeText = await fs.readFile(box.path("_content/inbox/triaged/bills/Paper.doc.card"), "utf8");
  t.check(negativeText, NO_TODO_TEXT);

  await box.cleanup();
});

void test("line 187", async (t) => {
  const { box, evidence, instructions, destination, baseJudgment } = await receiptFixture();
  const held = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment: { ...baseJudgment, outcome: "unclear", destinationRef: null, answer: { ...baseJudgment.answer, choice: "unclear", probabilities: { [destination.optionId]: 0.1, "no-match": 0.1, unclear: 0.8 } } } });
  await applyDecision({ boxRoot: box.root, decision: held });
  const heldText = await fs.readFile(box.path("_content/inbox/triaged/_unsure/Paper.doc.card"), "utf8");
  t.check(heldText, NO_TODO_TEXT);

  const corrected = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment: { ...baseJudgment, todoAnswers: { [destination.optionId]: 0.9 } }, originalDecisionId: held.id });
  corrected.resolution = { destinationRef: destination.ref, sourceRef: "/_bookkeeping/questions/example.question.card", actor: "user" };
  corrected.application.from = held.application.to;
  corrected.application.to = "/_content/inbox/triaged/bills/Paper.doc.card";
  await saveDecisionReceipt(box.root, corrected);
  const correctedApplied = await applyDecision({ boxRoot: box.root, decision: corrected });
  t.check(correctedApplied.application.todoAnnotation?.state, "applied");

  await box.cleanup();
});

void test("line 207", async (t) => {
  const box = await makeTmpBox();
  await box.write("_content/bills/Bills.landmark.card", "---\ndestinations:\n  - for: [triage]\n    rules: Bills.\n    todo-question: Does this need follow-up?\n---\n");
  await box.write("_content/inbox/staged/Legacy.doc.card", "---\ntitle: Legacy\n---\nBill.");
  const compiled = await compileTriageInstructions(box.root);
  const category = compiled.categories[0];
  invariant(category, "Fixture needs its category");
  const response = (todo: boolean) => applyTriage({ boxRoot: box.root, categories: compiled.categories, decisions: [{ file: "Legacy.doc.card", category: category.name, confidence: "confident", reason: "Bill", todo }] });
  await response(true);
  t.check(await fs.readFile(box.path("_content/inbox/triaged/bills/Legacy.doc.card"), "utf8"), `---
title: Legacy
todos:
${todoEntry(await boxLocalDay(box.root), "")}---
Bill.`);

  await box.write("_content/inbox/staged/No.doc.card", "---\ntitle: No\n---\nBill.");
  await applyTriage({ boxRoot: box.root, categories: compiled.categories, decisions: [{ file: "No.doc.card", category: category.name, confidence: "confident", reason: "Bill", todo: false }] });
  t.check(await fs.readFile(box.path("_content/inbox/triaged/bills/No.doc.card"), "utf8"), "---\ntitle: No\n---\nBill.");

  await box.cleanup();
});

void test("line 227", async (t) => {
  const { box, destination } = await receiptFixture();
  const file = box.path("_content/inbox/staged/Paper.doc.card");
  const original = await fs.readFile(file, "utf8");
  await fs.writeFile(file, original.replace("title: Paper", "title: Paper\ntodos:\n  - id: existing\n    text: Keep this task\n    status: done\n    recheck: never\n    unknown: keep-this-too # task note"));
  invariant(destination.todoQuestion, "Fixture destination has a todo question");
  const addition = await planTriageTodoAnnotation({ file, boxRoot: box.root, destinationRef: destination.ref, question: destination.todoQuestion, created: await boxLocalDay(box.root) });
  t.check(addition.after, `---
# preserve this note
title: Paper
todos:
  - id: existing
    text: Keep this task
    status: done
    recheck: never
    unknown: keep-this-too # task note
${todoEntry(await boxLocalDay(box.root), "")}undeclared: keep-me
---
A bill requiring review.`);

  await box.cleanup();
});
