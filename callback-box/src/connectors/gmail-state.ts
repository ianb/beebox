/** Validated machine-local state for Gmail discovery, budgets, and procedures. */

import { z } from "zod";

const PendingSummarySchema = z.object({
  messageId: z.string(),
  threadId: z.string(),
  from: z.string(),
  subject: z.string(),
  date: z.string().datetime({ offset: true }),
  snippet: z.string(),
  labels: z.array(z.string()),
  discoveredAt: z.string().datetime({ offset: true }),
}).strict();

const GmailRuleStateSchema = z.object({
  baselineAt: z.string().datetime({ offset: true }).optional(),
  baselineMatches: z.number().int().nonnegative().optional(),
  automaticTrackingEvents: z.array(z.string().datetime({ offset: true })).optional(),
  pending: z.array(PendingSummarySchema).optional(),
  additionalMatches: z.number().int().nonnegative().optional(),
  unevaluated: z.array(PendingSummarySchema).optional(),
  additionalUnevaluated: z.number().int().nonnegative().optional(),
}).strict();

const GmailHistoryResumeSchema = z.object({
  startHistoryId: z.string(),
  pageToken: z.string().optional(),
  refOffset: z.number().int().nonnegative(),
}).strict();

const GmailTransientStateSchema = z.object({
  historyId: z.string().optional(),
  historyResume: GmailHistoryResumeSchema.optional(),
  rules: z.record(z.string(), GmailRuleStateSchema).optional(),
});

export type GmailPendingSummary = z.infer<typeof PendingSummarySchema>;
export type GmailRuleState = z.infer<typeof GmailRuleStateSchema>;
export type GmailTransientState = z.infer<typeof GmailTransientStateSchema>;

export class GmailTransientStateValidationError extends Error {
  constructor(detail: string) {
    super(`Invalid Gmail transient state: ${detail}`);
    this.name = "GmailTransientStateValidationError";
  }
}

export function parseGmailTransientState(raw: unknown): GmailTransientState {
  const parsed = GmailTransientStateSchema.safeParse(raw);
  if (!parsed.success) {
    throw new GmailTransientStateValidationError(
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  }
  return parsed.data;
}
