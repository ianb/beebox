import { z } from "zod";

export const issuePrioritySchema = z.enum([
  "important",
  "normal",
  "backlog",
  "uncategorized",
]);
export const issueNextActionSchema = z.enum([
  "discuss",
  "reconfirm",
  "duplicate",
  "invalid",
  "fixed",
]);
export type IssueNextAction = z.infer<typeof issueNextActionSchema>;
export const issueVisibilitySchema = z.enum(["public", "private"]);
export const issueRelPathSchema = z.string().regex(
  /^(?:closed\/)?(?:bugs|features|code-quality|docs-and-chores|decisions|exploration|watch)\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/u,
  "Invalid issue path",
);

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
  relPath: issueRelPathSchema,
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
  relPath: issueRelPathSchema,
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

/**
 * What a browsable path turns out to be. A closed union so a renderer cannot
 * be silently missing: adding a member is a compile error until every switch
 * handles it (engineering principle 2).
 *
 * `page` is an agent-authored HTML artifact. It is deliberately NOT rendered
 * into the app document — those run scripts, and the origin separation that
 * keeps them off this origin is the whole reason the exhibits listener exists
 * (see `general-browser.md`, "The boundary this plan must not cross").
 */
export const documentKindSchema = z.enum(["markdown", "code", "directory", "page", "data"]);

/** One entry in a directory listing. */
export const directoryEntrySchema = z.object({
  name: z.string(),
  relPath: z.string(),
  kind: documentKindSchema,
});

export const documentSchema = z.object({
  /** Repository-relative, always — the address is the file, never the worktree. */
  relPath: z.string(),
  /** Which checkout this reading came from: a workstream name, or null for main. */
  workstream: z.string().nullable(),
  kind: documentKindSchema,
  /** Tracked in git. Decides which comment namespace the path belongs to. */
  tracked: z.boolean(),
  /** Source text. Null for a directory, and for anything not read as text. */
  text: z.string().nullable(),
  /** Populated only for `directory`. */
  entries: z.array(directoryEntrySchema),
  /** Bytes on disk, so a caller can explain a refusal rather than hang on it. */
  bytes: z.number(),
  /**
   * Why the content is absent when it is: too large, not text, unreadable.
   * Null when `text` is present. The pair is the whole point — "no content"
   * and "content we would not read" must not look alike (principle 4).
   */
  problem: z.string().nullable(),
  /**
   * Workstreams that have changed this path — the answer to "is someone else
   * rewriting what I am reading", learned from the file rather than from a
   * merge conflict.
   */
  changedIn: z.array(z.string()),
  /**
   * Workstreams whose diff could not be read. NON-EMPTY means `changedIn` is
   * incomplete, and a reader must not treat it as "nobody else touched this":
   * unavailable is not none (principle 4).
   */
  changesUnavailable: z.array(z.string()),
});

/** One entry in the browsable-path index, for quick-open and the sidebar. */
export const indexedPathSchema = z.object({
  relPath: z.string(),
  kind: documentKindSchema,
});

export const pathIndexSchema = z.object({
  workstream: z.string().nullable(),
  paths: z.array(indexedPathSchema),
});

/** One file in the recency feed — the browser's front door. */
export const recentFileSchema = z.object({
  relPath: z.string(),
  kind: documentKindSchema,
  /** Epoch seconds. */
  at: z.number(),
  /** Which checkout it changed in; null is the main checkout. */
  workstream: z.string().nullable(),
  /** Uncommitted or untracked — someone is working on it right now. */
  inProgress: z.boolean(),
});

export const recentFeedSchema = z.object({
  /**
   * When the feed was computed, epoch seconds. Relative times render against
   * THIS rather than the client's clock: the feed is a snapshot, and "3m ago"
   * should mean three minutes before the data, not before the paint. It also
   * keeps the render pure — no clock read on the render path.
   */
  now: z.number(),
  files: z.array(recentFileSchema),
  /** How much recent work came from where. */
  distribution: z.array(z.object({ workstream: z.string().nullable(), count: z.number() })),
  /** Checkouts whose scan failed, so an incomplete feed cannot look complete. */
  unavailable: z.array(z.object({ workstream: z.string(), problem: z.string() })),
  truncated: z.boolean(),
});

/** One workstream's changed paths, for the `?workstream=` filter. */
export const workstreamChangesSchema = z.object({
  workstream: z.string(),
  paths: z.array(z.string()),
  /** Set when this workstream's diff could not be read at all. */
  problem: z.string().nullable(),
});

export type DocumentKind = z.infer<typeof documentKindSchema>;
export type DirectoryEntry = z.infer<typeof directoryEntrySchema>;
export type BrowsedDocument = z.infer<typeof documentSchema>;
export type WorkstreamChangedFiles = z.infer<typeof workstreamChangesSchema>;
export type IndexedPath = z.infer<typeof indexedPathSchema>;
export type PathIndex = z.infer<typeof pathIndexSchema>;
export type RecentFile = z.infer<typeof recentFileSchema>;
export type RecentFeed = z.infer<typeof recentFeedSchema>;
