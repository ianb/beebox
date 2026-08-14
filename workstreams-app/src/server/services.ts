import type { WorkstreamSummary } from "../shared/workstreams.js";

export interface WorkstreamsService {
  list(): Promise<WorkstreamSummary[]>;
}

export interface AppServices {
  workstreams: WorkstreamsService;
}
