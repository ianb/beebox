/**
 * Question card schema - pending questions for user input.
 *
 * Questions are created when the system needs human guidance. Answering a
 * question has two products: the immediate effect (`directive:`) and,
 * optionally, durable knowledge the answer teaches (`learning:` — the sink
 * vocabulary mirrors the retrospective's, see `src/core/retro/observations.ts`).
 */

import { cardSchema, renderFrontmatterBlock, type InferCardFields } from "../cards/index.js";
import { z } from "zod";

export const QuestionStatus = z.enum(["pending", "answered", "dismissed", "expired"]);
export type QuestionStatusType = z.infer<typeof QuestionStatus>;

export const QuestionInputType = z.enum(["select", "text", "confirm"]);
export type QuestionInputTypeValue = z.infer<typeof QuestionInputType>;

const QuestionOption = z.object({
  id: z.string(),
  label: z.string(),
});

const QuestionInputField = z
  .object({
    type: QuestionInputType,
    options: z.array(QuestionOption).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.type === "select") {
      if (!input.options || input.options.length < 2) {
        ctx.addIssue({
          code: "custom",
          path: ["options"],
          message: "select questions require at least two options",
        });
      }
    } else if (input.options) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: `${input.type} questions must not carry options`,
      });
    }
  });

const QuestionContextEntry = z.object({
  ref: z.string(),
  text: z.string().optional(),
});

const QuestionAnswer = z.object({
  text: z.string().optional(),
  selected: z.string().optional(),
});

/**
 * Where the answer's durable knowledge lands. Mirrors the retrospective's
 * sink vocabulary (`ObservationSink`) minus `question` itself — a question
 * card can't declare itself as its own destination.
 */
export const QuestionLearningSink = z.enum(["guide", "briefing", "personality"]);
export type QuestionLearningSinkValue = z.infer<typeof QuestionLearningSink>;

export const QuestionLearning = z.object({
  sink: QuestionLearningSink,
  ref: z.string().optional(),
  proposal: z.string(),
});
export type QuestionLearningFields = z.infer<typeof QuestionLearning>;

/**
 * ISO-8601 duration format (e.g. `P30D`, `P7D`, `PT12H`) — the subset used
 * for `expires-after` overrides. Requires at least one designated component;
 * bare `P` or `PT` are rejected.
 */
const ISO_8601_DURATION =
  /^P(?!$)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?!$)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/;

function isIso8601Duration(value: string): boolean {
  return ISO_8601_DURATION.test(value);
}

const IsoDuration = z
  .string()
  .refine(isIso8601Duration, { message: "must be an ISO-8601 duration, e.g. P30D or PT12H" });

