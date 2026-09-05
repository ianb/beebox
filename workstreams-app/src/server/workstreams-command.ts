import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import {
  workstreamsCliRowSchema,
  workstreamSummarySchema,
  type WorkstreamListResult,
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

class InvalidWorkstreamsTopLevelError extends WorkstreamsCommandError {
  constructor(stderr: string) {
    const suffix = stderr ? `: ${stderr}` : "";
    super(`${publicCommandName()} returned a non-array top-level value${suffix}`);
    this.name = "InvalidWorkstreamsTopLevelError";
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
): WorkstreamListResult {
  const stderr = boundedStderr(result.stderr, repoRoot);
  let json: unknown;
  try {
    json = JSON.parse(result.stdout);
  } catch (_error) {
    throw new InvalidWorkstreamsJsonError(stderr);
  }
  if (!Array.isArray(json)) {
    throw new InvalidWorkstreamsTopLevelError(stderr);
  }
  const items: WorkstreamListResult["items"] = [];
  const warnings: WorkstreamListResult["warnings"] = [];
  let invalidRows = 0;
  for (const [row, value] of json.entries()) {
    const parsed = workstreamsCliRowSchema.safeParse(value);
    if (parsed.success) {
      items.push(workstreamSummarySchema.parse(parsed.data));
      continue;
    }
    invalidRows += 1;
    if (warnings.length >= 8) continue;
    const fields = schemaIssuePaths(parsed.error).split(", ");
    const name = typeof value === "object" && value !== null && "name" in value && typeof value.name === "string" && value.name
      ? value.name
      : null;
    const label = name ? ` (${name})` : "";
    warnings.push({ row, name, fields, message: `Invalid workstream row ${row}${label}: ${fields.join(", ")}` });
  }
  if (invalidRows > warnings.length) {
    const omitted = invalidRows - warnings.length;
    warnings.push({ row: null, name: null, fields: [], message: `${omitted} additional invalid workstream ${omitted === 1 ? "row was" : "rows were"} omitted` });
  }
  if (stderr) {
    warnings.push({ row: null, name: null, fields: [], message: stderr });
  }
  return { items, warnings };
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
    async list(): Promise<WorkstreamListResult> {
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
