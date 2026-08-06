/** Validated Gmail connector configuration and legacy normalization. */

import { z } from "zod";
import { parseDuration } from "../schemas/scheduled-script-duration.js";
import { assertNever } from "../lib/invariant.js";
import { errorMessage } from "../lib/error-guards.js";
import type { AutomaticTrackingBudget } from "./gmail-tracking.js";

const DEFAULT_TRACKING_THREADS = 25;
const DEFAULT_TRACKING_WINDOW = "7d";

const BudgetInputSchema = z.object({
  threads: z.number().int().positive().optional(),
  window: z.string().optional(),
}).strict();

const TrackActionInputSchema = z.object({
  type: z.literal("track"),
  budget: BudgetInputSchema.optional(),
}).strict();

const ProcedureActionInputSchema = z.object({
  type: z.literal("procedure"),
  ref: z.string().regex(
    /^config\/procedures\/(?!.*\.\.)[^/]+\.procedure\.card$/,
    "procedure ref under config/procedures/ ending in .procedure.card",
  ),
}).strict();

const RuleInputSchema = z.object({
  name: z.string().regex(/^[\da-z][\da-z-]*$/, "lowercase kebab-case rule name"),
  query: z.string().min(1),
  action: z.discriminatedUnion("type", [TrackActionInputSchema, ProcedureActionInputSchema]),
}).strict();

const GmailConfigInputSchema = z.object({
  rules: z.array(RuleInputSchema).optional(),
  query: z.string().min(1).optional(),
  labels: z.array(z.string().min(1)).min(1).optional(),
  gc: z.boolean().optional(),
  gcIntervalHours: z.number().nonnegative().optional(),
}).strict();

export interface GmailTrackAction {
  type: "track";
  budget: AutomaticTrackingBudget;
}

export interface GmailProcedureAction {
  type: "procedure";
  ref: string;
}

export type GmailRuleAction = GmailTrackAction | GmailProcedureAction;

export interface GmailRule {
  name: string;
  query: string;
  action: GmailRuleAction;
}

export interface GmailConnectorConfig {
  rules: GmailRule[];
  legacy: boolean;
  gc: boolean | undefined;
  gcIntervalHours: number | undefined;
}

export class GmailConnectorConfigError extends Error {
  constructor(detail: string) {
    super(`Invalid config/connectors/gmail.json: ${detail}`);
    this.name = "GmailConnectorConfigError";
  }
}

export class DuplicateGmailRuleNameError extends GmailConnectorConfigError {
  readonly ruleName: string;

  constructor(ruleName: string) {
    super(`duplicate Gmail rule name: ${ruleName}`);
    this.name = "DuplicateGmailRuleNameError";
    this.ruleName = ruleName;
  }
}

export class MixedGmailRuleConfigError extends GmailConnectorConfigError {
  constructor() {
    super("rules cannot be combined with legacy query or labels");
    this.name = "MixedGmailRuleConfigError";
  }
}

function normalizeBudget(input?: z.infer<typeof BudgetInputSchema>): AutomaticTrackingBudget {
  const threads = input?.threads ?? DEFAULT_TRACKING_THREADS;
  const window = input?.window ?? DEFAULT_TRACKING_WINDOW;
  try {
    return { threads, windowMs: parseDuration(window) };
  } catch (error) {
    throw new GmailConnectorConfigError(errorMessage(error));
  }
}

function normalizeRule(input: z.infer<typeof RuleInputSchema>): GmailRule {
  switch (input.action.type) {
    case "track":
      return {
        name: input.name,
        query: input.query,
        action: { type: "track", budget: normalizeBudget(input.action.budget) },
      };
    case "procedure":
      return {
        name: input.name,
        query: input.query,
        action: { type: "procedure", ref: input.action.ref },
      };
    default:
      return assertNever(input.action);
  }
}

function legacyQuery(input: z.infer<typeof GmailConfigInputSchema>): string | null {
  if (input.query !== undefined) return input.query;
  if (input.labels !== undefined) {
    return input.labels.map((label) => `label:${label}`).join(" OR ");
  }
  return null;
}

/** Validate and normalize the hand-edited Gmail connector config. */
export function parseGmailConnectorConfig(raw: unknown): GmailConnectorConfig {
  const parsed = GmailConfigInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new GmailConnectorConfigError(parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  const input = parsed.data;
  const legacy = legacyQuery(input);
  if (input.rules !== undefined && legacy !== null) {
    throw new MixedGmailRuleConfigError();
  }
  const rules = input.rules?.map(normalizeRule) ?? (
    legacy === null
      ? []
      : [{
          name: "legacy-import",
          query: legacy,
          action: { type: "track", budget: normalizeBudget() },
        }]
  );
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.name)) throw new DuplicateGmailRuleNameError(rule.name);
    seen.add(rule.name);
  }
  return {
    rules,
    legacy: legacy !== null,
    gc: input.gc,
    gcIntervalHours: input.gcIntervalHours,
  };
}
