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

export const IsoDuration = z
  .string()
  .refine(isIso8601Duration, { message: "must be an ISO-8601 duration, e.g. P30D or PT12H" });

/** Same components as {@link ISO_8601_DURATION}, captured for arithmetic. */
const ISO_8601_DURATION_CAPTURE =
  /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

export class InvalidIso8601DurationError extends Error {
  constructor(value: string) {
    super(`Invalid ISO-8601 duration: "${value}"`);
    this.name = "InvalidIso8601DurationError";
  }
}

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MS_PER_WEEK = 7 * MS_PER_DAY;
// Y/M in a duration are calendar-relative in the ISO-8601 spec, but the
// aging sweep has no reference date to resolve them against. `expires-after`
// is meant for day-to-week-scale overrides (see the schema instructions'
// examples: P30D, PT12H); a card using Y/M gets a fixed 30-day-month /
// 365-day-year approximation, which is consistent even if not calendar-exact.
const MS_PER_MONTH = 30 * MS_PER_DAY;
const MS_PER_YEAR = 365 * MS_PER_DAY;

/**
 * Convert an ISO-8601 duration string (e.g. `P30D`, `PT12H`) to milliseconds.
 * Used by the aging sweep (`core/question-aging.ts`) to turn a question's
 * `expires-after` override into a concrete expiry/nudge window.
 */
export function parseIso8601DurationMs(value: string): number {
  const match = ISO_8601_DURATION_CAPTURE.exec(value);
  if (!match) {
    throw new InvalidIso8601DurationError(value);
  }
  const [, years, months, weeks, days, hours, minutes, seconds] = match;
  return (
    Number(years ?? 0) * MS_PER_YEAR +
    Number(months ?? 0) * MS_PER_MONTH +
    Number(weeks ?? 0) * MS_PER_WEEK +
    Number(days ?? 0) * MS_PER_DAY +
    Number(hours ?? 0) * MS_PER_HOUR +
    Number(minutes ?? 0) * MS_PER_MINUTE +
    Number(seconds ?? 0) * MS_PER_SECOND
  );
}

/**
 * Every lifecycle timestamp/answer field, keyed to the ONE status that owns it.
 * A question's status is single: exactly the fields for its status may be
 * present, and the others must be absent. `answered-via` is grouped with
 * `answered` but is optional there (a legacy answered card may lack it), so it
 * is only forbidden on the other statuses, never required.
 */
const REQUIRED_LIFECYCLE_FIELDS: Record<QuestionStatusType, readonly string[]> = {
  pending: [],
  answered: ["answer", "answered-at"],
  dismissed: ["dismissed-at"],
  expired: ["expired-at"],
};
const OWNED_LIFECYCLE_FIELDS: Record<QuestionStatusType, readonly string[]> = {
  pending: [],
  answered: ["answer", "answered-at", "answered-via"],
  dismissed: ["dismissed-at"],
  expired: ["expired-at"],
};
const ALL_LIFECYCLE_FIELDS = ["answer", "answered-at", "answered-via", "dismissed-at", "expired-at"] as const;

/**
 * Parse-time coherence check tying a question's `status` to its lifecycle
 * fields, so a card whose bookkeeping contradicts its status can't load (the
 * transition in `core/commands/question-transition.ts` clears stale fields when
 * re-answering an expired/dismissed question precisely to keep this holding).
 */
function refineQuestionLifecycle(fields: Record<string, unknown>, ctx: z.core.$RefinementCtx): void {
  const status = fields["status"];
  // status is validated by the enum field; if it isn't a known status that
  // failure is already reported, so this refinement has nothing coherent to say.
  if (status !== "pending" && status !== "answered" && status !== "dismissed" && status !== "expired") {
    return;
  }
  const owned = new Set(OWNED_LIFECYCLE_FIELDS[status]);
  for (const key of REQUIRED_LIFECYCLE_FIELDS[status]) {
    if (fields[key] === undefined) {
      ctx.addIssue({ code: "custom", path: [key], message: `status "${status}" requires "${key}"` });
    }
  }
  for (const key of ALL_LIFECYCLE_FIELDS) {
    if (!owned.has(key) && fields[key] !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: `status "${status}" must not carry "${key}"`,
      });
    }
  }
}

export const QuestionSchema = cardSchema("question", {
  superRefine: refineQuestionLifecycle,
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
