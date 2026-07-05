/**
 * Question follow-up job card schema — a job created when a question is answered.
 *
 * The answer command creates this job so the reactor picks it up and an
 * agent acts on the directive with the user's answer.
 */

import { cardSchema, renderFrontmatterBlock, type CardSchema } from "../cards/index.js";
import { z } from "zod";

export const QuestionFollowupJobSchema: CardSchema = cardSchema("question-followup-job", {
  description: "A system job created when the user answers a question — carries the directive and answer for an agent to act on",
  category: "system",
  searchable: false,
  fields: {
    status: z.string().default("pending"),
    source: z.string().default("question-answer"),
    description: z.string(),
    "question-ref": z.object({ ref: z.string() }),
    directive: z.string(),
    answer: z.string(),
  },
  instructions: `# Processing Question Follow-up Jobs

A user has answered a question. Your job is to act on their answer.

## Steps

1. Read this job card — it contains the directive, the answer, and a
   reference to the original question
2. Read the referenced question card (\`question-ref.ref:\`) for full
   context (memo, prompt, options, who asked)
3. The \`directive:\` tells you what to do with the answer
4. The \`answer:\` is what the user chose or typed
5. Do the work described in the directive, using the answer to guide
   your actions
6. Commit your changes with a meaningful message
7. Run \`cb finish {thisJobFile}\` to complete the job

## Important

- The directive was written by the agent that created the question —
  follow it faithfully
- Read the original question's memo and context for background
- Commit your work before running \`cb finish\``,
});

export interface QuestionFollowupJobFields {
  type: "question-followup-job";
  status: string;
  source: string;
  description: string;
  "question-ref": { ref: string };
  directive: string;
  answer: string;
}

export function createQuestionFollowupJobTemplate(options: {
  description: string;
  questionRef: string;
  directive: string;
  answer: string;
}): string {
  const fields: Record<string, unknown> = {
    status: "pending",
    source: "question-answer",
    description: options.description,
    "question-ref": { ref: options.questionRef },
    directive: options.directive,
    answer: options.answer,
  };
  return renderFrontmatterBlock(fields);
}
