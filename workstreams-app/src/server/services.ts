import type { WorkstreamIssue, WorkstreamListResult } from "../shared/workstreams.js";
import type {
  BrowsedDocument,
  Issue,
  IssueChange,
  Plan,
  Quota,
  TestingQueue,
} from "../shared/documents.js";
import type {
  ActionResult,
  ActionVerb,
  LifecycleJob,
} from "../shared/actions.js";
import type { AskQueue } from "../shared/exhibits.js";

export interface WorkstreamsService {
  list(): Promise<WorkstreamListResult>;
}

export interface AppServices {
  workstreams: WorkstreamsService;
  documents: DocumentsService;
  quotas: QuotasService;
  actions: ActionsService;
  exhibits: ExhibitsService;
}

/** Read-only: the workstreams origin never answers an ask (Track E). */
export interface ExhibitsService {
  askQueue(): Promise<AskQueue>;
}

export interface DocumentsService {
  listIssues(): Promise<Issue[]>;
  issueDetail(relPath: string, visibility: "public" | "private"): Promise<Issue>;
  listPlans(): Promise<Plan[]>;
  testingQueue(): Promise<TestingQueue>;
  issuesForWorkstream(name: string): Promise<WorkstreamIssue[]>;
  saveIssueChanges(changes: IssueChange[]): Promise<number>;
  /**
   * One browsable path. `workstream` is a LENS, not a location: null reads the
   * main checkout, a name reads that worktree's copy of the same address.
   */
  readDocument(request: { relPath: string; workstream: string | null }): Promise<BrowsedDocument>;
}

export interface QuotasService {
  get(): Promise<Quota[]>;
}

export interface ActionsService {
  run(verb: ActionVerb, name: string): Promise<ActionResult>;
  job(id: string): LifecycleJob | null;
  activeJobs(): number;
}
