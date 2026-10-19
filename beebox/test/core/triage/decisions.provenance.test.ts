// # Recorded triage application
//
// Receipts keep evaluated inputs immutable. Application checks source and instruction
// bytes, moves card attachments, scopes its commit, and can retry without a model.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate, uuid } from "@ianbicking/tap-check/check";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execa } from "execa";
import { pathToFileURL } from "node:url";
import { simpleGit } from "simple-git";
import { invariant } from "../../../src/shared/invariant.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { prepareItem } from "../../../src/core/triage/evidence/core.js";
import { compileInstructionSnapshot } from "../../../src/core/triage/snapshot.js";
import { judgeItem } from "../../../src/core/triage/judge.js";
import { createDecisionReceipt, readDecisionReceipt, saveDecisionReceipt, listDecisionReceipts } from "../../../src/core/triage/decisions/storage.js";
import { applyDecision } from "../../../src/core/triage/decisions/apply.js";
import { confirmDecision, correctDecision } from "../../../src/core/triage/decisions/confirm.js";
import { replayDecisions } from "../../../src/core/triage/decisions/replay.js";
import { createFakeJev } from "../../../src/services/jev.js";
import { getSessionLogPath } from "../../../src/core/chat/session/transcript-paths.js";
import { movePathPreservingAnnexSymlink } from "../../../src/core/card-files/move-phase2.js";
import { parseAnnexPointer } from "../../../src/lib/annex-pointer.js";

// requestHash covers the box path, so it differs between runs.
const requestHash = any(String).matches(/^[\da-f]{64}$/);
const DESTINATION_OPTION = "destination_1e77219a5bb8541eee4d1ba3c67aa6ad35e4a5a8d4444cda711b6a2717ea1a37";

function appliedMessage(id: string, tail: string): string {
  return `Triage Paper.doc.card

Triage-Decision: ${id}
Triage-Instructions: /_config/intake.guide.card, /_content/home/Home.landmark.card
Triage-Classifier: fake-jev
Triage-Outcome: /_content/home/Home.landmark.card
Triage-Probabilities: {"${DESTINATION_OPTION}":1,"no-match":0,"unclear":0}
Triage-Confidence: 1
Triage-Todo: unasked
Triage-Todo-Question: unasked
Triage-Todo-Probability: unavailable
Triage-Todo-Source: unasked
Triage-Todo-Annotation: none

${tail}`;
}

async function fixture() {
  const box = await makeTmpBox();
  await box.write("_content/home/Home.landmark.card", "---\nsymbol:\n  glyph: H\nnavigation:\n  label: Home\ndestinations:\n  - for: [triage]\n    rules: Household papers.\n---\n");
  await box.write("_content/inbox/staged/Paper.doc.card", "---\ntitle: Paper\n---\nHousehold receipt.");
  await box.write("_content/inbox/staged/Paper.attach/detail.txt", "Household details");
  await simpleGit(box.root).add(".");
  await simpleGit(box.root).commit("Initial admitted paper");
  const evidence = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/Paper.doc.card" });
  const instructions = await compileInstructionSnapshot(box.root, {});
  const judgment = await judgeItem(box.root, { evidence, instructions, env: { BBX_JEV_FAKE: "1" } });
  return { box, evidence, instructions, judgment };
}

