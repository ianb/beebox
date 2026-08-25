/**
 * Starting the workstream: what happens when a `run` script says there is work
 * (or dies trying) and its schedule declares a `workstream:`.
 *
 * The session goes through the EXISTING launch lifecycle rather than around
 * it — `bin/workstreams create`, the liveness guard, the registry's launch
 * lease — so a scheduled session is visible in the browser and stale-launch
 * cleanup applies to it. The agent command itself is assembled in one place,
 * `bin/lib/launch-headless.sh`, next to the Terminal launcher it is the
 * unattended counterpart of.
 *
 * The session's own report is a record, not an exit code: it finishes with
 * `bin/schedules alert` or `bin/schedules done`. A session that ends with
 * neither BAILED, and that is an `important` alert — the silent failure this
 * plan exists to refuse.
 *
 * Design: callback-box/docs/plans/scheduled-workstreams.md (Track B).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { execa } from "execa";
import { z } from "zod";

import {
  ScheduleError,
  type Handoff,
  type LoadedSchedule,
  type Outcome,
  type ScheduleState,
  type ScheduleWorkstream,
} from "./schedules.js";
import { logPath, readResult, tailLog, writeScheduleState } from "./schedules-store.js";
import { raiseAlert, type RunnerDeps } from "./schedules-alerts.js";
import { execChild, scheduleEnv } from "./schedules-exec.js";

/** How many log lines an alert carries as details. */
const LOG_TAIL_LINES = 40;

/** Fail-closed, the same three states `wt_other_agent_live` treats as live
 *  (`bin/lib/worktree-teardown.sh:94-96`): a scheduled run must never pull the
 *  rug out from under a session the boxholder is sitting in. */
const LIVE_STATES = new Set(["live", "launching", "unknown"]);

export interface WorkstreamOutcome {
  kind: "launched" | "refused" | "unlaunchable";
  sessionExit: number | null;
  checkExit: number | null;
  timedOut: boolean;
}

const NOT_LAUNCHED = { sessionExit: null, checkExit: null, timedOut: false };

// ─── The briefing ─────────────────────────────────────────────────────────

/**
 * The run id is in the TEXT, not only the environment, so a session that lost
 * its environment — a later `resume` in a Terminal tab, an agent that shelled
 * out through something that scrubbed it — can still file its report.
 */
export function briefingFor(input: { name: string; runId: string; handoff: Handoff | null; logTail: string; outcome: Outcome }): string {
  const parts: string[] = [];
  if (input.handoff !== null) parts.push(`# ${input.handoff.title}\n\n${input.handoff.body}`);
  if (input.outcome === "failed") {
    parts.push(
      `# The \`${input.name}\` run failed\n\nIts last ${String(LOG_TAIL_LINES)} log lines:\n\n\`\`\`\n${input.logTail}\n\`\`\``,
    );
  }
  parts.push(
    [
      "---",
      "",
      `You are running as scheduled run \`${input.runId}\` of the \`${input.name}\` schedule.`,
      "",
      "Finish by filing your report — a run whose session ends without one is recorded as bailed:",
      "",
      `    bin/schedules alert --run ${input.runId} --title "<one line>" --message "<one short paragraph>" \\`,
      "        [--details @<file>] [--priority important|normal|backlog|fyi]",
      "",
      "or, when there is nothing worth saying:",
      "",
      `    bin/schedules done --run ${input.runId}`,
      "",
    ].join("\n"),
  );
  return `${parts.join("\n\n")}\n`;
}

// ─── The existing lifecycle, called out to ────────────────────────────────

const livenessSchema = z.object({
  ok: z.boolean(),
  paths: z.record(z.string(), z.object({ state: z.string(), reason: z.string() })),
});

function workstreamsCli(deps: RunnerDeps): string {
  return path.join(deps.mainRoot, "bin", "workstreams");
}

/**
 * The guard is asked, never re-implemented: `bin/workstreams agent-liveness`
 * is the one implementation of it, and a second one is how the fail-open sweep
 * bug of 2026-08-04 happened. A guard that cannot answer reads as `unknown`,
 * which counts as live.
 */
