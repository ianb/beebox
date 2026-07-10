/**
 * Question follow-up job card schema — a job created when a question is answered.
 *
 * The answer command creates this job so the reactor picks it up and an
 * agent acts on the directive with the user's answer, and — when the
 * question declared one — records the durable learning the answer teaches.
 */

import { cardSchema, cardRef, renderFrontmatterBlock, type InferCardFields } from "../cards/index.js";
import { QuestionLearning, type QuestionLearningFields } from "./question.js";
import { z } from "zod";

export const QuestionFollowupJobSchema = cardSchema("question-followup-job", {
  description: "A system job created when the user answers a question — carries the directive and answer for an agent to act on",
  category: "system",
  searchable: false,
  fields: {
    status: z.string().default("pending"),
    source: z.string().default("question-answer"),
    description: z.string(),
    "question-ref": cardRef(),
    directive: z.string(),
    answer: z.string(),
    learning: QuestionLearning.optional(),
  },
  instructions: `# Processing Question Follow-up Jobs

A user has answered a question. Your job has up to three steps — do all that apply, in order.

## Steps

1. Read this job card — it contains the directive, the answer, a reference
   to the original question, and (when the question declared one) the
   \`learning:\` the answer is meant to teach.
2. Read the referenced question card (\`question-ref.ref:\`) for full
   context (memo, prompt, options, evidence).
3. **Execute the directive.** The \`directive:\` tells you what to do with
   the answer — do that work using the \`answer:\` text to guide it.
4. **If \`learning:\` is present, record it.** \`learning.proposal\` is the
   belief being tested; the user's answer either confirms it, denies it, or
   qualifies it. Record the outcome in \`learning.sink\` (\`guide\`,
   \`briefing\`, or \`personality\`) as a \`source: user-stated\` belief —
   the evidence model in \`docs/implemented-plans/box-retrospectives.md\`
   applies: quote the answer, ref the question card. A "no" is also
   learning — record the decline against the proposal rather than silently
   dropping it. For sink \`briefing\`, only the ROOT briefing is compiled
   into agent context (directory briefings are not) — resolve \`learning.ref\`
   to the root briefing even if it points elsewhere. If \`learning.ref\`
   is missing or stale, resolve the right target by sink type (or create
   it if it genuinely doesn't exist yet) and note the substitution in your
   commit.
5. **If \`learning:\` is absent, still ask whether the answer generalizes.**
   Not every question comes with a declared learning destination, but many
   answers are precedent anyway. Before finishing, judge: does this answer
   imply a durable rule, not just a one-off placement? If yes, record it
   (same evidence discipline: quote the answer, ref the question) in the
   sink that fits — a placement rule usually belongs in a \`guide\` card. If
   the answer is genuinely a one-shot decision with no generalizable rule,
   skip this step; that is the common, correct outcome, not a failure.
6. Commit your changes with a meaningful message.
7. Run \`cb finish {thisJobFile}\` to complete the job.

## Important

- The directive was written by the agent that created the question —
  follow it faithfully.
- Read the original question's memo and context for background.
- Commit your work before running \`cb finish\`.`,
});

export type QuestionFollowupJobFields = InferCardFields<typeof QuestionFollowupJobSchema>;

export function createQuestionFollowupJobTemplate(options: {
  description: string;
  questionRef: string;
  directive: string;
  answer: string;
  learning?: QuestionLearningFields;
}): string {
  const fields: Record<string, unknown> = {
    status: "pending",
    source: "question-answer",
    description: options.description,
    "question-ref": { ref: options.questionRef },
    directive: options.directive,
    answer: options.answer,
  };
  if (options.learning !== undefined) fields["learning"] = options.learning;
  return renderFrontmatterBlock(fields);
}