void test("line 39", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const { box, evidence, instructions, judgment } = await fixture();
  const receipt = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment });
  await box.write("_content/unrelated.md", "Do not claim me");
  await simpleGit(box.root).add("_content/unrelated.md");
  const applied = await applyDecision({ boxRoot: box.root, decision: receipt });
  t.check(applied.application.state, "applied");

  t.check(await fs.readFile(path.join(box.root, "_content/inbox/triaged", "home", "Paper.attach/detail.txt"), "utf8"), "Household details");

  const message = await simpleGit(box.root).raw(["log", "-1", "--format=%B"]);
  t.check(message, appliedMessage(receipt.id, ""));

  t.check((await simpleGit(box.root).raw(["diff", "--cached", "--name-only"])).trim(), "_content/unrelated.md");

  t.check((await applyDecision({ boxRoot: box.root, decision: receipt.id })).application.state, "applied");

  const changed = await readDecisionReceipt(box.root, receipt.id);
  const changedPart = changed.evidence.parts[0];
  invariant(changedPart, "receipt has an evidence part");
  changedPart.text = "Invented replacement";
  await t.checkThrows(async () => (await saveDecisionReceipt(box.root, changed)), "TriageReceiptError");

  const before = await fs.readFile(path.join(box.root, `_bookkeeping/triage/decisions/${receipt.id}.json`), "utf8");
  const replay = await replayDecisions({ boxRoot: box.root, ids: [receipt.id], instructions, compareOriginal: true, maxCalls: 2, env: { BBX_JEV_FAKE: "1" } });
  t.check(replay.plannedCalls, 2);

  const reprepared = await replayDecisions({ boxRoot: box.root, ids: [receipt.id], instructions, maxCalls: 1, prepareAgain: true, env: { BBX_JEV_FAKE: "1" } });
  t.check(reprepared.results[0]?.status, "evaluated");

  t.check(reprepared.results[0]?.preparationChanged, false);

  await fs.rm(box.path("_content/inbox/triaged/home/Paper.doc.card"));
  await fs.rm(box.path("_content/inbox/triaged/home/Paper.attach"), { recursive: true });
  const historicalPreparation = await replayDecisions({ boxRoot: box.root, ids: [receipt.id], instructions, maxCalls: 1, prepareAgain: true, env: { BBX_JEV_FAKE: "1" } });
  t.check(historicalPreparation.results[0]?.status, "evaluated");

  const substituted = createFakeJev();
  const originalJudge = substituted.judge.bind(substituted);
  substituted.judge = async (input) => ({ ...await originalJudge(input), model: "provider-substitute" });
  const drift = await replayDecisions({ boxRoot: box.root, ids: [receipt.id], instructions, maxCalls: 1, jev: substituted });
  t.check(drift.results[0]?.status, "unavailable");

  t.check(drift.results[0], {
    id: uuid(),
    repetition: 1,
    historical: {
      outcome: "destination",
      destinationRef: "/_content/home/Home.landmark.card",
      requestHash,
      requestedModel: "typesafe/jev-1.13",
      returnedModel: "fake-jev",
      answer: {
        type: "choice",
        choice: DESTINATION_OPTION,
        confidence: 1,
        probabilities: { [DESTINATION_OPTION]: 1, "no-match": 0, unclear: 0 },
      },
      reason: {
        kind: "summary",
        text: "Classifier summary: /_content/home/Home.landmark.card; leading probability 1.000, confidence 1.000; instructions: /_config/intake.guide.card, /_content/home/Home.landmark.card.",
        evidenceRefs: ["/_content/inbox/staged/Paper.doc.card", "/_content/inbox/staged/Paper.attach/detail.txt"],
      },
    },
    model: "fake-jev",
    modelDrift: false,
    assertions: [],
    status: "unavailable",
    preparationChanged: false,
    candidate: {
      todoAnswers: undefined,
      outcome: "unclear",
      destinationRef: null,
      requestHash,
      requestedModel: "fake-jev",
      returnedModel: "provider-substitute",
      answer: {
        type: "choice",
        choice: DESTINATION_OPTION,
        confidence: 0,
        probabilities: { [DESTINATION_OPTION]: 1 / 3, "no-match": 1 / 3, unclear: 1 / 3 },
      },
      reason: {
        kind: "summary",
        text: "Classifier summary: unclear (tied leading options); leading probability 0.333, confidence 0.000; instructions: /_config/intake.guide.card, /_content/home/Home.landmark.card.",
        evidenceRefs: ["/_content/inbox/staged/Paper.doc.card", "/_content/inbox/staged/Paper.attach/detail.txt"],
      },
    },
    error: "Triage receipt: Pinned model fake-jev was substituted by the provider",
  });

  const noModelReceipt = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment: { ...judgment, outcome: "unclear", destinationRef: null, requestHash: null, requestedModel: null, returnedModel: null, answer: null } });
  await saveDecisionReceipt(box.root, noModelReceipt);
  const mixedReplay = await replayDecisions({ boxRoot: box.root, ids: [noModelReceipt.id, receipt.id], instructions, maxCalls: 1, env: { BBX_JEV_FAKE: "1" } });
  t.check(mixedReplay.plannedCalls, 1);

  t.check(mixedReplay.results.map((result) => result.status), [
    "unavailable",
    "evaluated",
  ]);

  t.check(await fs.readFile(path.join(box.root, `_bookkeeping/triage/decisions/${receipt.id}.json`), "utf8"), before);

  await t.checkThrows(async () => (await replayDecisions({ boxRoot: box.root, ids: [receipt.id], instructions, compareOriginal: true, maxCalls: 1, env: { BBX_JEV_FAKE: "1" } })), "TriageReceiptError");
});

