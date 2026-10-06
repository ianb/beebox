/** One admitted item's pure classification: no research, receipts, or routing. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { JEV_MAX_REQUEST_CHARS, JEV_MODEL } from "../../services/jev-wire.js";
import { serializeJudgeRequest, type JudgeResult } from "../../services/jev-judge.js";
import type { JevService } from "../../services/jev.js";
import { getBoxTime } from "../../lib/time.js";
import { errorMessage } from "../../shared/error-guards.js";
import { reserveJevCalls } from "../judgment/budget.js";
import { appendJevDebug, resolveJudgeService } from "../judgment/service.js";
import { reserveRunCalls } from "./allowance.js";
import { evidenceSchema, type Evidence } from "./evidence/core.js";
import type { InstructionSnapshot } from "./snapshot.js";
import { buildTriageRequest } from "./request.js";

export const triageJudgmentSchema = z.object({
  todoAnswers: z.record(z.string(), z.number().min(0).max(1)).optional(),
  outcome: z.enum(["destination", "no-match", "unclear"]), destinationRef: z.string().nullable(),
  requestHash: z.string().regex(/^[\da-f]{64}$/).nullable(), requestedModel: z.string().nullable(), returnedModel: z.string().nullable(),
  answer: z.object({ type: z.literal("choice"), choice: z.string(), confidence: z.number().min(0).max(1), probabilities: z.record(z.string(), z.number().min(0).max(1)) }).nullable(),
  reason: z.object({ kind: z.enum(["summary", "agent"]), text: z.string(), evidenceRefs: z.array(z.string()) }),
}).superRefine((value, ctx) => {
  const hasModel = value.requestedModel !== null && value.returnedModel !== null && value.requestHash !== null;
  const anyModel = value.requestedModel !== null || value.returnedModel !== null || value.requestHash !== null;
  if (value.answer === null ? anyModel || value.outcome !== "unclear" : !hasModel) ctx.addIssue({ code: "custom", message: "Model provenance must accompany an answer; preparation-only outcomes are unclear" });
  if ((value.outcome === "destination") !== (value.destinationRef !== null)) ctx.addIssue({ code: "custom", message: "Destination ref must agree with outcome" });
});
export type TriageJudgment = z.infer<typeof triageJudgmentSchema>;
const failureMessages = {
  unavailable: "Evidence unavailable: prepare or research the source before judging",
  missing: "Jev returned no destination choice",
  todo: "Jev returned a missing or invalid destination todo answer",
  distribution: "Jev returned an invalid destination distribution",
  sum: "Jev destination probabilities do not sum to one",
  unconfigured: "Jev is unconfigured",
  fake: "Invalid BBX_JEV_FAKE value (expected 0 or 1)",
  budget: "Jev daily budget exhausted",
  requestSize: "Serialized Jev request exceeds the supported request size",
};
class TriageJudgmentError extends Error {
  constructor({ reason }: { reason: keyof typeof failureMessages }) { super(failureMessages[reason]); this.name = "TriageJudgmentError"; }
}
export class TriageBudgetError extends TriageJudgmentError {
  constructor() { super({ reason: "budget" }); this.name = "TriageBudgetError"; }
}
export interface JudgeItemOptions {
  evidence: Evidence; instructions: InstructionSnapshot; model?: string; env?: NodeJS.ProcessEnv;
  /** Internal replay reservation, never exposed as a CLI budget bypass. */
  budgetReserved?: boolean;
  /** Inject a typed service in deterministic tests. */
  jev?: JevService;
}

export { buildTriageRequest } from "./request.js";

function checkedRequest(options: JudgeItemOptions): ReturnType<typeof buildTriageRequest> {
  const evidence = evidenceSchema.parse(options.evidence);
  if (evidence.status === "unavailable") throw new TriageJudgmentError({ reason: "unavailable" });
  const input = buildTriageRequest({ ...options, evidence });
  if (serializeJudgeRequest(input).length > JEV_MAX_REQUEST_CHARS) throw new TriageJudgmentError({ reason: "requestSize" });
  return input;
}