async function agentState(deps: RunnerDeps, worktreePath: string): Promise<string> {
  const result = await execa(workstreamsCli(deps), ["agent-liveness", worktreePath], { reject: false });
  if (result.exitCode !== 0) return "unknown";
  const parsed = livenessSchema.safeParse(JSON.parse(result.stdout));
  if (!parsed.success) return "unknown";
  return parsed.data.paths[worktreePath]?.state ?? "unknown";
}

/** One bash call per registry function: the shell library is the only writer of
 *  a registry record, and re-implementing its locking in TypeScript would give
 *  the store two writers with different ideas about atomicity. */
async function registryCall(deps: RunnerDeps, call: { fn: string; args: string[] }): Promise<boolean> {
  const lib = path.join(import.meta.dirname, "session-registry.sh");
  const result = await execa(
    "bash",
    ["-c", `. "${lib}"\n${call.fn} "$@"`, "bash", ...call.args],
    { reject: false, env: { ...process.env } },
  );
  return result.exitCode === 0;
}

/** Claude refuses `--resume` for an id whose transcript does not exist yet, so
 *  the first turn of a persistent schedule mints the id and later turns resume
 *  it (`bin/update-agent-sdk-scheduled.sh:96-100`). */
async function claudeTranscriptExists(sessionId: string): Promise<boolean> {
  const projects = path.join(process.env["HOME"] ?? "", ".claude", "projects");
  let entries: string[];
  try {
    entries = await fs.readdir(projects);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
  for (const entry of entries) {
    try {
      await fs.stat(path.join(projects, entry, `${sessionId}.jsonl`));
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT" && (e as NodeJS.ErrnoException).code !== "ENOTDIR") throw e;
    }
  }
  return false;
}

// ─── The agent command ────────────────────────────────────────────────────

interface SessionIdentity {
  sessionId: string | null;
  resume: boolean;
}

/** What `session:` means for this run. `fresh` keeps nothing; `persistent`
 *  keeps one id in the schedule's `state.json` for claude, and resumes codex's
 *  own newest session for this directory (codex mints ids itself — there is
 *  nothing to pre-mint, so "has this schedule run before" is the question). */
async function sessionIdentity(deps: RunnerDeps, input: { schedule: LoadedSchedule; workstream: ScheduleWorkstream; previous: ScheduleState }): Promise<SessionIdentity> {
  if (input.workstream.session === "fresh") return { sessionId: null, resume: false };
  if (input.workstream.agent === "codex") return { sessionId: null, resume: input.previous.lastRunId !== null };
  const existing = input.previous.sessionId;
  if (existing !== null) return { sessionId: existing, resume: await claudeTranscriptExists(existing) };
  const minted = randomUUID();
  await writeScheduleState(deps.storeRoot, { name: input.schedule.name, state: { ...input.previous, sessionId: minted } });
  return { sessionId: minted, resume: false };
}

function listEnv(values: string[] | undefined): string {
  if (values === undefined) return "";
  for (const value of values) {
    // The argv comes back from bash one element per line, so a tool pattern
    // containing a newline would silently become two arguments — refuse it
    // rather than launch an agent with a sandbox nobody wrote.
    if (value.includes("\n")) throw new ScheduleError(`tool pattern '${value}' contains a newline`);
  }
  return values.join("\n");
}

/** Assemble the agent command through the one shell library that knows these
 *  flags. A refusal (codex asked for constraints it has no equivalent for) is
 *  its stderr, and it stops the launch. */
async function agentArgv(input: { workstream: ScheduleWorkstream; name: string; dir: string; cwd: string; identity: SessionIdentity }): Promise<{ ok: true; argv: string[] } | { ok: false; reason: string }> {
  const { workstream } = input;
  const result = await execa(path.join(import.meta.dirname, "launch-headless.sh"), [], {
    reject: false,
    env: {
      ...process.env,
      LH_AGENT: workstream.agent,
      LH_WORKSTREAM: input.name,
      LH_MODEL: workstream.model,
      LH_EFFORT: workstream.effort ?? "",
      LH_PERMISSION_MODE: workstream.permissionMode,
      LH_SYSTEM_PROMPT_FILE: path.join(input.dir, "prompt.md"),
      LH_TOOLS: listEnv(workstream.tools),
      LH_ALLOWED_TOOLS: listEnv(workstream.allowedTools),
      LH_DISALLOWED_TOOLS: listEnv(workstream.disallowedTools),
      LH_MAX_BUDGET_USD: workstream.maxBudgetUsd === undefined ? "" : String(workstream.maxBudgetUsd),
      LH_SESSION: workstream.session,
      LH_SESSION_ID: input.identity.sessionId ?? "",
      LH_SESSION_RESUME: input.identity.resume ? "1" : "0",
      LH_CWD: input.cwd,
    },
  });
  if (result.exitCode !== 0) return { ok: false, reason: result.stderr.trim() === "" ? `launch-headless exited ${String(result.exitCode)}` : result.stderr.trim() };
  const argv = result.stdout.split("\n").filter((line) => line !== "");
  const [file] = argv;
  if (file === undefined) return { ok: false, reason: "launch-headless produced no command" };
  return { ok: true, argv };
}

// ─── Start ────────────────────────────────────────────────────────────────

export interface StartRequest {
  schedule: LoadedSchedule;
  runId: string;
  outcome: Outcome;
  handoff: Handoff | null;
  /** The schedule's state as of BEFORE this run stamped itself: what says
   *  whether a persistent session exists yet. */
  previous: ScheduleState;
}

/**
 * Create-or-reattach the worktree, take the launch lease, run the agent in the
 * foreground with its briefing on stdin, then account for what it did.
 */
export async function startWorkstream(deps: RunnerDeps, request: StartRequest): Promise<WorkstreamOutcome> {
  const { schedule, runId } = request;
  const workstream = schedule.config.workstream;
  if (workstream === null) throw new ScheduleError(`${schedule.name} has no workstream to start`);
  const logFile = logPath(deps.storeRoot, { name: schedule.name, runId });
  const alert = async (input: { title: string; message: string; details: string | null; priority: "important" | "normal" }): Promise<void> => {
    await raiseAlert(deps, { workstream: schedule.name, runId, ...input });
  };

  let cwd = deps.mainRoot;
  if (workstream.worktree) {
    const created = await execa(workstreamsCli(deps), ["create", schedule.name], { reject: false });
    const worktreePath = created.stdout.trim();
    if (created.exitCode !== 0 || worktreePath === "") {
      await alert({
        title: "could not create the worktree",
        message: `${schedule.name} has work waiting but its worktree could not be created.`,
        details: created.stderr.trim() === "" ? null : created.stderr,
        priority: "important",
      });
      return { kind: "unlaunchable", ...NOT_LAUNCHED };
    }
    cwd = worktreePath;

    const state = await agentState(deps, cwd);
    if (LIVE_STATES.has(state)) {
      // Not a failure: the work is recorded and the person (or agent) already
      // in that worktree can pick it up. Starting a second agent there is the
      // rug-pull the guard exists to prevent.
      await alert({
        title: "work waiting, session already live",
        message: `${schedule.name} has work waiting, but its worktree already has an agent (${state}).`,
        details: null,
        priority: "normal",
      });
      return { kind: "refused", ...NOT_LAUNCHED };
    }
  }
  // A `worktree: false` schedule runs in the main checkout, which the boxholder
  // also works in; the liveness guard is deliberately not applied there (it
  // would block the schedule for as long as any session is open, and the
  // checkout is not a tree this run can pull out from under anyone).

  const token = randomUUID();
  const metadata = JSON.stringify({
    kind: "scheduled",
    agent: workstream.agent,
    model: workstream.model,
    description: schedule.config.description,
  });
  const leased = await registryCall(deps, { fn: "session_registry_begin_launch", args: [schedule.name, token, metadata] });
  await registryCall(deps, { fn: "session_registry_mark_scheduled", args: [schedule.name] });
  if (!leased) {
    await alert({
      title: "could not record the launch",
      message: `${schedule.name} could not take a launch lease; no session was started.`,
      details: null,
      priority: "important",
    });
    return { kind: "unlaunchable", ...NOT_LAUNCHED };
  }

  const identity = await sessionIdentity(deps, { schedule, workstream, previous: request.previous });
  const command = await agentArgv({ workstream, name: schedule.name, dir: schedule.dir, cwd, identity });
  if (!command.ok) {
    await registryCall(deps, { fn: "session_registry_fail_launch", args: [schedule.name, token, "headless-command-refused"] });
    await alert({
      title: "the agent command could not be assembled",
      message: `${schedule.name} declares a workstream its agent cannot run.`,
      details: command.reason,
      priority: "important",
    });
    return { kind: "unlaunchable", ...NOT_LAUNCHED };
  }

  const logTail = await tailLog(logFile, LOG_TAIL_LINES);
  let briefing = briefingFor({ name: schedule.name, runId, handoff: request.handoff, logTail, outcome: request.outcome });
  if (workstream.agent === "codex") {
    // Codex has no --append-system-prompt-file: the schedule's prompt leads the
    // briefing instead, so the same prompt.md serves both agents.
    briefing = `${await fs.readFile(path.join(schedule.dir, "prompt.md"), "utf8")}\n\n${briefing}`;
  }

  const env = scheduleEnv({ name: schedule.name, dir: schedule.dir, runId, stateDir: path.join(deps.storeRoot, schedule.name), dryRun: false });
  const [file, ...args] = command.argv;
  const session = await execChild({ file: file ?? "", args }, { cwd, env, timeoutMs: schedule.config.timeoutMs, logFile, input: briefing });

  await registryCall(deps, {
    fn: "session_registry_complete_launch",
    args: [schedule.name, token, JSON.stringify({
      kind: "scheduled",
      // Only a worktree schedule has a branch of its own; a `worktree: false`
      // one ran in the main checkout and claiming a branch would be a lie the
      // browser then offers to resume.
      ...(workstream.worktree ? { branch: `worktree-${schedule.name}` } : {}),
      agent: workstream.agent,
      model: workstream.model,
      description: schedule.config.description,
      launchedAt: deps.now().toISOString().replace(/\.\d{3}Z$/u, "Z"),
    }), "--preserve-base-sha"],
  });

  let checkExit: number | null = null;
  const checkScript = path.join(schedule.dir, "check");
  if (await isExecutable(checkScript)) {
    const check = await execChild({ file: checkScript, args: [] }, { cwd, env, timeoutMs: schedule.config.timeoutMs, logFile, input: null });
    checkExit = check.exitCode;
    if (check.exitCode !== 0) {
      await alert({
        title: "the post-session check failed",
        message: `${schedule.name} ran its session, but \`check\` exited ${String(check.exitCode)}.`,
        details: `Last ${String(LOG_TAIL_LINES)} log lines:\n\n\`\`\`\n${await tailLog(logFile, LOG_TAIL_LINES)}\n\`\`\``,
        priority: "important",
      });
    }
  }

  await alertIfBailed(deps, { name: schedule.name, runId, logFile });
  return { kind: "launched", sessionExit: session.exitCode, checkExit, timedOut: session.timedOut };
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && (stat.mode & 0o111) !== 0;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}

/**
 * A run with a session and no `runs/<id>.result.json` is a bailed run. This is
 * the whole point of the result record, and it is checked from two places: here
 * (the session just ended) and from the next tick when a lock left by a dead
 * runner is reclaimed (the laptop was shut down mid-session).
 */
export async function alertIfBailed(deps: RunnerDeps, run: { name: string; runId: string; logFile: string }): Promise<boolean> {
  if ((await readResult(deps.storeRoot, run)) !== null) return false;
  const tail = await tailLog(run.logFile, LOG_TAIL_LINES);
  await raiseAlert(deps, {
    workstream: run.name,
    runId: run.runId,
    title: "session ended without reporting",
    message: `${run.name} started a session for run ${run.runId} that ended without \`bin/schedules alert\` or \`done\`.`,
    details: tail === "" ? null : `Last ${String(LOG_TAIL_LINES)} log lines:\n\n\`\`\`\n${tail}\n\`\`\``,
    priority: "important",
  });
  return true;
}
