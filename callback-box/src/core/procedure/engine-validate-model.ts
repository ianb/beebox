/**
 * Model-evaluated instruction validation for the procedure engine.
 *
 * A `validate` phase's `instructions:` are natural-language success criteria.
 * This module arranges the context (the instructions, the step's git diff, and
 * the step's `whys:`) and asks a review model for a structured pass/fail
 * verdict. Judgment stays in the model; this code only assembles inputs — the
 * same "arrange context, let the model judge" shape as the retro integration.
 *
 * The review model is reached through the same `createAgent` factory the run
 * phase uses, so tests inject a fake that returns a scripted verdict (see
 * test/helpers/fake-agent.ts) rather than hitting a live model.
 */

import { z } from "zod";
import { createAgent as realCreateAgent } from "../agent.js";
import { MODEL_MAP, type AgentFactory } from "./engine-types.js";

/** Structured verdict the review model returns for an instruction check. */
export const InstructionVerdict = z.object({
  passed: z.boolean(),
  reasoning: z.string(),
});

/** Friendly model name → full id; the judge defaults to sonnet. */
const DEFAULT_REVIEW_MODEL = "sonnet";

/** Turn cap for the judge — it reads inline context and returns a verdict. */
const REVIEW_MAX_TURNS = 8;

/** Parameters for {@link evaluateInstructions}. */
export interface EvaluateInstructionsParams {
  boxRoot: string;
  /** Instruction strings from the validate phase. */
  instructions: string[];
  /** The step's `whys:` — intent for the judge. */
  whys: string[];
  /** The step's git diff (`baseline..finalRef` range), the artifact judged. */
  diff: string;
  /** Friendly model name (haiku/sonnet/opus); defaults to sonnet. */
  model?: string;
  /** Agent factory override (default: real createAgent). */
  createAgent?: AgentFactory;
  /** Name used for the judge agent's session manifest entry. */
  name: string;
}

/**
 * Build the judge's system prompt — the task framing, kept stable so the
 * verdict depends on the inputs, not the phrasing.
 */
function buildJudgePrompt(params: {
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
 * Fail-closed: if the model call fails or returns no parseable verdict, the
 * result is `passed: false` with the error as the reasoning — a check the
 * author believes gates must never silently pass.
 */
export async function evaluateInstructions(
  params: EvaluateInstructionsParams
): Promise<{ passed: boolean; review: string }> {
  const { boxRoot, instructions, whys, diff, name } = params;
  const modelId = MODEL_MAP[params.model ?? DEFAULT_REVIEW_MODEL] ?? MODEL_MAP[DEFAULT_REVIEW_MODEL]!;

  const factory = params.createAgent ?? realCreateAgent;
  const agent = factory({ name });

  const systemPrompt = buildJudgePrompt({ instructions, whys, diff });

  const result = await agent.invokeStructured(InstructionVerdict, {
    boxRoot,
    systemPrompt,
    prompt: "Evaluate the instructions against the diff and return your verdict.",
    model: modelId,
    maxTurns: REVIEW_MAX_TURNS,
  });

  if (result.data === null) {
    // Model unavailable / schema-invalid output → fail-closed.
    return {
      passed: false,
      review: `Instruction validation could not obtain a verdict: ${result.error ?? "unknown error"}`,
    };
  }

  return { passed: result.data.passed, review: result.data.reasoning };
}