/** Keep optional follow-up answers coupled to exactly the evaluated destinations. */
function readTodoAnswers(instructions: InstructionSnapshot, result: JudgeResult): Record<string, number> | undefined {
  const answers: Record<string, number> = {};
  for (const destination of instructions.destinations) {
    if (!destination.todoQuestion) continue;
    const todo = result.answers[`todo_${destination.optionId}`];
    if (todo?.type !== "noul" || !Number.isFinite(todo.probability) || todo.probability < 0 || todo.probability > 1) throw new TriageJudgmentError({ reason: "todo" });
    answers[destination.optionId] = todo.probability;
  }
  return Object.keys(answers).length === 0 ? undefined : answers;
}

export async function judgeItem(boxRoot: string, options: JudgeItemOptions): Promise<TriageJudgment> {
  const input = checkedRequest(options);
  const serialized = serializeJudgeRequest(input);
  const requestedModel = options.model ?? JEV_MODEL;
  // TODO(env-migration): Lazy Jev-key resolution is a feature-specific env read.
  const service = options.jev === undefined ? await resolveJudgeService(boxRoot, options.env ?? process.env) : { kind: "ready" as const, jev: options.jev, fake: true };
  if (service.kind !== "ready") throw new TriageJudgmentError({ reason: service.kind === "unconfigured" ? "unconfigured" : "fake" });
  if (!options.budgetReserved) {
    await reserveRunCalls(boxRoot, 1);
    if (!await reserveJevCalls(boxRoot, { calls: 1, now: getBoxTime(boxRoot) })) throw new TriageBudgetError();
  }
  const log = { at: getBoxTime(boxRoot).toISOString(), card: options.evidence.source.ref, input: serialized, state: JSON.stringify(input.state), fake: service.fake };
  try {
    const result = await service.jev.judge(input);
    await appendJevDebug(boxRoot, { ...log, model: result.model, answers: result.answers });
    const todoAnswers = readTodoAnswers(options.instructions, result);
    const answer = result.answers["destination"];
    if (answer?.type !== "choice") throw new TriageJudgmentError({ reason: "missing" });
    const keys = [...options.instructions.destinations.map((destination) => destination.optionId), "no-match", "unclear"];
    const entries = Object.entries(answer.probabilities);
    if (entries.length !== keys.length || entries.some(([key, p]) => !keys.includes(key) || !Number.isFinite(p) || p < 0 || p > 1) || !keys.includes(answer.choice)) throw new TriageJudgmentError({ reason: "distribution" });
    const total = entries.reduce((sum, [, p]) => sum + p, 0);
    if (Math.abs(total - 1) > Math.min(0.02, keys.length * 0.005 + 0.000001)) throw new TriageJudgmentError({ reason: "sum" });
    const highest = Math.max(...entries.map(([, p]) => p));
    const winners = entries.filter(([, p]) => p === highest).map(([key]) => key);
    if (!winners.includes(answer.choice)) throw new TriageJudgmentError({ reason: "distribution" });
    const winner = winners.length === 1 ? winners[0] : "unclear";
    const destination = options.instructions.destinations.find((candidate) => candidate.optionId === winner);
    const outcome = destination === undefined ? winner === "no-match" ? "no-match" : "unclear" : "destination";
    const refs = options.instructions.sources.map((source) => source.ref).join(", ");
    return triageJudgmentSchema.parse({ outcome, destinationRef: destination?.ref ?? null, requestHash: createHash("sha256").update(serialized).digest("hex"), requestedModel, returnedModel: result.model, answer, todoAnswers,
      reason: { kind: "summary", text: `Classifier summary: ${destination?.ref ?? outcome}${winners.length > 1 ? " (tied leading options)" : ""}; leading probability ${highest.toFixed(3)}, confidence ${answer.confidence.toFixed(3)}; instructions: ${refs}.`, evidenceRefs: options.evidence.parts.map((part) => part.ref) },
    });
  } catch (error) {
    await appendJevDebug(boxRoot, { ...log, error: errorMessage(error) });
    throw error;
  }
}
