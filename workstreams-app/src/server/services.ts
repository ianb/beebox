import type { WorkstreamIssue, WorkstreamListResult } from "../shared/workstreams.js";
import type {
  BrowsedDocument,
  PathIndex,
  RecentFeed,
  WorkstreamChangedFiles,
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
import type { ScheduleAlert } from "../shared/schedules.js";
import type { CommentsService } from "./comments-service.js";

export interface WorkstreamsService {
  list(): Promise<WorkstreamListResult>;
}

/**
 * Schedule alerts, read and acknowledged through `bin/schedules`. The app is a
 * reader of that store and never a writer (scheduled-workstreams.md, Track D).
 */
export interface SchedulesService {
  alerts(workstream: string | null): Promise<ScheduleAlert[]>;
  acknowledge(id: string): Promise<void>;
}

export interface AppServices {
  workstreams: WorkstreamsService;
  schedules: SchedulesService;
  documents: DocumentsService;
  comments: CommentsService;
  transcribe: TranscribeService;
  quotas: QuotasService;
  actions: ActionsService;
  exhibits: ExhibitsService;
}

/**
 * Audio in, text out. Declared here rather than imported from
 * transcribe-service.ts on purpose: the frontend tsconfig includes THIS file
 * (for the router's types), and importing the implementation would drag its
 * Blob/fetch code into a DOM-typed graph where a Node Buffer does not
 * typecheck. Interfaces here; implementations stay server-only.
 */
export interface TranscribeService {
  transcribe(input: { audio: Buffer; mimeType: string }): Promise<{ text: string }>;
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
  /** Every path one workstream has changed — the `?workstream=` filter's data. */
  changedFiles(workstream: string): Promise<WorkstreamChangedFiles>;
  /** What changed recently, anywhere — the browser's front door. */
  recentFiles(): Promise<RecentFeed>;
  /** Every browsable path in one checkout — quick-open's corpus. */
  pathIndex(workstream: string | null): Promise<PathIndex>;
}

export interface QuotasService {
  get(): Promise<Quota[]>;
}

export interface ActionsService {
  run(verb: ActionVerb, name: string): Promise<ActionResult>;
  job(id: string): LifecycleJob | null;
  activeJobs(): number;
}
