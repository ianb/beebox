/**
 * Question follow-up job card schema — a job created when a question is answered.
 *
 * The answer command creates this job so the reactor picks it up
 * and an agent acts on the directive with the user's answer.
 */

import { element, escapeText, escapeAttr } from "cardworks";
import { z } from "zod";
import { JobDescription } from "./news-job.js";

/**
 * Reference to the original question card.
 */
export const QuestionRef = element("question-ref", {
  attrs: {
    ref: z.string(),
  },
});

/**
 * The directive from the question (what to do with the answer).
 */
const FollowupDirective = element("directive", {
  text: z.string(),
});

/**
 * The user's answer.
 */
const FollowupAnswer = element("answer", {
  text: z.string(),
});

/**
 * Question follow-up job card schema.
 *
 * Example:
 * ```xml
 * <question-followup-job status="pending" created="2026-02-26T12:00:00Z" source="question-answer">
 *   <description>Follow up on answered question: Should I include tech news?</description>
 *   <question-ref ref="box/questions/tech-news.question.card" />
 *   <directive>Update config/news.guide.card to include or exclude tech category</directive>
 *   <answer>yes</answer>
 * </question-followup-job>
 * ```
 */
export const QuestionFollowupJobSchema = element("question-followup-job", {
  attrs: {
    status: z.string().default("pending"),
    created: z.string().datetime({ offset: true }),
    source: z.string().default("question-answer"),
  },
  children: z.array(z.union([JobDescription, QuestionRef, FollowupDirective, FollowupAnswer])),
  instructions: `# Processing Question Follow-up Jobs

A user has answered a question. Your job is to act on their answer.

## Steps

1. Read this job card — it contains the directive, the answer, and a reference to the original question
2. Read the referenced question card (\`<question-ref ref="...">\`) for full context (memo, prompt, options, who asked)
3. The \`<directive>\` tells you what to do with the answer
4. The \`<answer>\` is what the user chose or typed
5. Do the work described in the directive, using the answer to guide your actions
6. Commit your changes with a meaningful message
7. Run \`cb finish <this-job-file>\` to complete the job

## Important

- The directive was written by the agent that created the question — follow it faithfully
- Read the original question's <memo> and <context> for background
- Commit your work before running \`cb finish\``,
});

export type QuestionFollowupJob = z.infer<typeof QuestionFollowupJobSchema>;

/**
 * Template for creating a question follow-up job card.
 */
export function createQuestionFollowupJobTemplate(options: {
  description: string;
  questionRef: string;
  directive: string;
  answer: string;
  created?: string;
}): string {
  const created = options.created ?? new Date().toISOString();

  return `<question-followup-job status="pending" created="${escapeAttr(created)}" source="question-answer">
  <description>${escapeText(options.description)}</description>
  <question-ref ref="${escapeAttr(options.questionRef)}" />
  <directive>${escapeText(options.directive)}</directive>
  <answer>${escapeText(options.answer)}</answer>
</question-followup-job>
`;
}
