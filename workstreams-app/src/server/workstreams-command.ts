import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import {
  workstreamSummarySchema,
  workstreamsCliListSchema,
  type WorkstreamSummary,
} from "../shared/workstreams.js";
import type { WorkstreamsService } from "./services.js";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 30_000;
const COMMAND_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const STDERR_LIMIT = 1_000;

export interface CommandRequest {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  maxBufferBytes: number;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export type CommandRunner = (request: CommandRequest) => Promise<CommandResult>;

export class WorkstreamsCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkstreamsCommandError";
  }
}

class InvalidWorkstreamsJsonError extends WorkstreamsCommandError {
  constructor(stderr: string) {
    const suffix = stderr ? `: ${stderr}` : "";
    super(`${publicCommandName()} returned invalid JSON${suffix}`);
    this.name = "InvalidWorkstreamsJsonError";
  }
}

class InvalidWorkstreamsShapeError extends WorkstreamsCommandError {
  constructor(issuePaths: string, stderr: string) {
    const suffix = stderr ? `: ${stderr}` : "";
    super(`${publicCommandName()} returned an invalid shape at ${issuePaths}${suffix}`);
    this.name = "InvalidWorkstreamsShapeError";
  }
}

class WorkstreamsExecutionError extends WorkstreamsCommandError {
  constructor(detail: string) {
    const suffix = detail ? `: ${detail}` : "";
    super(`${publicCommandName()} failed${suffix}`);
    this.name = "WorkstreamsExecutionError";
  }
}

export async function runCommand(request: CommandRequest): Promise<CommandResult> {
  const result = await execFileAsync(request.command, request.args, {
    cwd: request.cwd,
    encoding: "utf8",
    timeout: request.timeoutMs,
    maxBuffer: request.maxBufferBytes,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

function publicCommandName(): string {
  return "bin/workstreams list --json --include-removed";
}

function scrubPaths(message: string, repoRoot: string): string {
  const withoutRepo = message.replaceAll(repoRoot, "<repo>");
  return withoutRepo.replaceAll(/\/(?:Users|home)\/[^\s/:]+/gu, "/<home>");
}

function boundedStderr(stderr: string, repoRoot: string): string {
  const scrubbed = scrubPaths(stderr.trim(), repoRoot);
  if (scrubbed.length <= STDERR_LIMIT) return scrubbed;
  return `…${scrubbed.slice(-STDERR_LIMIT)}`;
}

function commandFailureDetail(error: unknown, repoRoot: string): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "stderr" in error &&
    typeof error.stderr === "string" &&
    error.stderr.trim()
  ) {
    return boundedStderr(error.stderr, repoRoot);
  }
  const message = error instanceof Error ? error.message : String(error);
  return boundedStderr(message, repoRoot);
}

function schemaIssuePaths(error: { issues: Array<{ path: PropertyKey[] }> }): string {
  const paths = error.issues.slice(0, 8).map((issue) => issue.path.join("."));
  return paths.length === 0 ? "unknown fields" : paths.join(", ");
}

function normalizeRows(
  result: CommandResult,
  repoRoot: string,
): WorkstreamSummary[] {
  const stderr = boundedStderr(result.stderr, repoRoot);
  let json: unknown;
  try {
    json = JSON.parse(result.stdout);
  } catch (_error) {
    throw new InvalidWorkstreamsJsonError(stderr);
  }
  const parsed = workstreamsCliListSchema.safeParse(json);
  if (!parsed.success) {
    throw new InvalidWorkstreamsShapeError(
      schemaIssuePaths(parsed.error),
      stderr,
    );
  }
  return parsed.data.map((row) => workstreamSummarySchema.parse(row));
}

export interface WorkstreamsCommandServiceOptions {
  repoRoot: string;
  commandRunner?: CommandRunner | undefined;
}

export function createWorkstreamsCommandService(
  options: WorkstreamsCommandServiceOptions,
): WorkstreamsService {
  const commandRunner = options.commandRunner ?? runCommand;
  const command = path.join(options.repoRoot, "bin", "workstreams");
  return {
    async list(): Promise<WorkstreamSummary[]> {
      let result: CommandResult;
      try {
        result = await commandRunner({
          command,
          args: ["list", "--json", "--include-removed"],
          cwd: options.repoRoot,
          timeoutMs: COMMAND_TIMEOUT_MS,
          maxBufferBytes: COMMAND_MAX_BUFFER_BYTES,
        });
      } catch (error) {
        const safeDetail = commandFailureDetail(error, options.repoRoot);
        throw new WorkstreamsExecutionError(safeDetail);
      }
      return normalizeRows(result, options.repoRoot);
    },
  };
}
