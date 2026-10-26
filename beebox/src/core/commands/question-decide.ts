/**
 * Question-decide command - Record what the box decided in place of an answer.
 *
 * Sets `provisional` on a pending, dismissed, or expired question (and
 * `dismissed-at` when it was pending, so a decided question leaves the
 * rotation) under the same guarded, atomic transition as `answer`. It is not
 * an answer: `answered-at` and `answer` stay unset, and a later answer keeps
 * `provisional` as history. A card that already carries `provisional` is
 * refused, so an earlier decision is never silently overwritten.
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

const QuestionDecideArgsSchema = z.object({
  question: z.string().optional(),
  decision: z.string().optional(),
  reasoning: z.string().optional(),
  undo: z.string().optional(),
});

async function executeQuestionDecide(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const parsed = parseCommandArgs(args, QuestionDecideArgsSchema);

  const { question, decision, reasoning, undo } = parsed;
  if (!question) return { success: false, error: "Question path is required" };
  if (!decision?.trim()) return { success: false, error: "--decision is required" };
  if (!reasoning?.trim()) return { success: false, error: "--reasoning is required" };
  if (!undo?.trim()) return { success: false, error: "--undo is required" };

  const contained = resolveContainedQuestionPath(ctx.boxRoot, question);
  if (!contained.ok) {
    return { success: false, error: contained.error };
  }
  const { fullPath, relativePath } = contained;

  const outcome = await withQuestionTransition({
    ctx,
    fullPath,
    questionRef: question,
    allowedStates: ["pending", "dismissed", "expired"],
    disallowedMessage: (state) =>
      `Question is ${state}; a decision can be recorded only on a pending, dismissed, or expired question`,
    plan: async ({ fields, content }) => {
      if (fields.provisional !== undefined) {
        return {
          ok: false,
          result: {
            success: false,
            error: "Question already has a provisional decision; it is not overwritten",
          },
        };
      }
      const now = getBoxTimeISO(ctx.boxRoot);
      fields.provisional = { decision, reasoning, undo, "decided-at": now };
      if (fields["dismissed-at"] === undefined && fields["expired-at"] === undefined) {
        fields["dismissed-at"] = now;
      }

      const split = splitCardContent(content);
      const cardContent = renderFrontmatterBlock(fields, split.body);

      return {
        ok: true,
        plan: {
          writes: [{ absPath: fullPath, content: cardContent }],
          commit: { message: `Decide question: ${path.basename(question, ".card")}` },
        },
      };
    },
  });
  if (!outcome.ok) {
    return outcome.result;
  }

  ctx.writeLine(`Decided: ${relativePath}`);

  return { success: true, data: { path: relativePath } };
}

export const questionDecideCommand: CommandDefinition = {
  name: "question-decide",
  description: "Record what the box decided in place of an answer to a question",
  args: [
    { name: "question", description: "Question card path (relative to box root)", required: true, type: "string" },
    { name: "decision", description: "What the box decided", required: true, type: "string" },
    { name: "reasoning", description: "Why the box decided it", required: true, type: "string" },
    { name: "undo", description: "How to reverse the decision if the person answers differently", required: true, type: "string" },
  ],
  execute: executeQuestionDecide,
};

export { executeQuestionDecide };
