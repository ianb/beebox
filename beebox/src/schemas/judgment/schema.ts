/**
 * Judgment card schema: an authored Jev prompt. Named questions of the three
 * Decisions API types (noul, choice, score) in frontmatter, the instructions
 * in the body, and no state: `bbx judge` reads the state from stdin at run
 * time. `<name>.judgment.card`, anywhere in the box, by convention
 * `_config/judgments/`. See docs/implemented-plans/notifications.md (Track D).
 *
 * Each question's `criteria` takes the wire shape for its type; one
 * refinement per type names the shape it needs.
 */

import { z } from "zod";
import { body, cardRef, cardSchema, type InferCardFields } from "../../exports/cards.js";
import { invariant } from "../../lib/invariant.js";
import type { JudgeQuestion } from "../../services/jev-judge.js";
import { JUDGMENT_INSTRUCTIONS } from "./instructions.js";

const Description = z.string().regex(/\S/);

const NoulCriteria = z.strictObject({ true: Description, false: Description });
const ChoiceCriteria = z
  .record(z.string().regex(/\S/), Description)
  .refine((options) => Object.keys(options).length >= 2);
const ScoreCriteria = z.array(Description).min(2);

const CRITERIA = {
  noul: {
    schema: NoulCriteria,
    message: "a noul question's criteria is {true: <what yes means>, false: <what no means>}",
  },
  choice: {
    schema: ChoiceCriteria,
    message: "a choice question's criteria maps each option to its description, with at least two options",
  },
  score: {
    schema: ScoreCriteria,
    message: "a score question's criteria is a list of level descriptions, lowest first, with at least two levels",
  },
} as const;

const Instructions = z.union([z.string(), z.array(z.string())]);

const QuestionField = z
  .strictObject({
    type: z.enum(["noul", "choice", "score"]),
    instructions: Instructions.optional(),
    criteria: z.unknown(),
  })
  .superRefine((question, ctx) => {
    const rule = CRITERIA[question.type];
    if (!rule.schema.safeParse(question.criteria).success) {
      ctx.addIssue({ code: "custom", path: ["criteria"], message: rule.message });
    }
  });

export const JudgmentSchema = cardSchema("judgment", {
  description: "An authored Jev prompt: named noul, choice, and score questions that `bbx judge` asks about a state from stdin",
  brief: "Questions bbx judge asks",
  category: "authored",
  searchable: false,
  fields: {
    questions: z
      .record(z.string().regex(/^[A-Za-z][\w-]*$/, { message: "a question name is a letter then letters, digits, - or _" }), QuestionField)
      .refine((questions) => Object.keys(questions).length > 0, { message: "a judgment needs at least one question" }),
    situation: cardRef().optional(),
    model: z.string().regex(/\S/).optional(),
    body: body(z.string().regex(/\S/, { message: "the body is the instructions Jev receives: say what the state is" })),
  },
  instructions: JUDGMENT_INSTRUCTIONS,
});

export type JudgmentFields = InferCardFields<typeof JudgmentSchema>;

/**
 * The card's questions in the Jev wire shape. The card validated on load, so a
 * criteria that does not parse here is a broken invariant.
 */
export function judgmentQuestions(fields: JudgmentFields): Record<string, JudgeQuestion> {
  const out: Record<string, JudgeQuestion> = {};
  for (const [name, question] of Object.entries(fields.questions)) {
    const instructions = question.instructions ?? [];
    switch (question.type) {
      case "noul": {
        const criteria = NoulCriteria.safeParse(question.criteria);
        invariant(criteria.success, `judgment question "${name}" passed validation with bad criteria`);
        out[name] = { type: "noul", instructions, criteria: criteria.data };
        break;
      }
      case "choice": {
        const criteria = ChoiceCriteria.safeParse(question.criteria);
        invariant(criteria.success, `judgment question "${name}" passed validation with bad criteria`);
        out[name] = { type: "choice", instructions, criteria: criteria.data };
        break;
      }
      case "score": {
        const criteria = ScoreCriteria.safeParse(question.criteria);
        invariant(criteria.success, `judgment question "${name}" passed validation with bad criteria`);
        out[name] = { type: "score", instructions, criteria: criteria.data };
        break;
      }
    }
  }
  return out;
}
