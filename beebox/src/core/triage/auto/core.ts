/** Sequential admitted-document harness over the same operations exposed by CLI. */
import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import { getBoxDir } from "../../../lib/paths/core.js";
import { errnoCode, errorMessage } from "../../../shared/error-guards.js";
import { InvariantError } from "../../../shared/invariant.js";
import { prepareItem } from "../evidence/core.js";
import { compileInstructionSnapshot, compileInstructionSnapshotWithStatus } from "../snapshot.js";
import { compileTriageInstructions } from "../compile.js";
import { applyDuplicateRemovals, findExactDuplicates, type DuplicateFinding } from "../duplicates.js";
import { judgeItem, TriageBudgetError, type TriageJudgment } from "../judge.js";
import { withTriageAllowance, TriageAllowanceError } from "../allowance.js";
import { researchItem } from "./research.js";
import { createDecisionReceipt, TriageReceiptError, type DecisionReceipt } from "../decisions/storage.js";
import { applyDecision } from "../decisions/apply.js";

export interface RunJevOptions {
  boxRoot: string; dryRun?: boolean;
  prepare?: typeof prepareItem; judge?: typeof judgeItem; research?: typeof researchItem; compile?: typeof compileTriageInstructions;
}
/** What the run did about compiled instructions; anything but current/recompiled means raw rules were used. */
export type CompiledRunStatus = "current" | "recompiled" | "stale" | "absent" | "invalid" | "failed" | "superseded";
export interface JevTriageResult { empty: boolean; duplicates: DuplicateFinding[]; compiled: CompiledRunStatus | null; decisions: DecisionReceipt[]; deferred: string[]; failed: Array<{ file: string; error: string }> }

/** Recompile once per non-dry run when the file is not current; a failure warns and the run uses raw rules. */
async function ensureCompiled(options: RunJevOptions): Promise<CompiledRunStatus> {
  const { compiled } = await compileInstructionSnapshotWithStatus(options.boxRoot);
  if (compiled.status === "current" || compiled.status === "not-used") return "current";
  if (options.dryRun) return compiled.status;
  const result = await (options.compile ?? compileTriageInstructions)({ boxRoot: options.boxRoot });
  if (result.status === "compiled") return "recompiled";
  // Superseded means another compile won the race; nothing to report.
  if (result.status === "superseded") return "superseded";
  console.warn(`[triage] compiled instructions ${result.status}: ${result.status === "failed" ? result.error : result.errors.join("; ")}; using raw rules`);
  return "failed";
}

function unreadableJudgment(): TriageJudgment {
  return { outcome: "unclear", destinationRef: null, requestHash: null, requestedModel: null, returnedModel: null, answer: null,
    reason: { kind: "summary", text: "Preparation summary: no readable evidence; no classifier call was made.", evidenceRefs: [] } };
}

async function processItem(options: RunJevOptions, context: { sourceRef: string; env: Record<string, string> }): Promise<DecisionReceipt> {
  const { boxRoot } = options;
  const prepare = options.prepare ?? prepareItem;
  const judge = options.judge ?? judgeItem;
  let instructions = await compileInstructionSnapshot(boxRoot);
  let evidence = await prepare({ boxRoot, sourceRef: context.sourceRef, instructions });
  let judgment = evidence.status === "unavailable" ? unreadableJudgment() : await judge(boxRoot, { evidence, instructions });
  if (!options.dryRun && judgment.outcome !== "destination") {
    const researched = await (options.research ?? researchItem)({ boxRoot, evidence, instructions, env: context.env });
    // An agent can improve evidence or rules even when its bounded run ends unresolved.
    instructions = await compileInstructionSnapshot(boxRoot);
    evidence = await prepare({ boxRoot, sourceRef: context.sourceRef, instructions });
    judgment = evidence.status === "unavailable" ? unreadableJudgment() : await judge(boxRoot, { evidence, instructions });
    if (researched) judgment = { ...judgment, reason: {
      kind: judgment.reason.kind,
      text: `${judgment.reason.text}\n\nResearch note: ${researched.reason}`,
      evidenceRefs: [...new Set([...judgment.reason.evidenceRefs, ...researched.evidenceRefs])],
    } };
  }
  const decision = createDecisionReceipt({ boxRoot, evidence, instructions, judgment });
  return options.dryRun ? decision : applyDecision({ boxRoot, decision });
}

export async function runJevTriage(options: RunJevOptions): Promise<JevTriageResult> {
  const staged = getBoxDir(options.boxRoot, "inboxStaged");
  let entries: Dirent[];
  try { entries = await fs.readdir(staged, { withFileTypes: true }); }
  catch (error) { if (errnoCode(error) !== "ENOENT") throw error; return { empty: true, duplicates: [], compiled: null, decisions: [], deferred: [], failed: [] }; }
  const listed = entries.filter((entry) => !entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name).toSorted();
  const refOf = (file: string): string => `/${path.relative(options.boxRoot, path.join(staged, file)).split(path.sep).join("/")}`;
  // Exact duplicates never reach a model. Removable ones are trashed; review ones are still judged.
  const duplicates = listed.length === 0 ? [] : await findExactDuplicates(options.boxRoot, listed.map(refOf));
  const removable = new Set(duplicates.filter((finding) => finding.disposition === "removable").map((finding) => finding.sourceRef));
  if (!options.dryRun && removable.size > 0) await applyDuplicateRemovals(options.boxRoot, { findings: duplicates });
  const files = listed.filter((file) => !removable.has(refOf(file)));
  // No agent pass for an empty run.
  const compiled = files.length === 0 ? null : await ensureCompiled(options);
  return withTriageAllowance(options.boxRoot, async (env) => {
    const result: JevTriageResult = { empty: listed.length === 0, duplicates, compiled, decisions: [], deferred: [], failed: [] };
    for (const [index, file] of files.entries()) {
      const sourceRef = refOf(file);
      try { result.decisions.push(await processItem(options, { sourceRef, env })); }
      catch (error) {
        if (error instanceof TriageBudgetError || error instanceof TriageAllowanceError) {
          result.deferred = files.slice(index);
          console.warn(`[triage] ${errorMessage(error)}; ${result.deferred.length} item(s) remain staged`);
          break;
        }
        if (error instanceof TriageReceiptError || error instanceof InvariantError) {
          result.failed.push({ file, error: errorMessage(error) });
          console.error(`[triage] ${file}: ${errorMessage(error)}`);
          continue;
        }
        throw error;
      }
    }
    return result;
  });
}
