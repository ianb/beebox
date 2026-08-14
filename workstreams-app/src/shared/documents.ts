import { z } from "zod";

export const issuePrioritySchema = z.enum([
  "important",
  "normal",
  "backlog",
  "uncategorized",
]);
export const issueNextActionSchema = z.enum([
  "reconfirm",
  "duplicate",
  "invalid",
  "fixed",
]);
export const issueVisibilitySchema = z.enum(["public", "private"]);

const issueFrontmatterSchema = z.object({
  title: z.string(),
  workstream: z.string(),
  needs: z.array(z.string()),
  labels: z.array(z.string()),
  priority: issuePrioritySchema,
  area: z.string().optional(),
  filedBy: z.string().optional(),
  discoveredBy: z.string().optional(),
  discoveredIn: z.string().optional(),
  resolution: z.string().optional(),
  design: z.string().optional(),
  nextAction: issueNextActionSchema.optional(),
});

const issueOverlaySchema = z.object({
  worktree: z.string(),
  status: z.enum(["added", "modified", "deleted", "renamed"]),
  committed: z.boolean(),
});

export const issueSchema = z.object({
  relPath: z.string(),
  category: z.string(),
  closed: z.boolean(),
  slug: z.string(),
  visibility: issueVisibilitySchema,
  research: z.enum(["none", "awaiting", "researched"]),
  body: z.string().optional(),
  frontmatter: issueFrontmatterSchema,
  overlay: z.array(issueOverlaySchema).optional(),
});

export const planSchema = z.object({
  title: z.string(),
  status: z.string(),
  workstream: z.string(),
  relPath: z.string(),
});

export const quotaWindowSchema = z.object({
  label: z.string(),
  usedPercent: z.number(),
  resetsAt: z.iso.datetime(),
  durationMinutes: z.number().nullable(),
});

export const quotaSchema = z.object({
  provider: z.enum(["claude", "codex"]),
  status: z.enum(["available", "unavailable"]),
  message: z.string().optional(),
  stale: z.boolean().optional(),
  fetchedAt: z.iso.datetime(),
  windows: z.array(quotaWindowSchema),
  credits: z.object({
    unlimited: z.boolean(),
    balance: z.string().nullable(),
  }).optional(),
});

export const testingQueueSchema = z.object({
  landed: z.array(issueSchema),
  pending: z.array(z.object({ worktree: z.string(), issue: issueSchema })),
});

export const issueChangeSchema = z.object({
  relPath: z.string(),
  visibility: issueVisibilitySchema,
  priority: issuePrioritySchema,
  nextAction: issueNextActionSchema.nullable(),
  originalPriority: issuePrioritySchema,
  originalNextAction: issueNextActionSchema.nullable(),
});

export type Issue = z.infer<typeof issueSchema>;
export type Plan = z.infer<typeof planSchema>;
export type Quota = z.infer<typeof quotaSchema>;
export type TestingQueue = z.infer<typeof testingQueueSchema>;
export type IssueChange = z.infer<typeof issueChangeSchema>;
