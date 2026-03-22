/**
 * Question card schema - pending questions for user input.
 *
 * Questions are created when the system needs human guidance.
 * They can have different input types (select, text, confirm).
 */

import { element, escapeText, escapeAttr } from "cardworks";
import { z } from "zod";

/**
 * Valid question statuses.
 */
export const QuestionStatus = z.enum(["pending", "answered", "expired"]);
export type QuestionStatusType = typeof QuestionStatus._type;

/**
 * Input types for questions.
 */
export const QuestionInputType = z.enum(["select", "text", "confirm"]);
export type QuestionInputTypeValue = typeof QuestionInputType._type;

/**
 * Child element for context/memo about the question.
 */
export const QuestionMemo = element("memo", {
  text: z.string(),
});

/**
 * Child element for referencing related cards.
 * Allows the agent to include context about what prompted the question.
 */
export const QuestionContext = element("context", {
  attrs: {
    /** Reference to related card (e.g., feedback or edition) */
    ref: z.string(),
  },
  /** Optional description of how this context relates */
  text: z.string().optional(),
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
 * Child element describing what the agent should do with the answer.
 * When present, answering the question creates a follow-up job.
 */
export const QuestionDirective = element("directive", {
  text: z.string(),
});

/**
 * Question card schema.
 *
 * Pending example:
 * ```xml
 * <question status="pending" answered-by="news-curation">
 * <memo>Context about what's being asked</memo>
 * <prompt>What should I do?</prompt>
 * <input type="select">
 * <option id="a">Option A</option>
 * <option id="b">Option B</option>
 * </input>
 * <directive>Update the news guide based on the user's preference</directive>
 * </question>
 * ```
 *
 * Answered example:
 * ```xml
 * <question status="answered" answered-by="news-curation">
 * <memo>Context about what's being asked</memo>
 * <prompt>What should I do?</prompt>
 * <input type="select">
 * <option id="a">Option A</option>
 * <option id="b">Option B</option>
 * </input>
 * <answer selected="a">Option A</answer>
 * <answered-at>2024-01-15T11:00:00Z</answered-at>
 * <answered-via>web</answered-via>
 * </question>
 * ```
 */
export const QuestionSchema = element("question", {
  attrs: {
    status: QuestionStatus.default("pending"),
    /**
     * Which agent should process this question's answer.
     * When the user answers, the system routes the answered question
     * to this agent for processing.
     */
    "answered-by": z.string().optional(),
  },
  // Note: We use a loose children schema to allow both pending and answered states
  // Proper validation happens at the application layer
  children: z.array(z.union([
    QuestionMemo,
    QuestionContext,
    QuestionPrompt,
    QuestionInput,
    QuestionDirective,
    QuestionAnswer,
    QuestionAnsweredAt,
    QuestionAnsweredVia,
  ])),
  instructions: `# Question Cards

A question card asks the user something and routes the answer back for processing.

Key elements:
- \`<memo>\` — context explaining WHY you're asking, so the user can answer without looking anything up
- \`<prompt>\` — the actual question
- \`<input type="select|text|confirm">\` — answer format, with \`<option>\` children for select type
- \`<directive>\` — what to do with the answer. The system creates a follow-up job using this text as instructions. Be specific: name files to edit, actions to take, decisions to apply. Without a directive, the answer goes nowhere.
- \`<context ref="...">\` — links to related cards

The \`answered-by\` attribute identifies which agent handles the follow-up job when the user answers. Always set it.

For select questions, make options mutually exclusive and cover the likely answers. For confirm questions, make the prompt unambiguous about what "yes" means.`,
});

export type Question = z.infer<typeof QuestionSchema>;

/**
 * Parameters for createSelectQuestionTemplate
 */
interface CreateSelectQuestionTemplateParams {
  memo: string;
  prompt: string;
  options: Array<{ id: string; label: string }>;
  directive?: string;
}

/**
 * Template for creating a new question card with select options.
 */
export function createSelectQuestionTemplate(
  params: CreateSelectQuestionTemplateParams
): string {
  const { memo, prompt, options, directive } = params;
  const optionsXml = options
    .map(opt => `<option id="${escapeAttr(opt.id)}">${escapeText(opt.label)}</option>`)
    .join("\n");
  const directiveXml = directive ? `\n<directive>${escapeText(directive)}</directive>` : "";

  return `<question status="pending">
<memo>${escapeText(memo)}</memo>
<prompt>${escapeText(prompt)}</prompt>
<input type="select">
${optionsXml}
</input>${directiveXml}
</question>
`;
}

interface CreateQuestionTemplateParams {
  memo: string;
  prompt: string;
  directive?: string;
}

/**
 * Template for creating a new question card with text input.
 */
export function createTextQuestionTemplate(params: CreateQuestionTemplateParams): string {
  const { memo, prompt, directive } = params;
  const directiveXml = directive ? `\n<directive>${escapeText(directive)}</directive>` : "";
  return `<question status="pending">
<memo>${escapeText(memo)}</memo>
<prompt>${escapeText(prompt)}</prompt>
<input type="text" />${directiveXml}
</question>
`;
}

/**
 * Template for creating a confirm (yes/no) question.
 */
export function createConfirmQuestionTemplate(params: CreateQuestionTemplateParams): string {
  const { memo, prompt, directive } = params;
  const directiveXml = directive ? `\n<directive>${escapeText(directive)}</directive>` : "";
  return `<question status="pending">
<memo>${escapeText(memo)}</memo>
<prompt>${escapeText(prompt)}</prompt>
<input type="confirm" />${directiveXml}
</question>
`;
}
