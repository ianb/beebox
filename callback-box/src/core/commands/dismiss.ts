/**
 * Dismiss command - Dismiss a pending question.
 *
 * Flips a pending question to `dismissed` (the boxholder declined to answer it)
 * under the same guarded, atomic transition as `answer` — but with NO follow-up
 * job. Dismissed questions stay answerable later (an un-dismissal is the
 * boxholder's prerogative; see the answer command's allowed statuses).
 */

import * as path from "node:path";
import { renderFrontmatterBlock, splitCardContent } from "../../cards/index.js";
import { z } from "zod";
import {
  registerCommand,
  parseCommandArgs,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { getBoxTimeISO } from "../../lib/time.js";
import { withQuestionTransition, resolveContainedQuestionPath } from "./question-transition.js";

const DismissArgsSchema = z.object({
  question: z.string().optional(),
});
export type DismissArgs = z.infer<typeof DismissArgsSchema>;

async function executeDismiss(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const dismissArgs = parseCommandArgs(args, DismissArgsSchema);

  if (!dismissArgs.question) {
    return { success: false, error: "Question path is required" };
  }
  const question = dismissArgs.question;

  const contained = resolveContainedQuestionPath(ctx.boxRoot, question);
  if (!contained.ok) {
    return { success: false, error: contained.error };
  }
  const { fullPath, relativePath } = contained;

  const outcome = await withQuestionTransition({
    ctx,
    fullPath,
    questionRef: question,
    allowedStatuses: ["pending"],
    disallowedMessage: (status) =>
      `Question is not pending (status: ${status}); only a pending question can be dismissed`,
    plan: async ({ fields, content }) => {
      fields.status = "dismissed";
      fields["dismissed-at"] = getBoxTimeISO(ctx.boxRoot);

      const split = splitCardContent(content);
      const cardContent = renderFrontmatterBlock(fields, split.body);

      return {
        ok: true,
        plan: {
          writes: [{ absPath: fullPath, content: cardContent }],
          commit: { message: `Dismiss question: ${path.basename(question, ".card")}` },
        },
      };
    },
  });
  if (!outcome.ok) {
    return outcome.result;
  }

  ctx.writeLine(`Dismissed: ${relativePath}`);

  return { success: true, data: { path: relativePath } };
}

registerCommand({
  name: "dismiss",
  description: "Dismiss a pending question",
  args: [
    {
      name: "question",
      description: "Question card path (relative to box root)",
      required: true,
      type: "string",
    },
  ],
  execute: executeDismiss,
});

export { executeDismiss };
