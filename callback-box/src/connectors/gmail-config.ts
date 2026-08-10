/**
 * Validated Gmail connector configuration.
 *
 * Two equivalent shapes. Named `rules` carry a query and an action each. The
 * `labels`/`query` **shorthand** is one rule spelled inline — easier to hand-
 * edit and the shape the admin form writes — and carries the same `action`.
 *
 * `action` is required whenever the shorthand is used. It used to be implied
 * (as `track`), which meant every filter a boxholder could express through the
 * admin form silently created cards; see docs/plans/gmail-explicit-action.md.
 */

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

/** Exported so the admin API validates an action against the same shape. */
export const gmailActionInputSchema = z.discriminatedUnion("type", [
  TrackActionInputSchema,
  ProcedureActionInputSchema,
]);

const RuleInputSchema = z.object({
  name: z.string().regex(/^[\da-z][\da-z-]*$/, "lowercase kebab-case rule name"),
  query: z.string().min(1),
  action: gmailActionInputSchema,
}).strict();

const GmailConfigInputSchema = z.object({
  rules: z.array(RuleInputSchema).optional(),
  query: z.string().min(1).optional(),
  labels: z.array(z.string().min(1)).min(1).optional(),
  action: gmailActionInputSchema.optional(),
  gc: z.boolean().optional(),
  gcIntervalHours: z.number().nonnegative().optional(),
}).strict();

/** Rule name for the single rule the `labels`/`query` shorthand expands to. */
const SHORTHAND_RULE_NAME = "shorthand";

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
    super("rules cannot be combined with the query or labels shorthand");
    this.name = "MixedGmailRuleConfigError";
  }
}

/**
 * The shorthand says what to match but not what to do about it. Refusing is
 * the point: this used to default to tracking, so a filter saved from the admin
 * form created cards without ever saying it would.
 */
export class MissingGmailActionError extends GmailConnectorConfigError {
  constructor() {
    super(
      'query or labels needs an action — add "action": {"type": "track"} to ' +
      "create a card per matching thread, or " +
      '"action": {"type": "procedure", "ref": "config/procedures/<name>.procedure.card"} ' +
      "to run a procedure instead",
    );
    this.name = "MissingGmailActionError";
  }
}

export class StrayGmailActionError extends GmailConnectorConfigError {
  constructor() {
    super("action applies to the query or labels shorthand; named rules carry their own");
    this.name = "StrayGmailActionError";
  }
}

export class MissingGmailConfigError extends GmailConnectorConfigError {
  constructor() {
    super("file not found — Gmail is enabled for this box but has no configuration");
    this.name = "MissingGmailConfigError";
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

function normalizeAction(input: z.infer<typeof gmailActionInputSchema>): GmailRuleAction {
  switch (input.type) {
    case "track":
      return { type: "track", budget: normalizeBudget(input.budget) };
    case "procedure":
      return { type: "procedure", ref: input.ref };
    default:
      return assertNever(input);
  }
}

function normalizeRule(input: z.infer<typeof RuleInputSchema>): GmailRule {
  return { name: input.name, query: input.query, action: normalizeAction(input.action) };
}

/** The Gmail query the `query`/`labels` shorthand denotes, or null if unused. */
function shorthandQuery(input: z.infer<typeof GmailConfigInputSchema>): string | null {
  if (input.query !== undefined) return input.query;
  if (input.labels !== undefined) {
    return input.labels.map((label) => `label:${label}`).join(" OR ");
  }
  return null;
}

function shorthandRules(input: z.infer<typeof GmailConfigInputSchema>): GmailRule[] {
  const query = shorthandQuery(input);
  if (query === null) {
    if (input.action !== undefined) throw new StrayGmailActionError();
    return [];
  }
  if (input.action === undefined) throw new MissingGmailActionError();
  return [{ name: SHORTHAND_RULE_NAME, query, action: normalizeAction(input.action) }];
}

/** Validate and normalize the hand-edited Gmail connector config. */
export function parseGmailConnectorConfig(raw: unknown): GmailConnectorConfig {
  const parsed = GmailConfigInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new GmailConnectorConfigError(parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  const input = parsed.data;
  if (input.rules !== undefined) {
    if (shorthandQuery(input) !== null) throw new MixedGmailRuleConfigError();
    if (input.action !== undefined) throw new StrayGmailActionError();
  }
  const rules = input.rules?.map(normalizeRule) ?? shorthandRules(input);
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.name)) throw new DuplicateGmailRuleNameError(rule.name);
    seen.add(rule.name);
  }
  return {
    rules,
    gc: input.gc,
    gcIntervalHours: input.gcIntervalHours,
  };
}
