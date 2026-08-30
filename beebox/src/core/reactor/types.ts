/**
 * Shared internal types for the reactor module.
 */

import type { createAgent as realCreateAgent } from "../agent/index.js";

/** Parsed info about a single job card found on disk. */
export interface JobCardInfo {
  file: string;
  priority: "normal" | "low";
  /**
   * When the job card first appeared, used to bound how long low-priority
   * work may wait (see `discoverStage`). Read from the filename's timestamp
   * prefix, falling back to the file's mtime; `null` when neither is
   * available, which reads as "age unknown" and never triggers the deadline.
   */
  createdAt: Date | null;
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
