import type { ActionResult, ActionVerb, LifecycleJob, ResumeStage } from "../shared/actions.js";
import type { BrowsedDocument, DirectoryEntry, Issue, IssueChange, Plan, Quota, RecentFeed, RecentFile, RelatedResult, RelatedRow, TestingQueue } from "../shared/documents.js";
import type { Comment } from "../shared/comments.js";
import type { WorkstreamListItem, WorkstreamSummary } from "../shared/workstreams.js";

export type { ActionResult, ActionVerb, BrowsedDocument, Comment, DirectoryEntry, Issue, IssueChange, LifecycleJob, Plan, Quota, RecentFeed, RecentFile, RelatedResult, RelatedRow, ResumeStage, TestingQueue };
export type Workstream = WorkstreamSummary;
export type { WorkstreamListItem };
export type QuotaWindow = Quota["windows"][number];
export type Priority = Issue["frontmatter"]["priority"];
export type NextActionState = NonNullable<Issue["nextAction"]>;
export type NextAction = NonNullable<NextActionState["action"]>;
export type Visibility = Issue["visibility"];
