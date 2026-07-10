/**
 * Answer command - Answer a pending question.
 *
 * This is the core logic shared by both CLI and web API. The status change,
 * the answered-card write, and the follow-up-job write all land in ONE guarded,
 * atomic commit (see `question-transition.ts`).
 */

import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { renderFrontmatterBlock, splitCardContent } from "../../cards/index.js";
import { z } from "zod";
import {
  registerCommand,
  parseCommandArgs,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { getBoxTimeISO } from "../../lib/time.js";
import { assertNever } from "../../lib/invariant.js";
import { type QuestionFields } from "../../schemas/question.js";
import { createQuestionFollowupJobTemplate } from "../../schemas/question-followup-job.js";
import { withQuestionTransition, resolveContainedQuestionPath } from "./question-transition.js";

const AnswerVia = z.enum(["web", "cli", "api"]);
type AnswerViaValue = z.infer<typeof AnswerVia>;

const AnswerArgsSchema = z.object({
  question: z.string().optional(),
  answer: z.string().optional(),
  selectedId: z.string().optional(),
  // Validated here (a Zod enum) rather than cast at the write site — a junk
  // `via` is rejected at the dispatch boundary, not silently recorded.
  via: AnswerVia.optional(),
});
export type AnswerArgs = z.infer<typeof AnswerArgsSchema>;

/**
 * The normalized products of resolving a raw answer against a question:
 * - `answerText` → the card's `answer.text`;
 * - `selectedId` → the card's `answer.selected`;
 * - `jobAnswer`  → the follow-up job's `answer` (may fold a confirm decision
 *   and its note together so the follow-up agent sees both).
 */
interface ResolvedAnswer {
  answerText: string;
  selectedId: string | undefined;
  jobAnswer: string;
}

type ResolveResult = ({ ok: true } & ResolvedAnswer) | { ok: false; result: CommandResult };

/**
 * Resolve the raw answer/selectedId against a select-type question's options.
 */
function resolveSelectAnswer(
  rawAnswer: string,
  questionOptions: QuestionFields["input"]["options"] & object
): ResolveResult {
  const optionIndex = (rawAnswer.codePointAt(0) ?? 0) - 97;
  if (rawAnswer.length === 1 && optionIndex >= 0 && optionIndex < questionOptions.length) {
    const option = questionOptions[optionIndex];
    if (option) {
      return { ok: true, answerText: option.label, selectedId: option.id, jobAnswer: option.label };
    }
    return { ok: true, answerText: rawAnswer, selectedId: undefined, jobAnswer: rawAnswer };
  }

  const match = questionOptions.find((o) => o.label.toLowerCase() === rawAnswer.toLowerCase());
  if (match) {
    return { ok: true, answerText: match.label, selectedId: match.id, jobAnswer: match.label };
  }

  const optionsList = questionOptions
    .map((o, i) => `  ${String.fromCodePoint(97 + i)}) ${o.label}`)
    .join("\n");
  return {
    ok: false,
    result: { success: false, error: `Invalid option. Available options:\n${optionsList}` },
  };
}

/**
 * Resolve a select question: by typed answer/letter, or by `selectedId` alone.
 */
function resolveSelect(
  args: { answer: string | undefined; selectedId: string | undefined },
  questionOptions: QuestionFields["input"]["options"] & object
): ResolveResult {
  // A typed answer (a label or a letter) takes precedence; the frontend form
  // sends the chosen option's label as `answer`, which resolves here.
  if (args.answer !== undefined) {
    return resolveSelectAnswer(args.answer, questionOptions);
  }
  // A select answered by `selectedId` alone — a direct API/CLI path (not the
  // web form, which sends the label as `answer`). Resolve the id to its label
  // so the recorded answer and the follow-up job carry the label, not an id.
  const option = questionOptions.find((o) => o.id === args.selectedId);
  if (!option) {
    return {
      ok: false,
      result: { success: false, error: `Unknown option id: ${args.selectedId ?? ""}` },
    };
  }
  return { ok: true, answerText: option.label, selectedId: option.id, jobAnswer: option.label };
}

/**
 * Resolve a confirm question. The new UI path sends `selectedId: "yes" | "no"`
 * directly with an optional free-text `answer` note; a typed free-text answer
 * still normalizes to yes/no.
 */
function resolveConfirm(
  args: { answer: string | undefined; selectedId: string | undefined }
): ResolveResult {
  if (args.selectedId !== undefined) {
    if (args.selectedId !== "yes" && args.selectedId !== "no") {
      return {
        ok: false,
        result: {
          success: false,
          error: `Confirm answer must be "yes" or "no" (got "${args.selectedId}")`,
        },
      };
    }
    const note = args.answer;
    return {
      ok: true,
      answerText: note ?? args.selectedId,
      selectedId: args.selectedId,
      jobAnswer: note ? `${args.selectedId} (${note})` : args.selectedId,
    };
  }

  const normalized = (args.answer ?? "").toLowerCase();
  if (["yes", "y", "true", "1"].includes(normalized)) {
    return { ok: true, answerText: "yes", selectedId: "yes", jobAnswer: "yes" };
  }
  if (["no", "n", "false", "0"].includes(normalized)) {
    return { ok: true, answerText: "no", selectedId: "no", jobAnswer: "no" };
  }
  return {
    ok: false,
    result: { success: false, error: "Confirm questions require a yes/no answer" },
  };
}

/**
 * Resolve the final answer text, selected id, and follow-up-job answer for a
 * question, applying select/confirm normalization.
 */
function resolveAnswer(
  fields: QuestionFields,
  args: { answer: string | undefined; selectedId: string | undefined }
): ResolveResult {
  const inputType = fields.input.type;
  switch (inputType) {
    case "select":
      return resolveSelect(args, fields.input.options ?? []);
    case "confirm":
      return resolveConfirm(args);
    case "text":
      return {
        ok: true,
        answerText: args.answer ?? "",
        selectedId: args.selectedId,
        jobAnswer: args.answer ?? "",
      };
    default:
      return assertNever(inputType);
  }
}

/**
 * Build a collision-proof follow-up job filename: the box time, the question's
 * slug, and a short random suffix — so two questions answered in the same
 * second (the old second-resolution name collided) still get distinct files.
 */
function buildJobFilename(boxRoot: string, questionRef: string): string {
  const timestamp = getBoxTimeISO(boxRoot).replace(/[.:]/g, "-").slice(0, 19);
  const slug =
    path
      .basename(questionRef, ".card")
      .replace(/[^\w-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "question";
  const suffix = randomUUID().slice(0, 8);
  return `${timestamp}-${slug}-${suffix}.question-followup.job.card`;
}

async function executeAnswer(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const answerArgs = parseCommandArgs(args, AnswerArgsSchema);

  if (!answerArgs.question) {
    return { success: false, error: "Question path is required" };
  }
  if (!answerArgs.answer && !answerArgs.selectedId) {
    return { success: false, error: "Answer or selectedId is required" };
  }

  const via: AnswerViaValue = answerArgs.via ?? "cli";
  const question = answerArgs.question;

  const contained = resolveContainedQuestionPath(ctx.boxRoot, question);
  if (!contained.ok) {
    return { success: false, error: contained.error };
  }
  const { fullPath, relativePath } = contained;
  let resolved: ResolvedAnswer | undefined;
  let jobRelative: string | undefined;

  const outcome = await withQuestionTransition({
    ctx,
    fullPath,
    questionRef: question,
    // Answering is allowed from every non-terminal status: expired and
    // dismissed questions stay answerable; only `answered` is terminal.
    allowedStatuses: ["pending", "expired", "dismissed"],
    disallowedMessage: (status) =>
      `Question is already answered (status: ${status}); an answered question is terminal`,
    plan: async ({ fields, content }) => {
      const r = resolveAnswer(fields, {
        answer: answerArgs.answer,
        selectedId: answerArgs.selectedId,
      });
      if (!r.ok) return { ok: false, result: r.result };
      resolved = r;

      fields.status = "answered";
      fields.answer = {
        text: r.answerText,
        ...(r.selectedId !== undefined && { selected: r.selectedId }),
      };
      fields["answered-at"] = getBoxTimeISO(ctx.boxRoot);
      fields["answered-via"] = via;
      // Clear stale lifecycle bookkeeping from a prior expired/dismissed state:
      // status is single, so an `answered` card must not carry `dismissed-at`
      // or `expired-at` (the schema's coherence refinement enforces this).
      delete fields["dismissed-at"];
      delete fields["expired-at"];

      const split = splitCardContent(content);
      const cardContent = renderFrontmatterBlock(fields, split.body);

      const jobFilename = buildJobFilename(ctx.boxRoot, relativePath);
      const jobAbsPath = path.join(ctx.boxRoot, "box/jobs", jobFilename);
      jobRelative = path.relative(ctx.boxRoot, jobAbsPath);
      const jobContent = createQuestionFollowupJobTemplate({
        description: `Follow up on answered question: ${fields.prompt}`,
        questionRef: relativePath,
        directive: fields.directive ?? "Process the answer to this question",
        answer: r.jobAnswer,
        ...(fields.learning !== undefined && { learning: fields.learning }),
      });

      return {
        ok: true,
        plan: {
          // Job FIRST, then the card: the card's status flip is the commit
          // point, so the follow-up job must already exist on disk before it
          // (see applyAndCommit's write-order invariant). A crash between the
          // two writes leaves job+pending-question (recoverable), never an
          // answered card with no job.
          writes: [
            { absPath: jobAbsPath, content: jobContent },
            { absPath: fullPath, content: cardContent },
          ],
          commit: {
            message: `Answer question: ${path.basename(question, ".card")}`,
            trailers: { "Answered-Via": via },
          },
        },
      };
    },
  });
  if (!outcome.ok) {
    return outcome.result;
  }

  ctx.writeLine(`Answered: ${relativePath}`);
  if (resolved) {
    ctx.writeLine(`  Answer: ${resolved.answerText}`);
    if (resolved.selectedId) {
      ctx.writeLine(`  Selected: ${resolved.selectedId}`);
    }
  }
  if (jobRelative) {
    ctx.writeLine(`  Created follow-up job: ${jobRelative}`);
  }

  return {
    success: true,
    data: {
      path: relativePath,
      answer: resolved?.answerText,
      selectedId: resolved?.selectedId,
    },
  };
}

registerCommand({
  name: "answer",
  description: "Answer a pending question",
  args: [
    {
      name: "question",
      description: "Question card path (relative to box root)",
      required: true,
      type: "string",
    },
    {
      name: "answer",
      description: "Answer text or option ID (a, b, c, etc.)",
      required: true,
      type: "string",
    },
    {
      name: "selectedId",
      description: "Selected option ID (for select questions)",
      required: false,
      type: "string",
    },
    {
      name: "via",
      description: "Answer source (web, cli, or api)",
      required: false,
      default: "cli",
      type: "string",
    },
  ],
  execute: executeAnswer,
});

export { executeAnswer };
