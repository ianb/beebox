/**
 * Shared internal types for the reactor module.
 */

import type { createAgent as realCreateAgent } from "../agent.js";

/** Parsed info about a single job card found on disk. */
export interface JobCardInfo {
  file: string;
  priority: "normal" | "low";
}

/** A job card with its content loaded. */
export interface JobWithContent {
  card: JobCardInfo;
  relPath: string;
  content: string;
}

/** Options passed to processBatchJobs / processChatJobs. */
export interface ProcessJobsOptions {
  jobs: JobWithContent[];
  boxRoot: string;
  dryRun: boolean;
  typeFilter?: string | undefined;
  onLog?: ((text: string) => void) | undefined;
  createAgent: typeof realCreateAgent;
}