// Fixed evidence remains replayable when a Git-annex object is absent, while
// repreparation reports that the original bytes cannot be recovered.
void test("Fixed evidence remains replayable when a Git-annex object is absent, while re...", async (t) => {
  t.teardown(async () => {
    try {
      await annexBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const annexBox = await makeTmpBox({ git: true });
  await annexBox.write("_content/home/Home.landmark.card", "---\nsymbol:\n  glyph: H\nnavigation:\n  label: Home\ndestinations:\n  - for: [triage]\n    rules: Household papers.\n---\n");
  await simpleGit(annexBox.root).add("_content/home/Home.landmark.card");
  await simpleGit(annexBox.root).commit("Add triage instructions");
  await annexBox.write("_content/inbox/staged/Paper.doc.card", "---\ntitle: Paper\n---\nHousehold receipt.");
  await annexBox.write("_content/inbox/staged/Paper.attach/photo.png", Buffer.from("synthetic image bytes"));
  await execa("git", ["annex", "add", "--", "_content/inbox/staged/Paper.attach/photo.png"], { cwd: annexBox.root });
  await execa("git", ["annex", "unlock", "--", "_content/inbox/staged/Paper.attach/photo.png"], { cwd: annexBox.root });

  const annexEvidence = await prepareItem({ boxRoot: annexBox.root, sourceRef: "/_content/inbox/staged/Paper.doc.card" });
  const annexInstructions = await compileInstructionSnapshot(annexBox.root, {});
  const annexJudgment = await judgeItem(annexBox.root, { evidence: annexEvidence, instructions: annexInstructions, env: { BBX_JEV_FAKE: "1" } });
  const heldJudgment = { ...annexJudgment, outcome: "unclear" as const, destinationRef: null };
  const annexReceipt = createDecisionReceipt({ boxRoot: annexBox.root, evidence: annexEvidence, instructions: annexInstructions, judgment: heldJudgment });
  await saveDecisionReceipt(annexBox.root, annexReceipt);
  await applyDecision({ boxRoot: annexBox.root, decision: annexReceipt.id });
  const applicationCommit = (await simpleGit(annexBox.root).raw(["rev-parse", "HEAD"])).trim();
  t.check(parseAnnexPointer(await simpleGit(annexBox.root).binaryCatFile(["blob", `${applicationCommit}:_content/inbox/triaged/_unsure/Paper.attach/photo.png`])), {
    key: "SHA256E-s21--9d714b0153c5204b5503770a41d5800ed8ba4e24da1a9429b6654397075031b6.png",
    backend: "SHA256E",
    size: 21,
    sha256: "9d714b0153c5204b5503770a41d5800ed8ba4e24da1a9429b6654397075031b6",
  });

  const heldPath = annexBox.path("_content/inbox/triaged/_unsure/Paper.doc.card");
  const archivePath = annexBox.path("_content/archive/Paper.doc.card");
  await fs.mkdir(path.dirname(archivePath), { recursive: true });
  await movePathPreservingAnnexSymlink(heldPath, archivePath);
  await movePathPreservingAnnexSymlink(annexBox.path("_content/inbox/triaged/_unsure/Paper.attach"), annexBox.path("_content/archive/Paper.attach"));
  await simpleGit(annexBox.root).add(".");
  await simpleGit(annexBox.root).commit("Handler filed paper after triage");
  const selectedAnnexDestination = annexInstructions.destinations[0];
  await annexBox.write("_bookkeeping/questions/AnnexConfirm.question.card", `---\nanswered-at: '2026-09-28T12:00:00Z'\nanswered-via: web\nanswer:\n  text: Home\n  selected: ${selectedAnnexDestination?.optionId}\n---\n`);
  await confirmDecision({ boxRoot: annexBox.root, id: annexReceipt.id, sourceRef: "/_bookkeeping/questions/AnnexConfirm.question.card", label: selectedAnnexDestination?.ref ?? "" });
  const annexHistoricalReplay = await replayDecisions({ boxRoot: annexBox.root, ids: [annexReceipt.id], instructions: annexInstructions, maxCalls: 1, prepareAgain: true, env: { BBX_JEV_FAKE: "1" } });
  t.check(annexHistoricalReplay.results[0]?.status, "evaluated");

  t.check(annexHistoricalReplay.results[0]?.error ?? "none", "none");

  await execa("git", ["annex", "drop", "--force", "--", "_content/archive/Paper.attach/photo.png"], { cwd: annexBox.root });
  const fixedReplay = await replayDecisions({ boxRoot: annexBox.root, ids: [annexReceipt.id], instructions: annexInstructions, maxCalls: 1, env: { BBX_JEV_FAKE: "1" } });
  t.check(fixedReplay.results[0]?.status, "evaluated");

  const missingObjectReplay = await replayDecisions({ boxRoot: annexBox.root, ids: [annexReceipt.id], instructions: annexInstructions, maxCalls: 1, prepareAgain: true, env: { BBX_JEV_FAKE: "1" } });
  t.check(missingObjectReplay.results[0]?.status, "unavailable");

  t.check(missingObjectReplay.results[0], {
    id: uuid(),
    repetition: 1,
    historical: {
      outcome: "unclear",
      destinationRef: null,
      requestHash,
      requestedModel: "typesafe/jev-1.13",
      returnedModel: "fake-jev",
      answer: {
        type: "choice",
        choice: DESTINATION_OPTION,
        confidence: 1,
        probabilities: { [DESTINATION_OPTION]: 1, "no-match": 0, unclear: 0 },
      },
      reason: {
        kind: "summary",
        text: "Classifier summary: /_content/home/Home.landmark.card; leading probability 1.000, confidence 1.000; instructions: /_config/intake.guide.card, /_content/home/Home.landmark.card.",
        evidenceRefs: ["/_content/inbox/staged/Paper.doc.card", "/_content/inbox/staged/Paper.attach/photo.png"],
      },
    },
    model: "fake-jev",
    modelDrift: false,
    assertions: [
      {
        label: "/_content/home/Home.landmark.card",
        actor: "user",
        sourceRef: "/_bookkeeping/questions/AnnexConfirm.question.card",
        at: isoDate(),
      },
    ],
    status: "unavailable",
    error: "Triage receipt: prepare-again unavailable: could not recover /_content/inbox/staged/Paper.attach/photo.png: Triage receipt: local Git-annex object is missing for _content/inbox/triaged/_unsure/Paper.attach/photo.png",
  });
});

// Prepare-again can recover an admitted card from its application commit when it
// was not present in the preparation revision and has since moved again.
void test("Prepare-again can recover an admitted card from its application commit when i...", async (t) => {
  t.teardown(async () => {
    try {
      await freshBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const freshBox = await makeTmpBox();
  await freshBox.write("_content/home/Home.landmark.card", "---\nsymbol:\n  glyph: H\nnavigation:\n  label: Home\ndestinations:\n  - for: [triage]\n    rules: Household papers.\n---\n");
  await freshBox.write("_content/inbox/staged/New.doc.card", "---\ntitle: New\n---\nNew admitted receipt.");
  const freshEvidence = await prepareItem({ boxRoot: freshBox.root, sourceRef: "/_content/inbox/staged/New.doc.card" });
  t.check(freshEvidence.source.gitRevision, null);

  const freshInstructions = await compileInstructionSnapshot(freshBox.root, {});
  const freshJudgment = await judgeItem(freshBox.root, { evidence: freshEvidence, instructions: freshInstructions, env: { BBX_JEV_FAKE: "1" } });
  const freshReceipt = createDecisionReceipt({ boxRoot: freshBox.root, evidence: freshEvidence, instructions: freshInstructions, judgment: freshJudgment });
  await applyDecision({ boxRoot: freshBox.root, decision: freshReceipt });
  await fs.mkdir(freshBox.path("_content/archive"), { recursive: true });
  await fs.rename(freshBox.path("_content/inbox/triaged/home/New.doc.card"), freshBox.path("_content/archive/New.doc.card"));
  await simpleGit(freshBox.root).add(".");
  await simpleGit(freshBox.root).commit("Handler filed new paper");
  const freshDestination = freshInstructions.destinations.find((item) => item.ref === freshJudgment.destinationRef);
  await freshBox.write("_bookkeeping/questions/FreshConfirm.question.card", `---\nanswered-at: '2026-09-28T12:00:00Z'\nanswered-via: web\nanswer:\n  text: Home\n  selected: ${freshDestination?.optionId}\n---\n`);
  await confirmDecision({ boxRoot: freshBox.root, id: freshReceipt.id, sourceRef: "/_bookkeeping/questions/FreshConfirm.question.card", label: freshDestination?.ref ?? "" });
  const recoveredReplay = await replayDecisions({ boxRoot: freshBox.root, ids: [freshReceipt.id], instructions: freshInstructions, maxCalls: 1, prepareAgain: true, env: { BBX_JEV_FAKE: "1" } });
  t.check(recoveredReplay.results[0]?.status, "evaluated");

  await freshBox.cleanup();
});

// Changed attachments cannot be silently admitted by an old receipt.
void test("Changed attachments cannot be silently admitted by an old receipt.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const { box, evidence, instructions, judgment } = await fixture();
  const receipt = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment });
  await box.write("_content/inbox/staged/Paper.attach/new.txt", "Added after judgment");
  await t.checkThrows(async () => (await applyDecision({ boxRoot: box.root, decision: receipt })), "InvariantError");

  t.check(await fs.readFile(path.join(box.root, "_content/inbox/staged/Paper.doc.card"), "utf8"), evidence.parts[0]?.text);
});

// An answered CLI question is an agent assertion. Missing legacy channel is unknown;
// only an actual web answer or cited user turn can enter the confirmed set.
void test("An answered CLI question is an agent assertion.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const { box, evidence, instructions, judgment } = await fixture();
  const held = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment: { ...judgment, outcome: "unclear", destinationRef: null } });
  await applyDecision({ boxRoot: box.root, decision: held });
  const questionRef = held.application.questionRef;
  const destination = instructions.destinations[0];
  invariant(questionRef, "held decision records a question");
  invariant(destination, "fixture box has a destination");
  await box.write(questionRef.slice(1), `---\nanswered-at: '2026-09-28T12:00:00Z'\nanswered-via: cli\nanswer:\n  text: Home\n  selected: ${destination.optionId}\n---\n`);
  const corrected = await correctDecision({ boxRoot: box.root, id: held.id, questionRef });
  t.check(corrected.outcomes[0]?.actor, "agent");

  t.check((await correctDecision({ boxRoot: box.root, id: held.id, questionRef })).id, corrected.id);

  t.check(corrected.judgment.outcome, "unclear");

  t.check(corrected.resolution?.destinationRef, destination.ref);

  t.check(await listDecisionReceipts(box.root, { outcome: "user-confirmed" }), []);

  await box.write("_bookkeeping/questions/Legacy.question.card", `---\nanswered-at: '2026-09-28T12:00:00Z'\nanswer:\n  text: Home\n  selected: ${destination.optionId}\n---\n`);
  const legacy = await confirmDecision({ boxRoot: box.root, id: corrected.id, sourceRef: "/_bookkeeping/questions/Legacy.question.card", label: destination.ref });
  t.check(legacy.outcomes.at(-1)?.actor, "unknown");

  await box.write("_bookkeeping/questions/Web.question.card", `---\nanswered-at: '2026-09-28T12:00:00Z'\nanswered-via: web\nanswer:\n  text: Home\n  selected: ${destination.optionId}\n---\n`);
  await box.write("_bookkeeping/questions/Mismatch.question.card", "---\nanswered-at: '2026-09-28T12:00:00Z'\nanswered-via: web\nanswer:\n  text: Not home\n  selected: some-other-option\n---\n");
  await t.checkThrows(async () => (await confirmDecision({ boxRoot: box.root, id: corrected.id, sourceRef: "/_bookkeeping/questions/Mismatch.question.card", label: destination.ref })), "TriageReceiptError");

  await confirmDecision({ boxRoot: box.root, id: corrected.id, sourceRef: "/_bookkeeping/questions/Web.question.card", label: destination.ref });
  t.check((await listDecisionReceipts(box.root, { outcome: "user-confirmed" })).map((receipt) => receipt.id), [corrected.id]);

  const previousProjectsDir = process.env["BBX_CLAUDE_PROJECTS_DIR"];
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("projects");
  const sessionId = "78787878-7878-4787-8787-787878787878";
  const turnId = "87878787-8787-4878-8787-878787878787";
  const chatRef = `/_content/chat/web/2026-09-28_${sessionId.slice(0, 8)}.chat.card`;
  await box.write(chatRef.slice(1), `---\ntype: chat\nsession: ${sessionId}\ntitle: Placement decision\n---\n`);
  const transcript = getSessionLogPath(box.root, sessionId);
  await fs.mkdir(path.dirname(transcript), { recursive: true });
  await fs.writeFile(transcript, `${JSON.stringify({ type: "user", uuid: turnId, timestamp: "2026-09-28T12:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "<typed>Please put this in Home.</typed>" }] } })}\n`);
  const humanRef = `${chatRef}#${turnId}`;
  t.check((await confirmDecision({ boxRoot: box.root, id: corrected.id, sourceRef: humanRef, label: destination.ref })).outcomes.at(-1)?.actor, "user");

  await fs.writeFile(transcript, `${JSON.stringify({ type: "user", uuid: turnId, timestamp: "2026-09-28T12:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "<typed>Yes.</typed>" }] } })}\n`);
  await t.checkThrows(async () => (await confirmDecision({ boxRoot: box.root, id: corrected.id, sourceRef: humanRef, label: destination.ref })), "TriageReceiptError");

  await fs.writeFile(transcript, `${JSON.stringify({ type: "user", uuid: turnId, timestamp: "2026-09-28T12:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "<typed>Homeward is the direction I was thinking.</typed>" }] } })}\n`);
  await t.checkThrows(async () => (await confirmDecision({ boxRoot: box.root, id: corrected.id, sourceRef: humanRef, label: destination.ref })), "TriageReceiptError");

  if (previousProjectsDir === undefined) delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
  else process.env["BBX_CLAUDE_PROJECTS_DIR"] = previousProjectsDir;
});

