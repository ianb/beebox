import type { ActionResult, ActionVerb, LifecycleJob, ResumeStage } from "../shared/actions.js";
import type { Issue, IssueChange, Plan, Quota, TestingQueue } from "../shared/documents.js";
import type { WorkstreamSummary } from "../shared/workstreams.js";

export type { ActionResult, ActionVerb, Issue, IssueChange, LifecycleJob, Plan, Quota, ResumeStage, TestingQueue };
export type Workstream = WorkstreamSummary;
export type QuotaWindow = Quota["windows"][number];
export type Priority = Issue["frontmatter"]["priority"];
export type NextAction = NonNullable<Issue["frontmatter"]["nextAction"]>;
export type Visibility = Issue["visibility"];
