import path from "node:path";

import {
  scheduleAlertSchema,
  type ScheduleAlert,
} from "../shared/schedules.js";
import type { SchedulesService } from "./services.js";
import {
  runCommand,
  WorkstreamsCommandError,
  type CommandResult,
  type CommandRunner,
} from "./workstreams-command.js";

const COMMAND_TIMEOUT_MS = 30_000;
const COMMAND_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const STDERR_LIMIT = 1_000;

export class SchedulesCommandError extends WorkstreamsCommandError {
  constructor(message: string) {
    super(message);
    this.name = "SchedulesCommandError";
  }
}

class InvalidAlertJsonError extends SchedulesCommandError {
  constructor() {
    super("bin/schedules alerts --json returned invalid JSON");
    this.name = "InvalidAlertJsonError";
  }
}

class InvalidAlertTopLevelError extends SchedulesCommandError {
  constructor() {
    super("bin/schedules alerts --json returned no alert array");
    this.name = "InvalidAlertTopLevelError";
  }
}

class InvalidAlertRecordError extends SchedulesCommandError {
  constructor(detail: string) {
    super(`Invalid alert record: ${detail}`);
    this.name = "InvalidAlertRecordError";
  }
}

class SchedulesExecutionError extends SchedulesCommandError {
  constructor(detail: string) {
    super(`bin/schedules failed: ${detail}`);
    this.name = "SchedulesExecutionError";
  }
}

function scrubPaths(message: string, repoRoot: string): string {
  const withoutRepo = message.replaceAll(repoRoot, "<repo>");
  return withoutRepo.replaceAll(/\/(?:Users|home)\/[^\s/:]+/gu, "/<home>");
}

function boundedDetail(error: unknown, repoRoot: string): string {
  const raw = typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string" && error.stderr.trim()
    ? error.stderr
    : error instanceof Error ? error.message : String(error);
  const scrubbed = scrubPaths(raw.trim(), repoRoot);
  return scrubbed.length <= STDERR_LIMIT ? scrubbed : `…${scrubbed.slice(-STDERR_LIMIT)}`;
}

function parseAlerts(result: CommandResult, repoRoot: string): ScheduleAlert[] {
  let json: unknown;
  try {
    json = JSON.parse(result.stdout);
  } catch (_error) {
    throw new InvalidAlertJsonError();
  }
  if (typeof json !== "object" || json === null || !("alerts" in json) || !Array.isArray(json.alerts)) {
    throw new InvalidAlertTopLevelError();
  }
  const items: ScheduleAlert[] = [];
  for (const value of json.alerts) {
    const parsed = scheduleAlertSchema.safeParse(value);
    if (!parsed.success) {
      const fields = parsed.error.issues.slice(0, 4).map((issue) => issue.path.join(".")).join(", ");
      const stderr = result.stderr.trim() ? ` (${scrubPaths(result.stderr.trim(), repoRoot)})` : "";
      const detail = `${fields || "unknown fields"}${stderr}`;
      throw new InvalidAlertRecordError(detail);
    }
    items.push(parsed.data);
  }
  return items;
}

export interface SchedulesCommandServiceOptions {
  repoRoot: string;
  commandRunner?: CommandRunner | undefined;
}

/**
 * The alert half of the Scheduled section. Reads through `bin/schedules` and
 * acknowledges through it too: the app never writes the schedule store itself
 * (the plan's "the CLI is the only writer").
 */
export function createSchedulesCommandService(
  options: SchedulesCommandServiceOptions,
): SchedulesService {
  const commandRunner = options.commandRunner ?? runCommand;
  const command = path.join(options.repoRoot, "bin", "schedules");
  async function run(args: string[]): Promise<CommandResult> {
    try {
      return await commandRunner({
        command,
        args,
        cwd: options.repoRoot,
        timeoutMs: COMMAND_TIMEOUT_MS,
        maxBufferBytes: COMMAND_MAX_BUFFER_BYTES,
      });
    } catch (error) {
      const detail = `${args[0] ?? ""}: ${boundedDetail(error, options.repoRoot)}`;
      throw new SchedulesExecutionError(detail);
    }
  }
  return {
    async alerts(workstream: string | null): Promise<ScheduleAlert[]> {
      const args = workstream === null
        ? ["alerts", "--json"]
        : ["alerts", "--json", "--workstream", workstream];
      return parseAlerts(await run(args), options.repoRoot);
    },
    async acknowledge(id: string): Promise<void> {
      await run(["ack", id]);
    },
  };
}