// Cards without an attachment directory can be applied and corrected; the absent
// scope does not turn either operation into an incomplete receipt.
void test("Cards without an attachment directory can be applied and corrected; the absen...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const { box, instructions } = await fixture();
  await fs.rm(box.path("_content/inbox/staged/Paper.attach"), { recursive: true });
  await simpleGit(box.root).add(".");
  await simpleGit(box.root).commit("Remove optional attachment scope");
  const evidence = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/Paper.doc.card" });
  const judgment = await judgeItem(box.root, { evidence, instructions, env: { BBX_JEV_FAKE: "1" } });
  const held = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment: { ...judgment, outcome: "unclear", destinationRef: null } });
  t.check((await applyDecision({ boxRoot: box.root, decision: held })).application.state, "applied");

  const selected = instructions.destinations[0];
  await box.write(held.application.questionRef?.slice(1) ?? "", `---\nanswered-at: '2026-09-28T12:00:00Z'\nanswered-via: cli\nanswer:\n  text: Home\n  selected: ${selected?.optionId}\n---\n`);
  t.check((await correctDecision({ boxRoot: box.root, id: held.id, questionRef: held.application.questionRef ?? "" })).application.state, "applied");

  t.check(await fs.access(box.path("_content/inbox/triaged/home/Paper.doc.card")), undefined);
});

