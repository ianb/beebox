import { z } from "zod";
import { issueSchema, planSchema, quotaSchema, testingQueueSchema } from "./documents.js";

const removedStateSchema = z.object({
  at: z.iso.datetime(),
  finalSha: z.string().min(1).optional(),
  merged: z.boolean(),
});

const archivedStateSchema = z.object({
  at: z.iso.datetime(),
});

const gitStateSchema = z.object({
  ahead: z.number().int().nonnegative().nullable(),
  dirty: z.number().int().nonnegative().nullable(),
  merged: z.boolean().nullable(),
  tip: z.string().min(1).nullable(),
});

const runtimeStateSchema = z.object({
  state: z.string().min(1),
});

const agentStateSchema = z.object({
  state: z.string().min(1),
  reason: z.string(),
});

const sessionStateSchema = z.object({
  agent: z.enum(["claude", "codex"]).nullable(),
  hasSession: z.boolean(),
  tty: z.string().min(1).nullable(),
  emoji: z.string().min(1).nullable(),
  baseSha: z.string().min(1).nullable(),
  removed: removedStateSchema.nullable(),
  archived: archivedStateSchema.nullable(),
});

const boxStateSchema = z.object({
  testSetup: z.boolean(),
  keepUnmerged: z.boolean(),
  pristine: z.boolean().nullable(),
});

export const workstreamsCliRowSchema = z.object({
  name: z.string().min(1),
  branch: z.string().min(1),
  path: z.string().min(1).nullable(),
  box: z.string().min(1).nullable(),
  url: z.url().nullable(),
  git: gitStateSchema.nullable(),
  runtime: runtimeStateSchema,
  agent: agentStateSchema,
  session: sessionStateSchema,
  boxState: boxStateSchema,
});

export const workstreamsCliListSchema = z.array(workstreamsCliRowSchema);

export const workstreamSummarySchema = workstreamsCliRowSchema.omit({
  path: true,
  box: true,
});

export const workstreamListResultSchema = z.object({
  items: z.array(workstreamSummarySchema),
});

export const workstreamDetailSchema = z.object({
  workstream: workstreamSummarySchema,
  issues: z.array(issueSchema),
});

export const dashboardSchema = z.object({
  workstreams: z.array(workstreamSummarySchema),
  issues: z.array(issueSchema),
  plans: z.array(planSchema),
  quotas: z.array(quotaSchema),
  testing: testingQueueSchema,
});

export type WorkstreamSummary = z.infer<typeof workstreamSummarySchema>;
export type WorkstreamListResult = z.infer<typeof workstreamListResultSchema>;
