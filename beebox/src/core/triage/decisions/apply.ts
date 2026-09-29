/** Apply a recorded decision without repeating the classifier. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { simpleGit } from "simple-git";
import { withFileLock } from "../../../lib/file-lock.js";
import { withCardLock } from "../../../lib/card-lock.js";
import { writeFileAtomic } from "../../../lib/atomic-write.js";
import { withBoxGitLock, stageAndCommitPaths } from "../../../lib/git/core.js";
import { getBoxTimeISO } from "../../../lib/time.js";
import { attachDirFor } from "../../../shared/attach-path.js";
import { errorMessage, errnoCode } from "../../../shared/error-guards.js";
import { createSelectQuestionTemplate } from "../../../schemas/question.js";
import { verifyEvidence, type Evidence } from "../evidence/core.js";
import { compileInstructionSnapshot } from "../snapshot.js";
import { movePathPreservingAnnexSymlink } from "../../card-files/move-phase2.js";
import { getTriageTodoDate, planTriageTodoAnnotation } from "../todo.js";
import { decisionReceiptSchema, assertContained, receiptRef, receiptFingerprint, containedPath, readDecisionReceipt, saveDecisionReceipt, withDecisionReceiptLock, TriageReceiptError, type DecisionReceipt } from "./storage.js";

async function exists(file: string): Promise<boolean> {
  // Keep lstat semantics instead of lib/file-exists: broken links count as present and EACCES must propagate.
  try { await fs.lstat(file); return true; } catch (error) {
    if (errnoCode(error) !== "ENOENT") throw error;
    return false; // Missing old paths are expected after a successful rename.
  }
}
function movedRef(ref: string, receipt: DecisionReceipt): string {
  const { from, to } = receipt.application;
  if (ref === receipt.evidence.source.ref) return to;
  const oldAttach = receipt.evidence.source.attachmentRef;
  if (oldAttach && ref.startsWith(`${oldAttach}/`)) return `${attachDirFor(to)}${ref.slice(oldAttach.length)}`;
  if (ref === from) return to;
  return ref;
}
function matchesRecordedDigest(input: { partRef: string; digest: string; receipt: DecisionReceipt; actualDigest: string }): boolean {
  const { partRef, digest, receipt, actualDigest } = input;
  if (actualDigest === digest) return true;
  const annotation = receipt.application.todoAnnotation;
  return annotation?.state === "pending" && partRef === receipt.evidence.source.ref && (actualDigest === annotation.beforeDigest || actualDigest === annotation.afterDigest);
}
async function validateBytes(boxRoot: string, receipt: DecisionReceipt): Promise<void> {
  const verifiedParts: Evidence["parts"] = [];
  const refs = [{ ref: receipt.evidence.source.ref, digest: receipt.evidence.source.digest }, ...receipt.evidence.parts];
  for (const part of refs) {
    const originalAttach = receipt.evidence.source.attachmentRef;
    const oldRef = part.ref === receipt.evidence.source.ref ? receipt.application.from : originalAttach ? part.ref.replace(`${originalAttach}/`, `${attachDirFor(receipt.application.from)}/`) : part.ref;
    const newRef = movedRef(part.ref, receipt);
    const oldPath = containedPath(boxRoot, oldRef);
    const newPath = containedPath(boxRoot, newRef);
    const oldExists = await exists(oldPath);
    const newExists = oldPath === newPath ? oldExists : await exists(newPath);
    if (oldPath !== newPath && oldExists && newExists) throw new TriageReceiptError({ detail: `Collision: both ${oldRef} and ${newRef} exist` });
    if (!oldExists && !newExists) throw new TriageReceiptError({ detail: `stale-decision: missing ${oldRef}; replay or repair the source` });
    const bytes = await fs.readFile(oldExists ? oldPath : newPath);
    const actualDigest = hash(bytes);
    if (!matchesRecordedDigest({ partRef: part.ref, digest: part.digest, receipt, actualDigest })) throw new TriageReceiptError({ detail: `stale-decision: changed ${part.ref}; replay before applying` });
  }
  for (const part of receipt.evidence.parts) {
    const target = movedRef(part.ref, receipt);
    const originalAttach = receipt.evidence.source.attachmentRef;
    const prior = part.ref === receipt.evidence.source.ref ? receipt.application.from : originalAttach ? part.ref.replace(`${originalAttach}/`, `${attachDirFor(receipt.application.from)}/`) : part.ref;
    const ref = await exists(containedPath(boxRoot, target)) ? target : prior;
    verifiedParts.push({ ...part, ref });
  }
  const sourceRef = await exists(containedPath(boxRoot, receipt.application.to)) ? receipt.application.to : receipt.application.from;
  const attachmentRef = receipt.evidence.source.attachmentRef === null ? null : await exists(containedPath(boxRoot, attachDirFor(receipt.application.to))) ? attachDirFor(receipt.application.to) : attachDirFor(receipt.application.from);
  const evidence = { ...receipt.evidence, source: { ...receipt.evidence.source, ref: sourceRef, attachmentRef }, parts: verifiedParts };
  if (receipt.application.todoAnnotation?.state === "pending") {
    const sourcePart = verifiedParts.find((part) => part.ref === sourceRef);
    const sourceDigest = hash(await fs.readFile(containedPath(boxRoot, sourceRef)));
    if (sourcePart) sourcePart.digest = sourceDigest;
    evidence.source.digest = sourceDigest;
  }
  await verifyEvidence(boxRoot, evidence);
}
async function repairMovedAnnexPaths(opts: { boxRoot: string; receipt: DecisionReceipt; storedReceipt: boolean }): Promise<void> {
  const { boxRoot, receipt, storedReceipt } = opts;
  if (!storedReceipt) return;
  const { from, to } = receipt.application;
  const source = containedPath(boxRoot, from);
  const destination = containedPath(boxRoot, to);
  if (!await exists(source) && await exists(destination)) await movePathPreservingAnnexSymlink(source, destination);
  if (!receipt.evidence.source.attachmentRef) return;
  const oldAttach = containedPath(boxRoot, attachDirFor(from));
  const newAttach = containedPath(boxRoot, attachDirFor(to));
  if (!await exists(oldAttach) && await exists(newAttach)) await movePathPreservingAnnexSymlink(oldAttach, newAttach);
}
function todoTrailers(receipt: DecisionReceipt): Record<string, string> {
  const destinationRef = receipt.resolution?.destinationRef ?? receipt.judgment.destinationRef;
  const todoDestination = receipt.instructions.destinations.find((destination) => destination.ref === destinationRef);
  const todoAnswer = todoDestination?.todoQuestion ? receipt.judgment.todoAnswers?.[todoDestination.optionId] : undefined;
  return {
    "Triage-Todo": todoDestination?.todoQuestion ? todoAnswer === undefined ? "unavailable" : todoAnswer > 0.5 ? "yes" : "no" : "unasked",
    "Triage-Todo-Question": todoDestination?.todoQuestion?.replace(/\s+/g, " ").trim() ?? "unasked",
    "Triage-Todo-Probability": todoAnswer === undefined ? "unavailable" : String(todoAnswer),
    "Triage-Todo-Source": todoDestination?.todoQuestion ? todoDestination.ref : "unasked",
    "Triage-Todo-Annotation": receipt.application.todoAnnotation?.todoId ?? "none",
  };
}
function trailers(receipt: DecisionReceipt): Record<string, string> {
  return {
    "Triage-Decision": receipt.id,
    "Triage-Instructions": receipt.instructions.sources.map((s) => s.ref).join(", ") || "built-in",
    "Triage-Classifier": receipt.resolution?.actor ?? receipt.judgment.returnedModel ?? "unavailable",
    "Triage-Outcome": receipt.resolution?.destinationRef ?? receipt.judgment.destinationRef ?? receipt.judgment.outcome,
    "Triage-Probabilities": JSON.stringify(receipt.judgment.answer?.probabilities ?? null),
    "Triage-Confidence": String(receipt.judgment.answer?.confidence ?? "unavailable"),
    ...todoTrailers(receipt),
    ...(receipt.originalDecisionId ? { "Triage-Corrects": receipt.originalDecisionId } : {}),
  };
}
async function writeQuestion(boxRoot: string, receipt: DecisionReceipt): Promise<void> {
  if (!receipt.application.questionRef) return;
  const file = containedPath(boxRoot, receipt.application.questionRef);
  if (await exists(file)) return;
  const content = createSelectQuestionTemplate({
    memo: `${receipt.judgment.outcome === "no-match" ? "No destination fit this item." : "The destination is unclear."}\n\n${receipt.judgment.reason.text}\n\nHeld at: ${receipt.application.to}`,
    prompt: `Where does ${path.basename(receipt.application.to)} belong?`,
    options: [...receipt.instructions.destinations.map((d) => ({ id: d.optionId, label: d.name })), { id: "_other", label: "Other: give a directive" }],
    askedAt: getBoxTimeISO(boxRoot),
    directive: `Run bbx triage correct ${receipt.id} --question ${receipt.application.questionRef}. Free-text directives require grounded research.`,
    learning: { sink: "guide", proposal: "Consider a candidate instruction overlay and replay this correction plus confirmed boundary neighbors before promoting a general rule; see triage-instructions.md." },
  });
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, { flag: "wx" });
}
async function commitReceipt(boxRoot: string, receipt: DecisionReceipt): Promise<void> {
  const { from, to, questionRef } = receipt.application;
  const paths = [from, to, receiptRef(receipt.id), ...(questionRef ? [questionRef] : [])];
  if (receipt.evidence.source.attachmentRef) paths.push(attachDirFor(from), attachDirFor(to));
  paths.push(`${from}.probable.txt`);
  const git = simpleGit(boxRoot);
  const relativePaths: string[] = [];
  for (const ref of paths) {
    const rel = path.relative(boxRoot, containedPath(boxRoot, ref));
    if (await exists(containedPath(boxRoot, ref)) || (await git.raw(["ls-files", "--", rel])).trim()) relativePaths.push(rel);
  }
  const expected = trailers(receipt);
  const options = { message: `Triage ${path.basename(from)}`, paths: relativePaths, trailers: expected };
  let commit = await stageAndCommitPaths(boxRoot, options);
  if (!commit) commit = (await git.raw(["log", "-1", "--format=%H", "--", ...relativePaths])).trim();
  const message = commit ? await git.raw(["show", "-s", "--format=%B", commit]) : "";
  if (Object.entries(expected).every(([key, value]) => message.includes(`${key}: ${value}\n`))) return;
  receipt.provenanceRepair = { observedCommit: commit, at: getBoxTimeISO(boxRoot) };
  await saveDecisionReceipt(boxRoot, receipt);
  const repaired = await stageAndCommitPaths(boxRoot, options);
  const repairedMessage = repaired ? await git.raw(["show", "-s", "--format=%B", repaired]) : "";
  if (!repaired || !Object.entries(expected).every(([key, value]) => repairedMessage.includes(`${key}: ${value}\n`))) throw new TriageReceiptError({ detail: "Could not commit required triage provenance; retry apply" });
}
function validateApplicationTarget(receipt: DecisionReceipt): void {
  const destinationRef = receipt.resolution?.destinationRef ?? receipt.judgment.destinationRef;
  const category = receipt.instructions.destinations.find((destination) => destination.ref === destinationRef)?.name ?? "_unsure";
    const expectedTo = `/_content/inbox/triaged/${category}/${path.basename(receipt.evidence.source.ref)}`;
  if (!/^[\w.-]+$/.test(category) || category === "." || category === "..") throw new TriageReceiptError({ detail: "Unsafe destination category" });
  const expectedQuestion = category === "_unsure" ? `/_bookkeeping/questions/Triage_${receipt.id}.question.card` : undefined;
  if (receipt.application.questionRef !== expectedQuestion) throw new TriageReceiptError({ detail: "Question ref does not match decision identity" });
  if (receipt.application.to !== expectedTo) throw new TriageReceiptError({ detail: "Receipt application target does not match destination" });
}
function selectedTodo(receipt: DecisionReceipt): { destinationRef: string; question: string; positive: boolean } | undefined {
  const destinationRef = receipt.resolution?.destinationRef ?? receipt.judgment.destinationRef;
  if (!destinationRef) return undefined;
  const destination = receipt.instructions.destinations.find((candidate) => candidate.ref === destinationRef);
  if (!destination?.todoQuestion) return undefined;
  const answer = receipt.judgment.todoAnswers?.[destination.optionId];
  if (answer === undefined) throw new TriageReceiptError({ detail: `Missing recorded todo answer for configured destination ${destinationRef}; make the evidence readable, then prepare and judge a new decision for the held item. Retrying this correction cannot supply the missing answer` });
  return { destinationRef: destination.ref, question: destination.todoQuestion, positive: answer > 0.5 };
}
function hash(content: Buffer | string): string { return createHash("sha256").update(content).digest("hex"); }
async function applyTodoAnnotation(boxRoot: string, receipt: DecisionReceipt): Promise<void> {
  const selected = selectedTodo(receipt);
  if (!selected?.positive) return;
  const target = containedPath(boxRoot, receipt.application.to);
  let annotation = receipt.application.todoAnnotation;
  if (annotation?.state === "applied") return;
  const current = await fs.readFile(target);
  const currentDigest = hash(current);
  if (annotation?.state === "pending" && currentDigest === annotation.afterDigest) {
    annotation.state = "applied";
    await saveDecisionReceipt(boxRoot, receipt);
    return;
  }
  const created = annotation?.created ?? await getTriageTodoDate(boxRoot);
  const plan = await planTriageTodoAnnotation({ file: target, boxRoot, destinationRef: selected.destinationRef, question: selected.question, created });
  if (!annotation) {
    annotation = { state: "pending", todoId: plan.todoId, beforeDigest: plan.beforeDigest, afterDigest: plan.afterDigest, created };
    receipt.application.todoAnnotation = annotation;
    await saveDecisionReceipt(boxRoot, receipt);
  }
  if (plan.todoId !== annotation.todoId || plan.beforeDigest !== annotation.beforeDigest || plan.afterDigest !== annotation.afterDigest || currentDigest !== annotation.beforeDigest) {
    throw new TriageReceiptError({ detail: "Todo annotation target changed outside its recorded before/after bytes" });
  }
  await writeFileAtomic(target, { content: plan.after });
  annotation.state = "applied";
  await saveDecisionReceipt(boxRoot, receipt);
}
async function hasCommittedTodoAnnotation(boxRoot: string, receipt: DecisionReceipt): Promise<boolean> {
  const annotation = receipt.application.todoAnnotation;
  if (!annotation) return false;
  const git = simpleGit(boxRoot);
  const found = (await git.raw(["log", "--all-match", "--format=%H", "--fixed-strings", "--grep", `Triage-Decision: ${receipt.id}`, "--grep", `Triage-Todo-Annotation: ${annotation.todoId}`])).trim();
  const relative = path.relative(boxRoot, containedPath(boxRoot, receipt.application.to));
  for (const revision of found ? found.split("\n") : []) {
    try {
      const bytes = await git.binaryCatFile(["blob", `${revision}:${relative}`]);
      if (hash(bytes) === annotation.afterDigest) return true;
    } catch (_error) { /* Older application commits may not contain the routed target yet. */ }
  }
  return false;
}
async function validateInstructionState(opts: { boxRoot: string; receipt: DecisionReceipt; storedReceipt: boolean }): Promise<void> {
  const { boxRoot, receipt, storedReceipt } = opts;
  if (storedReceipt && !receipt.resolution) return;
  const current = await compileInstructionSnapshot(boxRoot, {});
  if (!storedReceipt && !receipt.resolution && JSON.stringify(current.sources) !== JSON.stringify(receipt.instructions.sources)) throw new TriageReceiptError({ detail: "stale-decision: instructions changed; replay before applying" });
  if (!receipt.resolution) return;
  const recorded = receipt.instructions.destinations.find((destination) => destination.ref === receipt.resolution?.destinationRef);
  const live = current.destinations.find((destination) => destination.ref === receipt.resolution?.destinationRef);
  if (!recorded || !live || recorded.name !== live.name) throw new TriageReceiptError({ detail: "Correction destination is no longer current or its filing name changed" });
}
async function validateApplication(boxRoot: string, { receipt, storedReceipt }: { receipt: DecisionReceipt; storedReceipt: boolean }): Promise<void> {
  if (!receipt.evidence.source.ref.startsWith("/_content/")) throw new TriageReceiptError({ detail: "Only admitted content can be triaged" });
  const expectedFrom = receipt.originalDecisionId ? (await readDecisionReceipt(boxRoot, receipt.originalDecisionId)).application.to : receipt.evidence.source.ref;
  if (receipt.application.from !== expectedFrom) throw new TriageReceiptError({ detail: "Receipt source does not match original application" });
  for (const ref of [receipt.application.from, receipt.application.to, attachDirFor(receipt.application.from), attachDirFor(receipt.application.to), ...(receipt.application.questionRef ? [receipt.application.questionRef] : [])]) await assertContained(boxRoot, containedPath(boxRoot, ref));
  validateApplicationTarget(receipt);
  if (receipt.instructions.trial) throw new TriageReceiptError({ detail: "Trial overlays cannot be applied; update canonical instructions and judge again" });
  await validateInstructionState({ boxRoot, receipt, storedReceipt });
  if (!storedReceipt && !await exists(containedPath(boxRoot, receipt.application.from))) throw new TriageReceiptError({ detail: "stale-decision: first application requires the original source" });
  if (!storedReceipt && receipt.evidence.parts.length > 1 && !await exists(containedPath(boxRoot, attachDirFor(receipt.application.from)))) throw new TriageReceiptError({ detail: "stale-decision: original attachment scope is missing" });
}
export async function applyDecision(opts: { boxRoot: string; decision: DecisionReceipt | string }): Promise<DecisionReceipt> {
  const { boxRoot } = opts;
  const preview = typeof opts.decision === "string" ? await readDecisionReceipt(boxRoot, opts.decision) : decisionReceiptSchema.parse(opts.decision);
  const lockDir = path.join(boxRoot, ".beebox/locks");
  await fs.mkdir(lockDir, { recursive: true });
  const key = createHash("sha256").update(JSON.stringify([preview.evidence.source.ref, preview.evidence.source.digest, preview.evidence.parts.map((p) => [p.ref, p.digest])])).digest("hex");
  const target = containedPath(boxRoot, preview.application.to);
  return withFileLock({ lockPath: path.join(lockDir, `triage-${key}`), metadata: { decision: preview.id }, waitMs: 10_000 }, async () => {
    return withCardLock(target, async () => {
      return withDecisionReceiptLock({ boxRoot, id: preview.id, fn: async () => {
        return withBoxGitLock(boxRoot, async () => {
    let receipt = preview;
    let storedReceipt = false;
    try {
      const stored = await readDecisionReceipt(boxRoot, preview.id);
      if (receiptFingerprint(stored) !== receiptFingerprint(preview)) throw new TriageReceiptError({ detail: "Stored receipt does not match preview" });
      receipt = stored;
      storedReceipt = true;
    } catch (error) { if (errnoCode(error) !== "ENOENT") throw error; /* First application has no stored receipt. */ }
    if (storedReceipt && receipt.application.state === "applied" && receipt.application.todoAnnotation?.state === "applied") {
      if (await hasCommittedTodoAnnotation(boxRoot, receipt)) return receipt;
      const current = await fs.readFile(containedPath(boxRoot, receipt.application.to));
      if (hash(current) !== receipt.application.todoAnnotation.afterDigest) throw new TriageReceiptError({ detail: "Todo annotation is recorded applied but its provenance commit is missing and the card has since changed" });
      await commitReceipt(boxRoot, receipt);
      return receipt;
    }
    await validateApplication(boxRoot, { receipt, storedReceipt });
    await repairMovedAnnexPaths({ boxRoot, receipt, storedReceipt });
    await validateBytes(boxRoot, receipt);
    const from = containedPath(boxRoot, receipt.application.from);
    const to = containedPath(boxRoot, receipt.application.to);
    if (receipt.evidence.source.attachmentRef && from !== to && await exists(attachDirFor(from)) && await exists(attachDirFor(to))) throw new TriageReceiptError({ detail: "Attachment destination collision" });
    await saveDecisionReceipt(boxRoot, receipt);
    try {
      const todo = selectedTodo(receipt);
      if (todo?.positive && !receipt.application.todoAnnotation) {
        const preflightFile = await exists(from) ? from : to;
        await planTriageTodoAnnotation({ file: preflightFile, boxRoot, destinationRef: todo.destinationRef, question: todo.question, created: await getTriageTodoDate(boxRoot) });
      }
      if (await exists(from)) await movePathPreservingAnnexSymlink(from, to);
      if (receipt.evidence.source.attachmentRef && (await exists(attachDirFor(from)) || await exists(attachDirFor(to)))) await movePathPreservingAnnexSymlink(attachDirFor(from), attachDirFor(to));
      await writeQuestion(boxRoot, receipt);
      await fs.rm(`${from}.probable.txt`, { force: true });
      receipt.application.state = "applied";
      delete receipt.application.error;
      await saveDecisionReceipt(boxRoot, receipt);
      await commitReceipt(boxRoot, receipt);
      if (todo?.positive) {
        await applyTodoAnnotation(boxRoot, receipt);
        await commitReceipt(boxRoot, receipt);
      }
      return receipt;
    } catch (error) {
      receipt.application.state = "incomplete";
      receipt.application.error = errorMessage(error);
      await saveDecisionReceipt(boxRoot, receipt);
      throw new TriageReceiptError({ detail: `Incomplete decision ${receipt.id}: ${errorMessage(error)}` });
    }
        });
      } });
    });
  });
}