// Interrupted attachment moves and failed commits are explicit and retryable. A
// raw sweep without trailers gets a nonempty provenance completion commit.
void test("Interrupted attachment moves and failed commits are explicit and retryable.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const { box, evidence, instructions, judgment } = await fixture();
  const receipt = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment });
  await saveDecisionReceipt(box.root, receipt);
  await fs.mkdir(path.dirname(box.path(receipt.application.to.slice(1))), { recursive: true });
  await fs.rename(box.path(receipt.application.from.slice(1)), box.path(receipt.application.to.slice(1)));
  const hook = box.path(".git/hooks/pre-commit");
  await fs.writeFile(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  await t.checkThrows(async () => (await applyDecision({ boxRoot: box.root, decision: receipt.id })), "TriageReceiptError");

  t.check((await readDecisionReceipt(box.root, receipt.id)).application.state, "incomplete");

  await fs.rm(hook);
  t.check((await applyDecision({ boxRoot: box.root, decision: receipt.id })).application.state, "applied");

  await simpleGit(box.root).raw(["commit", "--amend", "-m", "Raw sweep without provenance"]);
  const head = (await simpleGit(box.root).raw(["rev-parse", "HEAD"])).trim();
  await applyDecision({ boxRoot: box.root, decision: receipt.id });
  t.check((await readDecisionReceipt(box.root, receipt.id)).provenanceRepair, { observedCommit: head, at: isoDate() });

  t.check(await simpleGit(box.root).raw(["log", "-1", "--format=%B"]), appliedMessage(receipt.id, ""));
});

// Independent processes applying the same decision serialize on the item lock,
// produce one application commit, and both observe the completed receipt.
void test("Independent processes applying the same decision serialize on the item lock,...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const { box, evidence, instructions, judgment } = await fixture();
  const receipt = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment });
  await saveDecisionReceipt(box.root, receipt);
  const moduleUrl = pathToFileURL(path.resolve("src/core/triage/decisions/apply.ts")).href;
  const script = `import { applyDecision } from ${JSON.stringify(moduleUrl)}; await applyDecision({boxRoot:process.argv[1],decision:process.argv[2]});`;
  const results = await Promise.allSettled([1, 2].map(() => execa(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, box.root, receipt.id])));
  t.check(results.map((result) => result.status), [
    "fulfilled",
    "fulfilled",
  ]);

  const messages = await simpleGit(box.root).raw(["log", "--format=%B"]);
  t.check(messages, appliedMessage(receipt.id, "Initial admitted paper\n\n"));
});
