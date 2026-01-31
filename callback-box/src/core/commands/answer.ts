/**
 * Answer command - Answer a pending question.
 *
 * This is the core logic shared by both CLI and web API.
 */

import * as path from "node:path";
import {
  registerCommand,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { boxPath, isCardFile } from "../../cli/lib/paths.js";
import { createLoader } from "../../cli/lib/loader.js";
import { stageFiles, commit } from "../../cli/lib/git.js";
import type { ElementNode } from "cardworks";

/**
 * Arguments for the answer command.
 */
export interface AnswerArgs {
  /** Question card path (relative to box root or absolute) */
  question: string;
  /** Answer text or option ID (a, b, c, etc.) */
  answer: string;
  /** Optional selected ID (for select questions) */
  selectedId?: string;
  /** Answer source (e.g., "cli", "web") */
  via?: string;
}

/**
 * Execute the answer command.
 */
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

  // Resolve path
  let fullPath: string;
  if (path.isAbsolute(answerArgs.question)) {
    fullPath = answerArgs.question;
  } else {
    fullPath = boxPath(ctx.boxRoot, answerArgs.question);
  }

  if (!isCardFile(fullPath)) {
    return { success: false, error: "Path must be a card file (*.card)" };
  }

  const loader = createLoader(ctx.boxRoot);

  // Load the question
  let card;
  try {
    card = await loader.load(fullPath);
  } catch {
    return { success: false, error: `Could not load card: ${answerArgs.question}` };
  }

  const element = card.element;

  // Verify it's a question
  if (element.tagName !== "question") {
    return { success: false, error: `Not a question card (got ${element.tagName})` };
  }

  // Verify it's pending
  if (element.attrs["status"] !== "pending") {
    return {
      success: false,
      error: `Question is not pending (status: ${element.attrs["status"]})`,
    };
  }

  // Find input type and options
  let inputType = "text";
  let questionOptions: Array<{ id: string; text: string }> = [];

  for (const child of element.children as ElementNode[]) {
    if (child.tagName === "input") {
      inputType = child.attrs["type"] ?? "text";
      questionOptions = (child.children as ElementNode[])
        .filter((c) => c.tagName === "option")
        .map((c) => ({
          id: c.attrs["id"] ?? "",
          text: c.text ?? "",
        }));
    }
  }

  // Resolve the answer
  let finalAnswer = answerArgs.answer;
  let selectedId = answerArgs.selectedId;

  if (inputType === "select" && !selectedId) {
    // Check if answer is an option ID (a, b, c, etc.)
    const optionIndex = answerArgs.answer.charCodeAt(0) - 97; // 'a' = 0, 'b' = 1, etc.
    if (
      answerArgs.answer.length === 1 &&
      optionIndex >= 0 &&
      optionIndex < questionOptions.length
    ) {
      const option = questionOptions[optionIndex];
      if (option) {
        selectedId = option.id;
        finalAnswer = option.text;
      }
    } else {
      // Try to match by text
      const match = questionOptions.find(
        (o) => o.text.toLowerCase() === answerArgs.answer.toLowerCase()
      );
      if (match) {
        selectedId = match.id;
        finalAnswer = match.text;
      } else {
        const optionsList = questionOptions
          .map((o, i) => `  ${String.fromCharCode(97 + i)}) ${o.text}`)
          .join("\n");
        return {
          success: false,
          error: `Invalid option. Available options:\n${optionsList}`,
        };
      }
    }
  } else if (inputType === "confirm") {
    // Normalize yes/no answers
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

  // Update the card
  element.attrs["status"] = "answered";

  // Add answer elements
  const children = element.children as ElementNode[];

  children.push({
    tagName: "answer",
    attrs: selectedId ? { selected: selectedId } : {},
    children: [],
    text: finalAnswer,
    location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
    comments: {},
    dirty: true,
  });

  children.push({
    tagName: "answered-at",
    attrs: {},
    children: [],
    text: new Date().toISOString(),
    location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
    comments: {},
    dirty: true,
  });

  children.push({
    tagName: "answered-via",
    attrs: {},
    children: [],
    text: via,
    location: { source: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
    comments: {},
    dirty: true,
  });

  // Save the card
  await loader.save(card);

  // Commit the change
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

  return {
    success: true,
    data: {
      path: relativePath,
      answer: finalAnswer,
      selectedId,
    },
  };
}

// Register the command
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
