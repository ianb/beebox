/**
 * Question-reraise command - Ask a put-away question again.
 *
 * Clears `dismissed-at` and sets `asked-at` to now, under the same guarded,
 * atomic transition as `answer`: the question is pending again, the newest
 * one, and its aging clock restarts. An agent uses it after simplifying the
 * question. A question that carries `provisional` was decided by the box and
 * is refused.
 */

import * as path from "node:path";
import { renderFrontmatterBlock, splitCardContent } from "../../exports/cards.js";
import { z } from "zod";
import {
  parseCommandArgs,
  type CommandContext,
  type CommandDefinition,
  type CommandResult,
} from "../command-types.js";
import { getBoxTimeISO } from "../../lib/time.js";
import { withQuestionTransition, resolveContainedQuestionPath } from "../question-transition.js";

const QuestionReraiseArgsSchema = z.object({
  question: z.string().optional(),
});

async function executeQuestionReraise(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const { question } = parseCommandArgs(args, QuestionReraiseArgsSchema);
  if (!question) return { success: false, error: "Question path is required" };

  const contained = resolveContainedQuestionPath(ctx.boxRoot, question);
  if (!contained.ok) {
    return { success: false, error: contained.error };
  }
  const { fullPath, relativePath } = contained;

  const outcome = await withQuestionTransition({
    ctx,
    fullPath,
    questionRef: question,
    allowedStates: ["dismissed"],
    disallowedMessage: (state) =>
      `Question is ${state}, not dismissed; only a dismissed question can be asked again`,
    plan: async ({ fields, content }) => {
      if (fields.provisional !== undefined) {
        return {
          ok: false,
          result: {
            success: false,
            error: "Question has a provisional decision; a decided question is not asked again",
          },
        };
      }
      delete fields["dismissed-at"];
      fields["asked-at"] = getBoxTimeISO(ctx.boxRoot);

      const split = splitCardContent(content);
      const cardContent = renderFrontmatterBlock(fields, split.body);

      return {
        ok: true,
        plan: {
          writes: [{ absPath: fullPath, content: cardContent }],
          commit: { message: `Reraise question: ${path.basename(question, ".card")}` },
        },
      };
    },
  });
  if (!outcome.ok) {
    return outcome.result;
  }

  ctx.writeLine(`Asked again: ${relativePath}`);

  return { success: true, data: { path: relativePath } };
}

export const questionReraiseCommand: CommandDefinition = {
  name: "question-reraise",
  description: "Ask a dismissed question again, as the newest question",
  args: [
    { name: "question", description: "Question card path (relative to box root)", required: true, type: "string" },
  ],
  execute: executeQuestionReraise,
};

export { executeQuestionReraise };
