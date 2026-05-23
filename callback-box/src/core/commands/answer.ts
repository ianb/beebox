/**
 * Answer command - Answer a pending question.
 *
 * This is the core logic shared by both CLI and web API.
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { stringify as stringifyYaml } from "yaml";
import { splitCardContent } from "cardworks";
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

  let content: string;
  try {
    content = await fs.readFile(fullPath, "utf-8");
  } catch {
    return { success: false, error: `Could not load card: ${answerArgs.question}` };
  }

  let fields: QuestionFields;
  try {
    const card = parseCardText(content, {
      source: fullPath,
      schemas: createCardSchemaMap(),
    });
    if (card.schema.type !== "question") {
      return { success: false, error: `Not a question card (got ${card.schema.type})` };
    }
    fields = card.fields as unknown as QuestionFields;
  } catch (err) {
    return { success: false, error: `Could not parse question: ${(err as Error).message}` };
  }

  if (fields.status !== "pending") {
    return {
      success: false,
      error: `Question is not pending (status: ${fields.status})`,
    };
  }

  const inputType = fields.input.type;
  const questionOptions = fields.input.options ?? [];

  let finalAnswer = answerArgs.answer;
  let selectedId = answerArgs.selectedId;

  if (inputType === "select" && !selectedId) {
    const optionIndex = (answerArgs.answer.codePointAt(0) ?? 0) - 97;
    if (
      answerArgs.answer.length === 1 &&
      optionIndex >= 0 &&
      optionIndex < questionOptions.length
    ) {
      const option = questionOptions[optionIndex];
      if (option) {
        selectedId = option.id;
        finalAnswer = option.label;
      }
    } else {
      const match = questionOptions.find(
        (o) => o.label.toLowerCase() === answerArgs.answer.toLowerCase()
      );
      if (match) {
        selectedId = match.id;
        finalAnswer = match.label;
      } else {
        const optionsList = questionOptions
          .map((o, i) => `  ${String.fromCodePoint(97 + i)}) ${o.label}`)
          .join("\n");
        return {
          success: false,
          error: `Invalid option. Available options:\n${optionsList}`,
        };
      }
    }
  } else if (inputType === "confirm") {
    const normalized = answerArgs.answer.toLowerCase();
    if (["yes", "y", "true", "1"].includes(normalized)) {
      finalAnswer = "yes";
      selectedId = "yes";
    } else if (["no", "n", "false", "0"].includes(normalized)) {
      finalAnswer = "no";
      selectedId = "no";
    } else {
      return {
        success: false,
        error: "Confirm questions require yes/no answer",
      };
    }
  }

  fields.status = "answered";
  fields.answer = {
    text: finalAnswer,
    ...(selectedId !== undefined && { selected: selectedId }),
  };
  fields["answered-at"] = new Date().toISOString();
  fields["answered-via"] = via as "web" | "cli" | "api";

  const split = splitCardContent(content);
  await fs.writeFile(
    fullPath,
    `---\n${stringifyYaml(fields)}---\n${split.body}`
  );

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

  const timestamp = new Date()
    .toISOString()
    .replace(/[.:]/g, "-")
    .slice(0, 19);
  const jobFilename = `${timestamp}-question-followup.question-followup.job.card`;
  const jobPath = path.join(ctx.boxRoot, "box/jobs", jobFilename);
  const jobContent = createQuestionFollowupJobTemplate({
    description: `Follow up on answered question: ${fields.prompt}`,
    questionRef: relativePath,
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