export const QuestionSchema = cardSchema("question", {
  description: "Asks the user something (select/text/confirm) and routes the answer back to an agent via its directive",
  category: "authored",
  fields: {
    status: QuestionStatus.default("pending"),
    memo: z.string().optional(),
    prompt: z.string(),
    input: QuestionInputField,
    learning: QuestionLearning.optional(),
    directive: z.string().optional(),
    context: z.array(QuestionContextEntry).optional(),
    "asked-at": z.string().datetime({ offset: true }).optional(),
    "expires-after": IsoDuration.optional(),
    answer: QuestionAnswer.optional(),
    "answered-at": z.string().datetime({ offset: true }).optional(),
    "answered-via": z.enum(["web", "cli", "api"]).optional(),
    "dismissed-at": z.string().datetime({ offset: true }).optional(),
    "expired-at": z.string().datetime({ offset: true }).optional(),
  },
  instructions: `# Question Cards

A question card asks the user something and routes the answer back for processing. An answer has two products, and both are worth capturing when they apply: the immediate effect (\`directive:\` — what to do with this one answer) and durable knowledge (\`learning:\` — the belief the answer confirms or denies, going forward). Today's placement is the small part; the rule the boxholder just taught you is usually the valuable part.

## Frontmatter

- \`status:\` — \`pending\`, \`answered\`, \`dismissed\`, or \`expired\`. Default \`pending\`.
  - \`pending\` — awaiting an answer.
  - \`answered\` — the boxholder responded; terminal only in the sense that a new question is normally asked instead of re-opening one, but the card itself still accepts a fresh answer.
  - \`dismissed\` — the boxholder declined to answer. Still answerable later.
  - \`expired\` — aged out of the active view by the aging sweep, without an answer. Still answerable later — expiry demotes visibility, it does not close the question.
  Before asking something new, check \`box/questions/\` including answered/dismissed/expired cards: an existing answer is a \`user-stated\` fact, and a dismissal or expiry is a signal the boxholder didn't care to answer that.
- \`memo:\` — context explaining WHY you're asking, so the user can answer without looking anything up.
- \`prompt:\` — the actual question.
- \`input:\` — \`{type: select|text|confirm, options?: [{id, label}]}\`. \`select\` requires at least two options. \`confirm\` and \`text\` must NOT carry options.
- \`learning:\` — optional. Set it when the answer is also evidence for a durable belief, not just a one-shot decision: \`{sink: guide|briefing|personality, ref?: <card path>, proposal: <the belief being tested, quotable>}\`. State what you are trying to learn and where it should be recorded — when the destination is known, declaring it here is cheap and turns recording the answer into a mechanical follow-up step. For sink \`briefing\`, \`ref\` MUST be the ROOT briefing card: directory briefings are not compiled into any agent's context (only the root briefing becomes the box's \`CLAUDE.md\`), so a belief recorded against a directory briefing would never be seen.
- \`directive:\` — what to do with the answer. The system creates a follow-up job using this text as instructions. Be specific. Without a directive, the answer's immediate effect goes nowhere (the follow-up job still records \`learning:\` if you set it).
- \`context:\` — array of \`{ref, text?}\` linking to related cards.
- \`asked-at:\` — ISO 8601 timestamp, set automatically by the template that creates the card. The aging sweep computes a question's age from this field, never from notification/latch state.
- \`expires-after:\` — optional ISO-8601 duration (e.g. \`P30D\`, \`PT12H\`) overriding the default expiry window for this question. Use it for a time-sensitive ask that should expire sooner, or an evergreen one that should last longer.

After the user answers, the system fills in:
- \`answer:\` — \`{text, selected?}\` where \`selected\` is the option id for select questions.
- \`answered-at:\` — ISO 8601 timestamp.
- \`answered-via:\` — \`web\`, \`cli\`, or \`api\`.

Dismissing sets \`dismissed-at:\`; the aging sweep expiring a question sets \`expired-at:\`.

For select questions, make options mutually exclusive. For confirm questions, make the prompt unambiguous about what "yes" means.`,
});

export type QuestionFields = InferCardFields<typeof QuestionSchema>;

interface CreateSelectQuestionTemplateParams {
  memo: string;
  prompt: string;
  options: Array<{ id: string; label: string }>;
  askedAt: string;
  directive?: string;
  learning?: QuestionLearningFields;
  expiresAfter?: string;
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
  if (params.learning !== undefined) fields["learning"] = params.learning;
  if (params.directive !== undefined) fields["directive"] = params.directive;
  fields["asked-at"] = params.askedAt;
  if (params.expiresAfter !== undefined) fields["expires-after"] = params.expiresAfter;
  return renderFrontmatterBlock(fields);
}

interface CreateQuestionTemplateParams {
  memo: string;
  prompt: string;
  askedAt: string;
  directive?: string;
  learning?: QuestionLearningFields;
  expiresAfter?: string;
}

export function createTextQuestionTemplate(params: CreateQuestionTemplateParams): string {
  const fields: Record<string, unknown> = {
    status: "pending",
    memo: params.memo,
    prompt: params.prompt,
    input: { type: "text" },
  };
  if (params.learning !== undefined) fields["learning"] = params.learning;
  if (params.directive !== undefined) fields["directive"] = params.directive;
  fields["asked-at"] = params.askedAt;
  if (params.expiresAfter !== undefined) fields["expires-after"] = params.expiresAfter;
  return renderFrontmatterBlock(fields);
}

export function createConfirmQuestionTemplate(params: CreateQuestionTemplateParams): string {
  const fields: Record<string, unknown> = {
    status: "pending",
    memo: params.memo,
    prompt: params.prompt,
    input: { type: "confirm" },
  };
  if (params.learning !== undefined) fields["learning"] = params.learning;
  if (params.directive !== undefined) fields["directive"] = params.directive;
  fields["asked-at"] = params.askedAt;
  if (params.expiresAfter !== undefined) fields["expires-after"] = params.expiresAfter;
  return renderFrontmatterBlock(fields);
}
