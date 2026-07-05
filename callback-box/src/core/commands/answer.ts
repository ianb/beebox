/**
 * Answer command - Answer a pending question.
 *
 * This is the core logic shared by both CLI and web API.
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { renderFrontmatterBlock, splitCardContent } from "../../cards/index.js";
import {
  registerCommand,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { boxPath, isCardFile } from "../../cli/lib/paths.js";
import { stageFiles, commit } from "../../cli/lib/git.js";
import { parseCardText } from "../card-io.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import { type QuestionFields } from "../../schemas/question.js";
import { createQuestionFollowupJobTemplate } from "../../schemas/question-followup-job.js";

export interface AnswerArgs {
  question: string;
  answer: string;
  selectedId?: string;
  via?: string;
}

/**
 * Load, parse, and validate the question card at the given path.
 * Returns either the parsed fields or a failure result to short-circuit on.
 */
async function loadPendingQuestion(
  fullPath: string,
  questionRef: string
): Promise<
  { ok: true; fields: QuestionFields; content: string } | { ok: false; result: CommandResult }
> {
  let content: string;
  try {
    content = await fs.readFile(fullPath, "utf-8");
  } catch (e) {
    console.warn(`Could not load card ${fullPath}:`, e);
    return {
      ok: false,
      result: { success: false, error: `Could not load card: ${questionRef}` },
    };
  }

  let fields: QuestionFields;
  try {
    const card = parseCardText(content, {
      source: fullPath,
      schemas: await createCardSchemaMap(),
    });
    if (card.schema.type !== "question") {
      return {
        ok: false,
        result: { success: false, error: `Not a question card (got ${card.schema.type})` },
      };
    }
    fields = card.fields as unknown as QuestionFields;
  } catch (err) {
    return {
      ok: false,
      result: {
        success: false,
        error: `Could not parse question: ${(err as Error).message}`,
      },
    };
  }

  if (fields.status !== "pending") {
    return {
      ok: false,
      result: {
        success: false,
        error: `Question is not pending (status: ${fields.status})`,
      },
    };
  }

  return { ok: true, fields, content };
}

/**
 * Resolve the raw answer/selectedId against a select-type question's options.
 * Returns the normalized answer/selection or a failure result.
 */
function resolveSelectAnswer(
  rawAnswer: string,
  questionOptions: QuestionFields["input"]["options"] & object
):
  | { ok: true; finalAnswer: string; selectedId: string | undefined }
  | { ok: false; result: CommandResult } {
  const optionIndex = (rawAnswer.codePointAt(0) ?? 0) - 97;
  if (rawAnswer.length === 1 && optionIndex >= 0 && optionIndex < questionOptions.length) {
    const option = questionOptions[optionIndex];
    if (option) {
      return { ok: true, finalAnswer: option.label, selectedId: option.id };
    }
    return { ok: true, finalAnswer: rawAnswer, selectedId: undefined };
  }

  const match = questionOptions.find(
    (o) => o.label.toLowerCase() === rawAnswer.toLowerCase()
  );
  if (match) {
    return { ok: true, finalAnswer: match.label, selectedId: match.id };
  }

  const optionsList = questionOptions
    .map((o, i) => `  ${String.fromCodePoint(97 + i)}) ${o.label}`)
    .join("\n");
  return {
    ok: false,
    result: {
      success: false,
      error: `Invalid option. Available options:\n${optionsList}`,
    },
  };
}

/**
 * Resolve the raw answer for a confirm-type question to yes/no.
 */
function resolveConfirmAnswer(
  rawAnswer: string
):
  | { ok: true; finalAnswer: string; selectedId: string }
  | { ok: false; result: CommandResult } {
  const normalized = rawAnswer.toLowerCase();
  if (["yes", "y", "true", "1"].includes(normalized)) {
    return { ok: true, finalAnswer: "yes", selectedId: "yes" };
  }
  if (["no", "n", "false", "0"].includes(normalized)) {
    return { ok: true, finalAnswer: "no", selectedId: "no" };
  }
  return {
    ok: false,
    result: {
      success: false,
      error: "Confirm questions require yes/no answer",
    },
  };
}

/**
 * Resolve the final answer text and selected option ID for a question,
 * applying select/confirm normalization. Returns a failure result on
 * invalid input.
 */
