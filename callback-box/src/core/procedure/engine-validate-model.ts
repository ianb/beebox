/**
 * Model-evaluated instruction validation for the procedure engine.
 *
 * A `validate` phase's `instructions:` are natural-language success criteria.
 * This module arranges the context (the instructions, the step's git diff, and
 * the step's `whys:`) and asks a review model for a structured pass/fail
 * verdict. Judgment stays in the model; this code only assembles inputs — the
 * same "arrange context, let the model judge" shape as the retro integration.
 *
 * A judge that never answers is its own outcome here (`inconclusive`), not a
 * failing verdict — see {@link InstructionEvaluation}.
 *
 * The review model is reached through the same `createAgent` factory the run
 * phase uses, so tests inject a fake that returns a scripted verdict (see
 * test/helpers/fake-agent.ts) rather than hitting a live model.
 */

import { z } from "zod";
import { createAgent as realCreateAgent } from "../agent/index.js";
import { loadAgentEngine } from "../box/config.js";
import {
  resolveProcedureModel,
  type ProcedureModelName,
} from "../../shared/agent-models.js";
import type { StructuredAgentResult } from "../agent/types.js";
import type { AgentFactory } from "./engine-types.js";
import {
  classifyInconclusiveReason,
  describeInconclusiveReason,
  type InconclusiveReason,
} from "../../shared/inconclusive.js";

/** Structured verdict the review model returns for an instruction check. */
export const InstructionVerdict = z.object({
  passed: z.boolean(),
  reasoning: z.string(),
});
type InstructionVerdictValue = z.infer<typeof InstructionVerdict>;

/** Portable model tier; each box's configured engine resolves it natively. */
const DEFAULT_REVIEW_MODEL: ProcedureModelName = "balanced";

/**
 * Turn cap for the judge's first attempt — it reads inline context and returns
 * a verdict.
 */
const REVIEW_MAX_TURNS = 8;

/**
 * Turn cap for the single judge retry. Doubled rather than repeated: the retry
 * starts a FRESH session (a resumed one would inherit whatever wandering ate
 * the first budget), so an identical cap would mostly reproduce the first
 * attempt. Doubling buys room while keeping the cost bounded — one retry, then
 * the outcome is reported as inconclusive rather than guessed at.
 */
const REVIEW_RETRY_MAX_TURNS = REVIEW_MAX_TURNS * 2;

/** Parameters for {@link evaluateInstructions}. */
export interface EvaluateInstructionsParams {
  boxRoot: string;
  /** Instruction strings from the validate phase. */
  instructions: string[];
  /** The step's `whys:` — intent for the judge. */
  whys: string[];
  /** The step's git diff (`baseline..finalRef` range), the artifact judged. */
  diff: string;
  /** Portable model tier or legacy alias; defaults to balanced. */
  model?: ProcedureModelName;
  /** Agent factory override (default: real createAgent). */
  createAgent?: AgentFactory;
  /** Name used for the judge agent's session manifest entry. */
  name: string;
}

/**
 * What asking the judge produced. Three outcomes, kept distinct because they
 * call for different responses:
 *
 * - `verdict` — the judge decided. `passed` gates by severity as before.
 * - `inconclusive` — the judge never decided (turn cap, timeout, unparseable
 *   output). The work may be fine; nobody knows. It must not be reported as a
 *   failing check, and it must not trigger a work-agent retry.
 * - `invocation-failure` — the harness itself failed before any assistant
 *   response (auth/model rejection, transport). Validation did not run at all,
 *   which gates the step exactly as it did before.
 */
export type InstructionEvaluation =
  | { outcome: "verdict"; passed: boolean; review: string }
  | { outcome: "inconclusive"; reason: InconclusiveReason; detail: string; review: string }
  | { outcome: "invocation-failure"; review: string; error: string };

/**
 * Build the judge's system prompt — the task framing, kept stable so the
 * verdict depends on the inputs, not the phrasing.
 */
export function buildJudgePrompt(params: {
  instructions: string[];
  whys: string[];
  diff: string;
}): string {
  const { instructions, whys, diff } = params;
  const instructionBlock = instructions.map((i) => `- ${i}`).join("\n");
  const whyBlock = whys.length > 0 ? whys.map((w) => `- ${w}`).join("\n") : "(none provided)";
  const diffBlock = diff.trim() ? diff : "(no changes — the step produced an empty diff)";

  return `You are validating whether a step's changes satisfy its instructions.

Judge ONLY against the evidence below — primarily the git diff, which is the
actual committed work. Do not assume work that the diff does not show. If the
diff is empty or does not demonstrate the instructions were met, the verdict is
\`passed: false\`.

<instructions>
${instructionBlock}
</instructions>

<why>
${whyBlock}
</why>

<diff>
${diffBlock}
</diff>

Return a structured verdict: \`passed\` (did the changes satisfy every
instruction?) and \`reasoning\` (one or two sentences grounding the verdict in
the diff).`;
}

/**
 * Ask the review model whether the step's diff satisfies its instructions.
 *
 * A judge that fails to produce a verdict is reported as {@link
 * InstructionEvaluation} `inconclusive`, not as `passed: false` — the old
 * fail-closed collapse made a budget problem indistinguishable from wrong
 * work, and readers learned to discount the signal
 * (`issues/bugs/2026-08-12-health-masks-review-step-turn-cap.md`). Nothing
 * silently passes either: an inconclusive check is carried as its own state
 * all the way to `cb health`.
 */
export async function evaluateInstructions(
  params: EvaluateInstructionsParams
): Promise<InstructionEvaluation> {
  const { boxRoot, instructions, whys, diff, name } = params;
  const engine = await loadAgentEngine(boxRoot);
  const modelId = resolveProcedureModel(engine, params.model ?? DEFAULT_REVIEW_MODEL);
  const factory = params.createAgent ?? realCreateAgent;
  const systemPrompt = buildJudgePrompt({ instructions, whys, diff });

  const ask = async (maxTurns: number): Promise<StructuredAgentResult<InstructionVerdictValue>> => {
    // A fresh agent per attempt: invokeStructured on the same instance would
    // resume the exhausted session instead of starting over.
    const agent = factory({ name });
    return agent.invokeStructured(InstructionVerdict, {
      boxRoot,
      systemPrompt,
      prompt: "Evaluate the instructions against the diff and return your verdict.",
      model: modelId,
      maxTurns,
    });
  };

  let result = await ask(REVIEW_MAX_TURNS);
  let maxTurns = REVIEW_MAX_TURNS;
  if (result.data === null && result.invocationFailure !== true) {
    // Retry the JUDGE, never the work agent: the work is already done and
    // committed, and re-running it because the checker ran out of budget
    // redoes finished work for no reason.
    result = await ask(REVIEW_RETRY_MAX_TURNS);
    maxTurns = REVIEW_RETRY_MAX_TURNS;
  }

  if (result.data === null) {
    if (result.invocationFailure === true) {
      return {
        outcome: "invocation-failure",
        review: `Instruction validation could not run: ${result.error}`,
        error: result.error,
      };
    }
    const reason = classifyInconclusiveReason(result.error);
    const detail = describeInconclusiveReason(reason, { maxTurns, detail: result.error });
    return {
      outcome: "inconclusive",
      reason,
      detail,
      review: `Instruction validation was inconclusive: the review ${detail}. The work was not judged — it is neither approved nor rejected.`,
    };
  }

  return { outcome: "verdict", passed: result.data.passed, review: result.data.reasoning };
}
