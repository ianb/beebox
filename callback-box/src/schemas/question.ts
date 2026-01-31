/**
 * Question card schema - pending questions for user input.
 *
 * Questions are created when the system needs human guidance.
 * They can have different input types (select, text, confirm).
 */

import { element } from "cardworks";
import { z } from "zod";

/**
 * Valid question statuses.
 */
export const QuestionStatus = z.enum(["pending", "answered", "expired"]);
export type QuestionStatus = z.infer<typeof QuestionStatus>;

/**
 * Input types for questions.
 */
export const QuestionInputType = z.enum(["select", "text", "confirm"]);
export type QuestionInputType = z.infer<typeof QuestionInputType>;

/**
 * Child element for context/memo about the question.
 */
export const QuestionMemo = element("memo", {
  text: z.string(),
});

/**
 * Child element for the prompt text.
 */
export const QuestionPrompt = element("prompt", {
  text: z.string(),
});

/**
 * Child element for a single option in select input.
 */
export const QuestionOption = element("option", {
  attrs: {
    id: z.string(),
  },
  text: z.string(),
});

/**
 * Child element for input configuration.
 */
export const QuestionInput = element("input", {
  attrs: {
    type: QuestionInputType,
  },
  children: z.array(QuestionOption).optional(),
});

/**
 * Child element for the answer.
 */
export const QuestionAnswer = element("answer", {
  attrs: {
    selected: z.string().optional(), // For select type
  },
  text: z.string().optional(),
});

/**
 * Child element for answered timestamp.
 */
export const QuestionAnsweredAt = element("answered-at", {
  text: z.string().datetime({ offset: true }),
});

/**
 * Child element for answer source.
 */
export const QuestionAnsweredVia = element("answered-via", {
  text: z.enum(["web", "cli", "api"]),
});

/**
 * Question card schema.
 *
 * Pending example:
 * ```xml
 * <question status="pending">
 *   <memo>Context about what's being asked</memo>
 *   <prompt>What should I do?</prompt>
 *   <input type="select">
 *     <option id="a">Option A</option>
 *     <option id="b">Option B</option>
 *   </input>
 * </question>
 * ```
 *
 * Answered example:
 * ```xml
 * <question status="answered">
 *   <memo>Context about what's being asked</memo>
 *   <prompt>What should I do?</prompt>
 *   <input type="select">
 *     <option id="a">Option A</option>
 *     <option id="b">Option B</option>
 *   </input>
 *   <answer selected="a">Option A</answer>
 *   <answered-at>2024-01-15T11:00:00Z</answered-at>
 *   <answered-via>web</answered-via>
 * </question>
 * ```
 */
export const QuestionSchema = element("question", {
  attrs: {
    status: QuestionStatus.default("pending"),
  },
  // Note: We use a loose children schema to allow both pending and answered states
  // Proper validation happens at the application layer
  children: z.array(z.union([
    QuestionMemo,
    QuestionPrompt,
    QuestionInput,
    QuestionAnswer,
    QuestionAnsweredAt,
    QuestionAnsweredVia,
  ])),
});

export type Question = z.infer<typeof QuestionSchema>;

/**
 * Template for creating a new question card with select options.
 */
export function createSelectQuestionTemplate(
  memo: string,
  prompt: string,
  options: Array<{ id: string; label: string }>
): string {
  const optionsXml = options
    .map(opt => `    <option id="${escapeXml(opt.id)}">${escapeXml(opt.label)}</option>`)
    .join("\n");

  return `<question status="pending">
  <memo>${escapeXml(memo)}</memo>
  <prompt>${escapeXml(prompt)}</prompt>
  <input type="select">
${optionsXml}
  </input>
</question>
`;
}

/**
 * Template for creating a new question card with text input.
 */
export function createTextQuestionTemplate(memo: string, prompt: string): string {
  return `<question status="pending">
  <memo>${escapeXml(memo)}</memo>
  <prompt>${escapeXml(prompt)}</prompt>
  <input type="text" />
</question>
`;
}

/**
 * Template for creating a confirm (yes/no) question.
 */
export function createConfirmQuestionTemplate(memo: string, prompt: string): string {
  return `<question status="pending">
  <memo>${escapeXml(memo)}</memo>
  <prompt>${escapeXml(prompt)}</prompt>
  <input type="confirm" />
</question>
`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
