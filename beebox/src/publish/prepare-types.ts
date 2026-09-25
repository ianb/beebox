import type { FilePreview } from "./draft.js";
import type { PublicationDefinition } from "./publication-definition.js";
import type { LeakScanResult } from "./leak-scan.js";

export const PUBLICATION_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

export interface ProjectCommandRequest {
  step: "install" | "build";
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export type RunProjectCommand = (request: ProjectCommandRequest) => Promise<void>;

export interface PrepareDeps {
  ownerEmail: string | null;
  /** Test seam; production always uses the fixed pnpm commands below. */
  runProjectCommand?: RunProjectCommand;
  /** Test seam for deterministic environment construction. */
  parentEnv?: NodeJS.ProcessEnv;
}

export interface PreparedFile {
  path: string;
  bytes: number;
  sha256: string;
}

/** Server-local preparation result. Caller must invoke cleanup in a finally block. */
export interface PreparedPublication {
  definition: PublicationDefinition;
  pubId: string;
  contentHash: string;
  stagedDir: string;
  files: PreparedFile[];
  preview: FilePreview[];
  scan: LeakScanResult;
  cleanup: () => Promise<void>;
}

export type PrepareFailure =
  | { ok: false; reason: "invalid-definition" | "invalid-source" | "project-command-failed" | "bundle-policy"; message: string; step?: "install" | "build"; timedOut?: boolean; observed?: number; limit?: number };

export type PrepareResult = { ok: true; prepared: PreparedPublication } | PrepareFailure;
