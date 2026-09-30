/** Fixed evidence replay never routes or invokes a research agent. */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { simpleGit } from "simple-git";
import { parseAnnexPointer } from "../../../lib/annex-pointer.js";
import { getBoxTime } from "../../../lib/time.js";
import { errorMessage, errnoCode } from "../../../shared/error-guards.js";
import { attachDirFor } from "../../../shared/attach-path.js";
import { reserveJevCalls } from "../../judgment/budget.js";
import { reserveRunCalls } from "../allowance.js";
import { prepareItem, verifyEvidence, type Evidence } from "../evidence/core.js";
import { judgeItem, type TriageJudgment } from "../judge.js";
import type { InstructionSnapshot } from "../snapshot.js";
import type { JevService } from "../../../services/jev.js";
import { readDecisionReceipt, containedPath, TriageReceiptError, type DecisionReceipt } from "./storage.js";

interface ReplayResult {
  id: string; repetition: number; historical: TriageJudgment; model: string; modelDrift: boolean;
  assertions: DecisionReceipt["outcomes"]; preparationChanged?: boolean; outcomeChanged?: boolean; todoOutcomeChanged?: boolean; probabilityDeltas?: Record<string, number>;
  status: "evaluated" | "unavailable"; original?: TriageJudgment; candidate?: TriageJudgment; error?: string;
}
function isWithin(directory: string, file: string): boolean {
  const relative = path.relative(directory, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
async function readLocalAnnexObject(opts: { annexRoot: string; objectPath: string; ref: string }): Promise<Buffer> {
  const { annexRoot, objectPath, ref } = opts;
  if (!isWithin(annexRoot, objectPath)) throw new TriageReceiptError({ detail: `Git-annex object path escaped local store: ${ref}` });
  let actualRoot: string;
  let actualTarget: string;
  try {
    [actualRoot, actualTarget] = await Promise.all([fs.realpath(annexRoot), fs.realpath(objectPath)]);
  } catch (error) {
    if (errnoCode(error) === "ENOENT") throw new TriageReceiptError({ detail: `local Git-annex object is missing for ${ref}` });
    throw error;
  }
  if (!isWithin(actualRoot, actualTarget)) throw new TriageReceiptError({ detail: `Git-annex object escaped its local store: ${ref}` });
  return fs.readFile(actualTarget);
}
async function historicalBlob(opts: { boxRoot: string; git: ReturnType<typeof simpleGit>; revision: string; relative: string }): Promise<Buffer> {
  const { boxRoot, git, revision, relative } = opts;
  const bytes = await git.binaryCatFile(["blob", `${revision}:${relative}`]);
  const pointer = parseAnnexPointer(bytes);
  const annexRoot = path.join(boxRoot, ".git", "annex", "objects");
  if (pointer) {
    const location = (await git.raw(["annex", "contentlocation", pointer.key])).trim();
    if (!location) throw new TriageReceiptError({ detail: `local Git-annex object is missing for ${relative}` });
    return readLocalAnnexObject({ annexRoot, objectPath: path.resolve(boxRoot, location), ref: relative });
  }
  const treeEntry = await git.raw(["ls-tree", "-z", revision, "--", relative]);
  if (!treeEntry.startsWith("120000 blob ")) return bytes;
  const target = path.resolve(boxRoot, path.dirname(relative), bytes.toString("utf8"));
  if (!isWithin(annexRoot, target)) return bytes;
  return readLocalAnnexObject({ annexRoot, objectPath: target, ref: relative });
}
async function prepareAgain(boxRoot: string, receipt: DecisionReceipt): Promise<Evidence> {
  const oldSource = receipt.evidence.source.ref;
  const currentSource = receipt.application.state === "pending" ? receipt.application.from : receipt.application.to;
  const mapped: Evidence = { ...receipt.evidence, source: { ...receipt.evidence.source, ref: currentSource, attachmentRef: receipt.evidence.source.attachmentRef ? attachDirFor(currentSource) : null }, parts: receipt.evidence.parts.map((part) => ({ ...part, ref: part.ref === oldSource ? currentSource : receipt.evidence.source.attachmentRef ? part.ref.replace(`${receipt.evidence.source.attachmentRef}/`, `${attachDirFor(currentSource)}/`) : part.ref })) };
  try {
    await verifyEvidence(boxRoot, mapped);
    return await prepareItem({ boxRoot, sourceRef: currentSource, maxTextChars: receipt.evidence.recipe.maxTextChars, ...(receipt.evidence.recipe.maxRequestChars === undefined ? {} : { maxRequestChars: receipt.evidence.recipe.maxRequestChars }), instructions: receipt.instructions });
  } catch (_error) {
    // A moved/changed source can be reproduced from its preparation or application commit.
  }
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "triage-replay-"));
  try {
    const git = simpleGit(boxRoot);
    let applicationCommits: string[] = [];
    if (receipt.application.state !== "pending") {
      const found = (await git.raw(["log", "--all-match", "--format=%H", "--fixed-strings", "--grep", `Triage-Decision: ${receipt.id}`, "--grep", "Triage-Classifier:"])).trim();
      applicationCommits = found ? found.split("\n") : [];
    }
    for (const part of receipt.evidence.parts) {
      const originalPath = path.relative(boxRoot, containedPath(boxRoot, part.ref));
      const evidenceSourceRef = receipt.evidence.source.ref;
      const appliedRef = part.ref === evidenceSourceRef ? receipt.application.to : receipt.evidence.source.attachmentRef && part.ref.startsWith(`${receipt.evidence.source.attachmentRef}/`) ? `${attachDirFor(receipt.application.to)}${part.ref.slice(receipt.evidence.source.attachmentRef.length)}` : part.ref;
      const appliedPath = path.relative(boxRoot, containedPath(boxRoot, appliedRef));
      const candidates = [
        ...(receipt.evidence.source.gitRevision ? [{ revision: receipt.evidence.source.gitRevision, relative: originalPath }] : []),
        ...applicationCommits.map((revision) => ({ revision, relative: appliedPath })),
      ];
      let bytes: Buffer | undefined;
      let lastError: unknown;
      for (const candidate of candidates) {
        try {
          const candidateBytes = await historicalBlob({ boxRoot, git, ...candidate });
          if (createHash("sha256").update(candidateBytes).digest("hex") !== part.digest) continue;
          bytes = candidateBytes;
          break;
        }
        catch (error) { lastError = error; }
      }
      if (!bytes) throw new TriageReceiptError({ detail: `prepare-again unavailable: could not recover ${part.ref}${lastError ? `: ${errorMessage(lastError)}` : ""}` });
      const output = containedPath(scratch, part.ref);
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, bytes);
    }
    await verifyEvidence(scratch, receipt.evidence);
    return await prepareItem({ boxRoot: scratch, sourceRef: oldSource, maxTextChars: receipt.evidence.recipe.maxTextChars, ...(receipt.evidence.recipe.maxRequestChars === undefined ? {} : { maxRequestChars: receipt.evidence.recipe.maxRequestChars }), instructions: receipt.instructions });
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
}
function samePreparedParts(left: Evidence["parts"], right: Evidence["parts"]): boolean {
  return JSON.stringify(left.map(({ ref: _ref, ...part }) => part)) === JSON.stringify(right.map(({ ref: _ref, ...part }) => part));
}
function todoOutcome(judgment: TriageJudgment, instructions: InstructionSnapshot): { destination: string; question: string; answer: "unavailable" | "yes" | "no" } | null {
  const destination = instructions.destinations.find((entry) => entry.ref === judgment.destinationRef);
  if (!destination?.todoQuestion) return null;
  const probability = judgment.todoAnswers?.[destination.optionId];
  return { destination: destination.ref, question: destination.todoQuestion, answer: probability === undefined ? "unavailable" : probability > 0.5 ? "yes" : "no" };
}
function describeComparison(result: ReplayResult, comparison: { candidate: TriageJudgment; instructions: { original: InstructionSnapshot; candidate: InstructionSnapshot } }): void {
  const { candidate, instructions } = comparison;
  const baseline = result.original ?? result.historical;
  result.outcomeChanged = baseline.outcome !== candidate.outcome || baseline.destinationRef !== candidate.destinationRef;
  result.todoOutcomeChanged = JSON.stringify(todoOutcome(baseline, instructions.original)) !== JSON.stringify(todoOutcome(candidate, instructions.candidate));
  result.probabilityDeltas = Object.fromEntries(Object.entries(candidate.answer?.probabilities ?? {}).map(([key, value]) => [key, value - (baseline.answer?.probabilities[key] ?? 0)]));
}
export async function replayDecisions(opts: { boxRoot: string; ids: string[]; instructions: InstructionSnapshot; compareOriginal?: boolean; maxCalls: number; repeat?: number; prepareAgain?: boolean; model?: string; jev?: JevService; env?: NodeJS.ProcessEnv }): Promise<{ plannedCalls: number; results: ReplayResult[] }> {
  const repeat = opts.repeat ?? 1;
  if (!Number.isSafeInteger(repeat) || repeat < 1 || !Number.isSafeInteger(opts.maxCalls) || opts.maxCalls < 1 || opts.ids.length === 0) throw new TriageReceiptError({ detail: "Replay needs IDs and positive integer repeat/max-calls" });
  const receipts: DecisionReceipt[] = [];
  for (const id of opts.ids) receipts.push(await readDecisionReceipt(opts.boxRoot, id));
  const callsPerReceipt = repeat * (opts.compareOriginal ? 2 : 1);
  const plannedCalls = receipts.reduce((calls, receipt) => calls + (opts.model || receipt.judgment.returnedModel ? callsPerReceipt : 0), 0);
  if (plannedCalls > opts.maxCalls) throw new TriageReceiptError({ detail: `Replay requires ${String(plannedCalls)} calls, exceeding max-calls ${String(opts.maxCalls)}; no cases were run` });
  if (plannedCalls > 0) {
    await reserveRunCalls(opts.boxRoot, plannedCalls);
    if (!await reserveJevCalls(opts.boxRoot, { calls: plannedCalls, now: getBoxTime(opts.boxRoot) })) throw new TriageReceiptError({ detail: "Daily Jev budget cannot reserve the complete replay" });
  }
  const results: ReplayResult[] = [];
  for (const receipt of receipts) {
    const model = opts.model ?? receipt.judgment.returnedModel;
    for (let repetition = 1; repetition <= repeat; repetition++) {
      const result: ReplayResult = { id: receipt.id, repetition, historical: receipt.judgment, model: model ?? "unavailable", modelDrift: model !== receipt.judgment.returnedModel, assertions: receipt.outcomes, status: "unavailable" };
      try {
        if (!model) throw new TriageReceiptError({ detail: "Receipt has no evaluated model; replay requires an explicit model" });
        const evidence = opts.prepareAgain ? await prepareAgain(opts.boxRoot, receipt) : receipt.evidence;
        result.preparationChanged = !samePreparedParts(evidence.parts, receipt.evidence.parts);
        const shared = { evidence, model, budgetReserved: true, ...(opts.jev ? { jev: opts.jev } : {}), ...(opts.env ? { env: opts.env } : {}) };
        if (opts.compareOriginal) result.original = await judgeItem(opts.boxRoot, { ...shared, instructions: receipt.instructions });
        result.candidate = await judgeItem(opts.boxRoot, { ...shared, instructions: opts.instructions });
        if (result.candidate.returnedModel !== model || (result.original && result.original.returnedModel !== model)) throw new TriageReceiptError({ detail: `Pinned model ${model} was substituted by the provider` });
        describeComparison(result, { candidate: result.candidate, instructions: { original: receipt.instructions, candidate: opts.instructions } });
        result.status = "evaluated";
      } catch (error) { result.error = errorMessage(error); /* Per-case operational failure is explicit in the replay result. */ }
      results.push(result);
    }
  }
  return { plannedCalls, results };
}
