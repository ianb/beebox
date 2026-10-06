/**
 * Question card schema - pending questions for user input.
 *
 * Questions are created when the system needs human guidance. Answering a
 * question has two products: the immediate effect (`directive:`) and,
 * optionally, durable knowledge the answer teaches (`learning:` — the sink
 * vocabulary mirrors the retrospective's, see `src/core/retro/observations.ts`).
 */

import { cardSchema, renderFrontmatterBlock, type InferCardFields } from "../exports/cards.js";
import { IsoDuration } from "../shared/iso-duration.js";
import { z } from "zod";
import { QuestionLearning, type QuestionLearningFields } from "../question-fields.js";

export { QuestionLearning, type QuestionLearningFields, type QuestionLearningSinkValue } from "../question-fields.js";

const QuestionInputType = z.enum(["select", "text", "confirm"]);
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
        return;
      }
      // Ids must be unique, and labels must be unique case-insensitively:
      // answer resolution matches a typed answer against option labels with
      // `toLowerCase()` (see resolveSelectAnswer in core/commands/answer.ts), so
      // two options differing only in case would make the match ambiguous.
      const seenIds = new Set<string>();
      const seenLabels = new Set<string>();
      for (const [i, option] of input.options.entries()) {
        if (seenIds.has(option.id)) {
          ctx.addIssue({
            code: "custom",
            path: ["options", i, "id"],
            message: `duplicate option id "${option.id}"`,
          });
        }
        seenIds.add(option.id);
        const label = option.label.toLowerCase();
        if (seenLabels.has(label)) {
          ctx.addIssue({
            code: "custom",
            path: ["options", i, "label"],
            message: `duplicate option label "${option.label}" (labels must be unique case-insensitively)`,
          });
        }
        seenLabels.add(label);
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

// The duration grammar and parser live in `shared/iso-duration.ts` (the
// browser needs them too); re-exported here for the existing importers.
export { IsoDuration, parseIso8601DurationMs } from "../shared/iso-duration.js";

/** Where a question stands, derived from its lifecycle fields by {@link questionState}. */
export type QuestionState = "pending" | "answered" | "dismissed" | "expired";

/**
 * A question's state, read from which lifecycle timestamp it carries:
 * `answered-at` means answered, else `dismissed-at` dismissed, else
 * `expired-at` expired, else pending. The schema allows at most one of the
 * three. Takes loose frontmatter too, so a count can skip the full load.
 */
export function questionState(fields: Readonly<Record<string, unknown>>): QuestionState {
  if (fields["answered-at"] !== undefined) return "answered";
  if (fields["dismissed-at"] !== undefined) return "dismissed";
  if (fields["expired-at"] !== undefined) return "expired";
  return "pending";
}

const STATE_TIMESTAMPS = ["answered-at", "dismissed-at", "expired-at"] as const;
/** Fields that belong to an answer: present only with `answered-at`. */
const ANSWER_FIELDS = ["answer", "answered-via"] as const;

/**
 * Parse-time coherence of the lifecycle fields: at most one of `answered-at`,
 * `dismissed-at` and `expired-at`; `answered-at` requires `answer`; `answer`
 * and `answered-via` appear only with `answered-at`. Answering a dismissed or
 * expired question clears their timestamp to keep this holding (see
 * `core/commands/answer.ts`).
 */
function refineQuestionLifecycle(fields: Record<string, unknown>, ctx: z.core.$RefinementCtx): void {
  const present = STATE_TIMESTAMPS.filter((key) => fields[key] !== undefined);
  for (const key of present.slice(1)) {
    ctx.addIssue({ code: "custom", path: [key], message: `"${key}" must not appear with "${present[0] ?? ""}"` });
  }
  const answered = fields["answered-at"] !== undefined;
  if (answered && fields["answer"] === undefined) {
    ctx.addIssue({ code: "custom", path: ["answer"], message: "\"answered-at\" requires \"answer\"" });
  }
  if (!answered) {
    for (const key of ANSWER_FIELDS) {
      if (fields[key] !== undefined) {
        ctx.addIssue({ code: "custom", path: [key], message: `"${key}" requires "answered-at"` });
      }
    }
  }
}

export const QuestionSchema = cardSchema("question", {
  brief: "Asks the user something",
  superRefine: refineQuestionLifecycle,
  description: "Asks the user something (select/text/confirm) and routes the answer back to an agent via its directive",
  category: "authored",
  fields: {
    memo: z.string().optional(),
    prompt: z.string(),
    input: QuestionInputField,
    learning: QuestionLearning.optional(),
    directive: z.string().optional(),
    context: z.array(QuestionContextEntry).optional(),
    "asked-at": z.string().datetime({ offset: true }).optional(),
    "expires-after": IsoDuration.optional(),
    urgency: z.enum(["time-bound"]).optional(),
    answer: QuestionAnswer.optional(),
    "answered-at": z.string().datetime({ offset: true }).optional(),
    "answered-via": z.enum(["web", "cli"]).optional(),
    "dismissed-at": z.string().datetime({ offset: true }).optional(),
    "expired-at": z.string().datetime({ offset: true }).optional(),
  },
  instructions: `# Question Cards

A question card asks the user something and routes the answer back for processing. An answer has two products, and both are worth capturing when they apply: the immediate effect (\`directive:\` — what to do with this one answer) and durable knowledge (\`learning:\` — the belief the answer confirms or denies, going forward). Today's placement is the small part; the rule the boxholder just taught you is usually the valuable part.

## Frontmatter

- A question's state is read from which lifecycle timestamp it carries:
  - pending — none of \`answered-at\`, \`dismissed-at\`, \`expired-at\`: awaiting an answer.
  - answered — has \`answered-at\` (and \`answer\`); terminal — an answered question does not accept a fresh answer.
  - dismissed — has \`dismissed-at\`: the boxholder declined to answer. Still answerable later.
  - expired — has \`expired-at\`: aged out of the active view by the aging sweep, without an answer. Still answerable later — expiry demotes visibility, it does not close the question.
  A card carries at most one of the three timestamps; answering a dismissed or expired question removes its timestamp. Before asking something new, check \`_bookkeeping/questions/\` including answered/dismissed/expired cards: an existing answer is a \`user-stated\` fact, and a dismissal or expiry is a signal the boxholder didn't care to answer that.
- \`memo:\` — context explaining WHY you're asking, so the user can answer without looking anything up.
- \`prompt:\` — the actual question.
- \`input:\` — \`{type: select|text|confirm, options?: [{id, label}]}\`. \`select\` requires at least two options. \`confirm\` and \`text\` must NOT carry options.
- \`learning:\` — optional. Set it when the answer is also evidence for a durable belief, not just a one-shot decision: \`{sink: guide|briefing|personality, ref?: <card path>, proposal: <the belief being tested, quotable>}\`. State what you are trying to learn and where it should be recorded — when the destination is known, declaring it here is cheap and turns recording the answer into a mechanical follow-up step. For sink \`briefing\`, \`ref\` MUST be the ROOT briefing card: directory briefings are not compiled into any agent's context (only the root briefing becomes the box's \`CLAUDE.md\`), so a belief recorded against a directory briefing would never be seen. When the boxholder answers, the follow-up job records the confirmed (or denied) belief in that sink as a \`basis: user-stated\` fact — the strongest evidence tier, since the boxholder said it directly.
- \`directive:\` — what to do with the answer. The system creates a follow-up job using this text as instructions. Be specific. Without a directive, the answer's immediate effect goes nowhere (the follow-up job still records \`learning:\` if you set it).
- \`context:\` — array of \`{ref, text?}\` linking to related cards.
- \`asked-at:\` — ISO 8601 timestamp, set automatically by the template that creates the card. The aging sweep computes a question's age from this field, never from notification/latch state.
- \`expires-after:\` — optional ISO-8601 duration (e.g. \`P30D\`, \`PT12H\`) overriding the default expiry window for this question. Use it for a time-sensitive ask that should expire sooner, or an evergreen one that should last longer.
- \`urgency:\` — optional; the one value is \`time-bound\`. Set it when the question blocks something with a date (a form due Friday, a booking that closes). A new question badges the phone; a \`time-bound\` one also sends a notification.

After the user answers, the system fills in:
- \`answer:\` — \`{text, selected?}\` where \`selected\` is the option id for select questions.
- \`answered-at:\` — ISO 8601 timestamp.
- \`answered-via:\` — \`web\` or \`cli\`.

Dismissing sets \`dismissed-at:\`; the aging sweep expiring a question sets \`expired-at:\`.

For select questions, make options mutually exclusive. For confirm questions, make the prompt unambiguous about what "yes" means.`,
});

export type QuestionFields = InferCardFields<typeof QuestionSchema>;

type QuestionContextEntryFields = z.infer<typeof QuestionContextEntry>;

interface CreateSelectQuestionTemplateParams {
  memo: string;
  prompt: string;
  options: Array<{ id: string; label: string }>;
  askedAt: string;
  directive?: string;
  learning?: QuestionLearningFields;
  expiresAfter?: string;
  context?: QuestionContextEntryFields[];
}

export function createSelectQuestionTemplate(
  params: CreateSelectQuestionTemplateParams
): string {
  const fields: Record<string, unknown> = {
    memo: params.memo,
    prompt: params.prompt,
    input: { type: "select", options: params.options },
  };
  if (params.learning !== undefined) fields["learning"] = params.learning;
  if (params.directive !== undefined) fields["directive"] = params.directive;
  if (params.context !== undefined) fields["context"] = params.context;
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
  context?: QuestionContextEntryFields[];
}

export function createTextQuestionTemplate(params: CreateQuestionTemplateParams): string {
  const fields: Record<string, unknown> = {
    memo: params.memo,
    prompt: params.prompt,
    input: { type: "text" },
  };
  if (params.learning !== undefined) fields["learning"] = params.learning;
  if (params.directive !== undefined) fields["directive"] = params.directive;
  if (params.context !== undefined) fields["context"] = params.context;
  fields["asked-at"] = params.askedAt;
  if (params.expiresAfter !== undefined) fields["expires-after"] = params.expiresAfter;
  return renderFrontmatterBlock(fields);
}

export function createConfirmQuestionTemplate(params: CreateQuestionTemplateParams): string {
  const fields: Record<string, unknown> = {
    memo: params.memo,
    prompt: params.prompt,
    input: { type: "confirm" },
  };
  if (params.learning !== undefined) fields["learning"] = params.learning;
  if (params.directive !== undefined) fields["directive"] = params.directive;
  if (params.context !== undefined) fields["context"] = params.context;
  fields["asked-at"] = params.askedAt;
  if (params.expiresAfter !== undefined) fields["expires-after"] = params.expiresAfter;
  return renderFrontmatterBlock(fields);
}