function resolveAnswer(
  fields: QuestionFields,
  args: { answer: string; selectedId: string | undefined }
):
  | { ok: true; finalAnswer: string; selectedId: string | undefined }
  | { ok: false; result: CommandResult } {
  const inputType = fields.input.type;
  const questionOptions = fields.input.options ?? [];

  if (inputType === "select" && !args.selectedId) {
    return resolveSelectAnswer(args.answer, questionOptions);
  }

  if (inputType === "confirm") {
    return resolveConfirmAnswer(args.answer);
  }

  return { ok: true, finalAnswer: args.answer, selectedId: args.selectedId };
}

/**
 * Create and commit a follow-up job card for an answered question.
 * Returns the box-relative path of the created job.
 */
async function createFollowupJob(
  ctx: CommandContext,
  params: { fields: QuestionFields; questionRef: string; finalAnswer: string }
): Promise<string> {
  const { fields, questionRef, finalAnswer } = params;
  const timestamp = new Date()
    .toISOString()
    .replace(/[.:]/g, "-")
    .slice(0, 19);
  const jobFilename = `${timestamp}-question-followup.question-followup.job.card`;
  const jobPath = path.join(ctx.boxRoot, "box/jobs", jobFilename);
  const jobContent = createQuestionFollowupJobTemplate({
    description: `Follow up on answered question: ${fields.prompt}`,
    questionRef,
    directive: fields.directive ?? "Process the answer to this question",
    answer: finalAnswer,
  });

  await fs.mkdir(path.join(ctx.boxRoot, "box/jobs"), { recursive: true });
  await fs.writeFile(jobPath, jobContent);
  const jobRelative = path.relative(ctx.boxRoot, jobPath);
  await stageFiles(ctx.boxRoot, [jobRelative]);
  await commit(ctx.boxRoot, {
    message: "Create follow-up job for answered question",
  });
  return jobRelative;
}

async function executeAnswer(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const answerArgs = args as unknown as AnswerArgs;

  if (!answerArgs.question) {
    return { success: false, error: "Question path is required" };
  }
  if (!answerArgs.answer && !answerArgs.selectedId) {
    return { success: false, error: "Answer or selectedId is required" };
  }

  const via = answerArgs.via ?? "cli";

  let fullPath: string;
  if (path.isAbsolute(answerArgs.question)) {
    fullPath = answerArgs.question;
  } else {
    fullPath = boxPath(ctx.boxRoot, answerArgs.question);
  }

  if (!isCardFile(fullPath)) {
    return { success: false, error: "Path must be a card file (*.card)" };
  }

  const loaded = await loadPendingQuestion(fullPath, answerArgs.question);
  if (!loaded.ok) {
    return loaded.result;
  }
  const { fields, content } = loaded;

  const resolved = resolveAnswer(fields, {
    answer: answerArgs.answer,
    selectedId: answerArgs.selectedId,
  });
  if (!resolved.ok) {
    return resolved.result;
  }
  const { finalAnswer, selectedId } = resolved;

  fields.status = "answered";
  fields.answer = {
    text: finalAnswer,
    ...(selectedId !== undefined && { selected: selectedId }),
  };
  fields["answered-at"] = new Date().toISOString();
  fields["answered-via"] = via as "web" | "cli" | "api";

  const split = splitCardContent(content);
  await fs.writeFile(fullPath, renderFrontmatterBlock(fields, split.body));

  const relativePath = path.relative(ctx.boxRoot, fullPath);
  await stageFiles(ctx.boxRoot, [relativePath]);
  await commit(ctx.boxRoot, {
    message: `Answer question: ${path.basename(answerArgs.question, ".card")}`,
    trailers: {
      "Answered-Via": via,
    },
  });

  ctx.writeLine(`Answered: ${relativePath}`);
  ctx.writeLine(`  Answer: ${finalAnswer}`);
  if (selectedId) {
    ctx.writeLine(`  Selected: ${selectedId}`);
  }

  const jobRelative = await createFollowupJob(ctx, {
    fields,
    questionRef: relativePath,
    finalAnswer,
  });
  ctx.writeLine(`  Created follow-up job: ${jobRelative}`);

  return {
    success: true,
    data: {
      path: relativePath,
      answer: finalAnswer,
      selectedId,
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
      description: "Answer source (e.g., 'cli', 'web')",
      required: false,
      default: "cli",
      type: "string",
    },
  ],
  execute: executeAnswer,
});

export { executeAnswer };
