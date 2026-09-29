/** Sequential admitted-document harness over the same operations exposed by CLI. */
import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import { getBoxDir } from "../../../lib/paths/core.js";
import { errnoCode, errorMessage } from "../../../shared/error-guards.js";
import { InvariantError } from "../../../shared/invariant.js";
import { prepareItem } from "../evidence/core.js";
import { compileInstructionSnapshot } from "../snapshot.js";
import { judgeItem, TriageBudgetError, type TriageJudgment } from "../judge.js";
import { withTriageAllowance, TriageAllowanceError } from "../allowance.js";
import { researchItem } from "./research.js";
import { createDecisionReceipt, TriageReceiptError, type DecisionReceipt } from "../decisions/storage.js";
import { applyDecision } from "../decisions/apply.js";

export interface RunJevOptions {
  boxRoot: string; dryRun?: boolean;
  prepare?: typeof prepareItem; judge?: typeof judgeItem; research?: typeof researchItem;
}
export interface JevTriageResult { empty: boolean; decisions: DecisionReceipt[]; deferred: string[]; failed: Array<{ file: string; error: string }> }

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
  catch (error) { if (errnoCode(error) !== "ENOENT") throw error; return { empty: true, decisions: [], deferred: [], failed: [] }; }
  const files = entries.filter((entry) => !entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name).toSorted();
  return withTriageAllowance(options.boxRoot, async (env) => {
    const result: JevTriageResult = { empty: files.length === 0, decisions: [], deferred: [], failed: [] };
    for (const [index, file] of files.entries()) {
      const sourceRef = `/${path.relative(options.boxRoot, path.join(staged, file)).split(path.sep).join("/")}`;
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
