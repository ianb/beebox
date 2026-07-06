/**
 * Question card schema - pending questions for user input.
 *
 * Questions are created when the system needs human guidance.
 * They can have different input types (select, text, confirm).
 */

import { cardSchema, renderFrontmatterBlock, type InferCardFields } from "../cards/index.js";
import { z } from "zod";

export const QuestionStatus = z.enum(["pending", "answered", "expired"]);
export type QuestionStatusType = z.infer<typeof QuestionStatus>;

export const QuestionInputType = z.enum(["select", "text", "confirm"]);
export type QuestionInputTypeValue = z.infer<typeof QuestionInputType>;

const QuestionOption = z.object({
  id: z.string(),
  label: z.string(),
});

const QuestionInputField = z.object({
  type: QuestionInputType,
  options: z.array(QuestionOption).optional(),
});

const QuestionContextEntry = z.object({
  ref: z.string(),
  text: z.string().optional(),
});

const QuestionAnswer = z.object({
  text: z.string().optional(),
  selected: z.string().optional(),
});

export const QuestionSchema = cardSchema("question", {
  description: "Asks the user something (select/text/confirm) and routes the answer back to an agent via its directive",
  category: "authored",
  fields: {
    status: QuestionStatus.default("pending"),
    "answered-by": z.string().optional(),
    memo: z.string().optional(),
    prompt: z.string(),
    input: QuestionInputField,
    directive: z.string().optional(),
    context: z.array(QuestionContextEntry).optional(),
    answer: QuestionAnswer.optional(),
    "answered-at": z.string().datetime({ offset: true }).optional(),
    "answered-via": z.enum(["web", "cli", "api"]).optional(),
  },
  instructions: `# Question Cards

A question card asks the user something and routes the answer back for processing.

## Frontmatter

- \`status:\` — \`pending\`, \`answered\`, or \`expired\`. Default \`pending\`.
- \`answered-by:\` — which agent should process the answer. Always set it.
- \`memo:\` — context explaining WHY you're asking, so the user can answer without looking anything up.
- \`prompt:\` — the actual question.
- \`input:\` — \`{type: select|text|confirm, options?: [{id, label}]}\`. Options required for select.
- \`directive:\` — what to do with the answer. The system creates a follow-up job using this text as instructions. Be specific. Without a directive, the answer goes nowhere.
- \`context:\` — array of \`{ref, text?}\` linking to related cards.

After the user answers, the system fills in:
- \`answer:\` — \`{text, selected?}\` where \`selected\` is the option id for select questions.
- \`answered-at:\` — ISO 8601 timestamp.
- \`answered-via:\` — \`web\`, \`cli\`, or \`api\`.

For select questions, make options mutually exclusive. For confirm questions, make the prompt unambiguous about what "yes" means.`,
});

export type QuestionFields = InferCardFields<typeof QuestionSchema>;

interface CreateSelectQuestionTemplateParams {
  memo: string;
  prompt: string;
  options: Array<{ id: string; label: string }>;
  directive?: string;
}

export function createSelectQuestionTemplate(
  params: CreateSelectQuestionTemplateParams
): string {
  const fields: Record<string, unknown> = {
    status: "pending",
    memo: params.memo,
    prompt: params.prompt,
    input: { type: "select", options: params.options },
  };
  if (params.directive !== undefined) fields["directive"] = params.directive;
  return renderFrontmatterBlock(fields);
}

interface CreateQuestionTemplateParams {
  memo: string;
  prompt: string;
  directive?: string;
}

export function createTextQuestionTemplate(params: CreateQuestionTemplateParams): string {
  const fields: Record<string, unknown> = {
    status: "pending",
    memo: params.memo,
    prompt: params.prompt,
    input: { type: "text" },
  };
  if (params.directive !== undefined) fields["directive"] = params.directive;
  return renderFrontmatterBlock(fields);
}

export function createConfirmQuestionTemplate(params: CreateQuestionTemplateParams): string {
  const fields: Record<string, unknown> = {
    status: "pending",
    memo: params.memo,
    prompt: params.prompt,
    input: { type: "confirm" },
  };
  if (params.directive !== undefined) fields["directive"] = params.directive;
  return renderFrontmatterBlock(fields);
}
