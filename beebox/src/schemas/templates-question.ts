/**
 * Question template registrations, split out of `templates-builtins.ts` to keep
 * that catalogue under its size budget. Importing this module for its side
 * effects registers the three question templates. The templates expose the full
 * answer contract (`directive`, `learning`, `expires-after`) alongside the
 * prompt, passing each straight through to the builders in `question.ts`.
 */

import { z } from "zod";
import {
  createSelectQuestionTemplate,
  createTextQuestionTemplate,
  createConfirmQuestionTemplate,
  QuestionLearning,
  IsoDuration,
  type QuestionLearningFields,
} from "./question.js";
import { getBoxTimeISO } from "../lib/time.js";
import { registerTemplate } from "./templates-registry.js";

// The optional answer-contract fields every question template accepts, passed
// straight through to the builders. Kept as one fragment so the three question
// templates stay in lockstep. `learning`/`expires-after` reuse the schema's own
// validators so template args are validated exactly as the card fields are.
const questionContractArgs = {
  directive: z
    .string()
    .optional()
    .describe("What to do with the answer — creates a follow-up job using this text as instructions"),
  learning: QuestionLearning.optional().describe(
    "Durable belief the answer teaches: {sink: guide|briefing|personality, ref?, proposal}"
  ),
  "expires-after": IsoDuration.optional().describe(
    "ISO-8601 duration overriding the default expiry window (e.g. P30D, PT12H)"
  ),
};

/** Map the parsed contract args to the builders' optional params (omitting absent ones). */
function questionContractParams(args: {
  directive?: string | undefined;
  learning?: QuestionLearningFields | undefined;
  "expires-after"?: string | undefined;
}): { directive?: string; learning?: QuestionLearningFields; expiresAfter?: string } {
  const params: { directive?: string; learning?: QuestionLearningFields; expiresAfter?: string } = {};
  if (args.directive !== undefined) params.directive = args.directive;
  if (args.learning !== undefined) params.learning = args.learning;
  if (args["expires-after"] !== undefined) params.expiresAfter = args["expires-after"];
  return params;
}

registerTemplate({
  name: "question",
  description: "A multiple-choice question card",
  cardTypes: ["question"],
  defaultForTypes: ["question"],
  argsSchema: z.object({
    memo: z.string().describe("Context/background for the question"),
    prompt: z.string().describe("The question to ask"),
    options: z
      .array(z.string())
      .min(2)
      .describe("Answer options (at least 2)"),
    ...questionContractArgs,
  }),
  generate: (args) =>
    createSelectQuestionTemplate({
      memo: args.memo,
      prompt: args.prompt,
      options: args.options.map((opt, i) => ({
        id: String.fromCodePoint(97 + i),
        label: opt,
      })),
      askedAt: getBoxTimeISO(),
      ...questionContractParams(args),
    }),
});

registerTemplate({
  name: "question-text",
  description: "A free-text question card",
  cardTypes: ["question"],
  argsSchema: z.object({
    memo: z.string().describe("Context/background for the question"),
    prompt: z.string().describe("The question to ask"),
    ...questionContractArgs,
  }),
  generate: (args) =>
    createTextQuestionTemplate({
      memo: args.memo,
      prompt: args.prompt,
      askedAt: getBoxTimeISO(),
      ...questionContractParams(args),
    }),
});

registerTemplate({
  name: "question-confirm",
  description: "A yes/no confirmation question card",
  cardTypes: ["question"],
  argsSchema: z.object({
    memo: z.string().describe("Context/background for the question"),
    prompt: z.string().describe("The question to ask"),
    ...questionContractArgs,
  }),
  generate: (args) =>
    createConfirmQuestionTemplate({
      memo: args.memo,
      prompt: args.prompt,
      askedAt: getBoxTimeISO(),
      ...questionContractParams(args),
    }),
});
