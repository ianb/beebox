/**
 * Shared "learning" field for question cards — durable knowledge an answer
 * teaches (see `schemas/question.ts`). Extracted here because
 * `schemas/question-followup-job.ts` also needs it: two members of the
 * schema set may not value-import each other, so the shared shape lives in
 * the set's parent.
 *
 * Where the answer's durable knowledge lands. Mirrors the retrospective's
 * sink vocabulary (`ObservationSink`) minus `question` itself — a question
 * card can't declare itself as its own destination.
 */

import { z } from "zod";

const QuestionLearningSink = z.enum(["guide", "briefing", "personality"]);
export type QuestionLearningSinkValue = z.infer<typeof QuestionLearningSink>;

export const QuestionLearning = z.object({
  sink: QuestionLearningSink,
  ref: z.string().optional(),
  proposal: z.string(),
});
export type QuestionLearningFields = z.infer<typeof QuestionLearning>;
