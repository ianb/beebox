import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

import type {
  ActionResult,
  ActionVerb,
  LifecycleJob,
  ResumeStage,
} from "../shared/actions.js";
import type { ActionsService } from "./services.js";

const NORMAL_TIMEOUT_MS = 60_000;
const RESUME_TIMEOUT_MS = 15 * 60_000;
const JOB_RETENTION_MS = 30 * 60_000;
const STDERR_LIMIT = 4_096;

export function createResumeMarkerParser(
  onProgress: (stage: ResumeStage) => void,
): (chunk: string) => void {
  let remainder = "";
  return (chunk) => {
    const lines = `${remainder}${chunk}`.split(/[\r\n]/u);
    remainder = lines.pop() ?? "";
    for (const line of lines) {
      const stage = line.match(/WORKSTREAM_RESUME_STATUS:([a-z-]+)/u)?.[1];
      if (
        stage === "checking" ||
        stage === "restoring" ||
        stage === "preparing" ||
        stage === "opening-terminal" ||
        stage === "opened"
      ) onProgress(stage);
    }
    if (remainder.length > STDERR_LIMIT) remainder = remainder.slice(-STDERR_LIMIT);
  };
}

export interface ActionCommandRequest {
  verb: ActionVerb;
  name: string;
  onProgress?(stage: ResumeStage): void;
}

export type ActionCommandRunner = (request: ActionCommandRequest) => Promise<void>;

class WorkstreamActionError extends Error {
  constructor(detail: string) {
    super(detail || "workstream action failed");
    this.name = "WorkstreamActionError";
  }
}

function actionError(detail: string): WorkstreamActionError {
  return new WorkstreamActionError(detail);
}

function resumeError(stderr: string, timedOut: boolean): WorkstreamActionError {
  if (timedOut) return actionError("resume timed out after 15 minutes");
  const lines = stderr.split("\n").map((line) => line.trim()).filter((line) =>
    line !== "" && !line.includes("WORKSTREAM_RESUME_STATUS:"),
  );
  return actionError(lines.at(-1) ?? "resume failed");
}

export function createActionCommandRunner(repoRoot: string): ActionCommandRunner {
  const command = path.join(repoRoot, "bin", "workstreams");
  return async (request): Promise<void> => {
    const args = request.verb === "confirm-tested"
      ? [request.verb, request.name, "--agent-confirmed"]
      : [request.verb, request.name];
    const resume = request.verb === "resume";
    const child = spawn(command, args, {
      cwd: repoRoot,
      detached: true,
      env: resume ? { ...process.env, WORKSTREAM_RESUME_PROGRESS: "1" } : process.env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    const parseProgress = request.onProgress ? createResumeMarkerParser(request.onProgress) : null;
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      parseProgress?.(text);
      stderr = `${stderr}${text}`.slice(-STDERR_LIMIT);
    });
    const timeoutMs = resume ? RESUME_TIMEOUT_MS : NORMAL_TIMEOUT_MS;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch (_error) {
          // The process group already exited.
        }
      }
    }, timeoutMs);
    timeout.unref();
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    }).finally(() => clearTimeout(timeout));
    if (result.code !== 0) throw resumeError(stderr, timedOut);
  };
}

function terminal(job: LifecycleJob): boolean {
  return job.stage === "opened" || job.stage === "ready" || job.stage === "failed";
}

export interface ActionsServiceOptions {
  runCommand: ActionCommandRunner;
  setExpiry?: (callback: () => void, ms: number) => void;
}

export function createActionsService(options: ActionsServiceOptions): ActionsService {
  const jobs = new Map<string, LifecycleJob>();
  const jobsByName = new Map<string, LifecycleJob>();
  const setExpiry = options.setExpiry ?? ((callback, ms) => {
    const timer = setTimeout(callback, ms);
    timer.unref();
  });

  function startResume(name: string): LifecycleJob {
    const existing = jobsByName.get(name);
    if (existing && !terminal(existing)) return existing;
    const job: LifecycleJob = { id: randomUUID(), name, stage: "queued" };
    jobs.set(job.id, job);
    jobsByName.set(name, job);
    void options.runCommand({
      verb: "resume",
      name,
      onProgress(stage) {
        job.stage = stage;
      },
    }).then(() => {
      if (job.stage !== "failed" && job.stage !== "opened") job.stage = "ready";
    }).catch((error: unknown) => {
      job.stage = "failed";
      job.error = error instanceof Error ? error.message : String(error);
    });
    setExpiry(() => {
      jobs.delete(job.id);
      if (jobsByName.get(name) === job) jobsByName.delete(name);
    }, JOB_RETENTION_MS);
    return job;
  }

  return {
    async run(verb, name): Promise<ActionResult> {
      if (verb === "resume") return { status: "started", job: startResume(name) };
      await options.runCommand({ verb, name });
      return { status: "complete" };
    },
    job(id): LifecycleJob | null {
      return jobs.get(id) ?? null;
    },
    activeJobs(): number {
      return [...jobs.values()].filter((job) => !terminal(job)).length;
    },
  };
}
