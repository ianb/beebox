/**
 * `bin/schedules` — the one CLI for recurring jobs in this repo.
 *
 * A schedule is a directory (`schedules/<name>/`), its head is a plain `run`
 * script, and its report is a durable record. One launchd tick drives
 * everything; due-ness, missed-run catch-up, and overdue detection are computed
 * here from persisted state rather than trusted to launchd.
 *
 * Verbs:
 *   list [--json]                 what is scheduled, and whether it is running
 *   tick                          one launchd firing: run everything due
 *   run <name> [--dry-run] [--force]
 *   logs <name> [--run <id>]      a run's output
 *   handoff --title <t> --body @file|-      "there is work" (called BY `run`)
 *   alert --title <t> --message <m> [...]   the report (called BY a session)
 *   done [--run <id>]             "finished, nothing to say"
 *   ack <alert-id>                stop showing an alert
 *   install | uninstall           the launchd tick
 *
 * THIS CLI IS THE ONLY WRITER of the store, the `bin/comments` precedent.
 *
 * Design: callback-box/docs/plans/scheduled-workstreams.md
 * Schema/records: bin/lib/schedules.ts · Store: bin/lib/schedules-store.ts
 * Runner:         bin/lib/schedules-runner.ts
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execa } from "execa";

import {
  HANDOFF_BODY_MAX,
  formatDuration,
  loadSchedule,
  loadSchedules,
  prioritySchema,
  schedulesStoreRoot,
  type LoadedSchedule,
  type Priority,
} from "./lib/schedules.js";
import {
  ensureScheduleDir,
  ensureStoreRoot,
  readAllAlerts,
  readAlerts,
  readScheduleState,
  readStoreState,
  latestRunId,
  visibleAlerts,
  writeAlert,
  writeHandoff,
  writeResult,
  isProcessAlive,
} from "./lib/schedules-store.js";
import {
  DRY_RUN_HANDOFF_MARKER,
  isDue,
  isOverdue,
  nextDueAtMs,
  readRunLog,
  runSchedule,
  tick,
} from "./lib/schedules-runner.js";
import { osascriptNotify, raiseAlert, type RunnerDeps } from "./lib/schedules-alerts.js";
import { installTick, uninstallTick } from "./lib/schedules-launchd.js";

const USAGE = `usage: bin/schedules <command>

  list [--json]                   Every schedule: cadence, last run, outcome,
                                  next due, overdue, open alerts — plus when
                                  the scheduler last ticked.
  tick                            One scheduler firing (what launchd runs).
  run <name> [--dry-run] [--force]
                                  Run one schedule. --dry-run writes nothing;
                                  --force ignores due-ness.
  logs <name> [--run <id>]        A run's log (latest run by default).
  handoff --title <t> --body @file|-
                                  Called by a \`run\` script: there is work.
  alert --title <t> --message <m> [--details @file|-]
        [--priority important|normal|backlog|fyi] [--workstream <n>] [--run <id>]
                                  The report. Writes a record, then notifies.
  done [--run <id>]               Finished with nothing to say.
  ack <alert-id>                  Acknowledge an alert.
  install | uninstall             The launchd tick (main checkout only).
`;

interface Context {
  repoRoot: string;
  mainRoot: string;
  schedulesRoot: string;
  storeRoot: string;
}

async function resolveContext(): Promise<Context> {
  const { stdout: top } = await execa("git", ["rev-parse", "--show-toplevel"]);
  const { stdout: common } = await execa("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const repoRoot = top.trim();
  const mainRoot = path.dirname(common.trim());
  return {
    repoRoot,
    mainRoot,
    schedulesRoot: path.join(repoRoot, "schedules"),
    storeRoot: schedulesStoreRoot(mainRoot),
  };
}

function runnerDeps(context: Context): RunnerDeps {
  return {
    storeRoot: context.storeRoot,
    schedulesRoot: context.schedulesRoot,
    repoRoot: context.repoRoot,
    mainRoot: context.mainRoot,
    now: () => new Date(),
    pid: process.pid,
    isProcessAlive,
    notify: osascriptNotify,
  };
}

// ─── Argument reading ─────────────────────────────────────────────────────

const VALUE_FLAGS = new Set(["title", "message", "details", "body", "priority", "workstream", "run"]);

/** `--flag value`, values consumed unconditionally: a message of "-- no" is
 *  the author's words, not a flag (the bin/comments rule). */
function flags(args: string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined || !arg.startsWith("--")) continue;
    const name = arg.slice(2);
    if (!VALUE_FLAGS.has(name)) continue;
    found.set(name, args[i + 1] ?? "");
    i += 1;
  }
  return found;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/** `@file` reads the file, `-` reads stdin, anything else is the text itself.
 *  Long details are the whole point of the flag, and no shell should have to
 *  carry 40 lines of log as an argument. */
async function readValue(raw: string): Promise<string> {
  if (raw === "-") return readStdin();
  if (raw.startsWith("@")) return fs.readFile(raw.slice(1), "utf8");
  return raw;
}

function envOr(flagValue: string | undefined, variable: string): string | null {
  if (flagValue !== undefined && flagValue !== "") return flagValue;
  const fromEnv = process.env[variable];
  return fromEnv === undefined || fromEnv === "" ? null : fromEnv;
}

function isDryRun(): boolean {
  return process.env["SCHEDULE_DRY_RUN"] === "1";
}

// ─── list ─────────────────────────────────────────────────────────────────

interface ListRow {
  name: string;
  description: string;
  cadence: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastOutcome: string | null;
  nextDueAt: string | null;
  due: boolean;
  overdue: boolean;
  openAlerts: number;
}

function agoText(fromIso: string | null, nowMs: number): string {
  if (fromIso === null) return "never";
  const elapsed = nowMs - Date.parse(fromIso);
  if (elapsed < 60000) return "just now";
  return `${formatDuration(Math.round(elapsed / 3600000) * 3600000)} ago`;
}

async function commandList(context: Context, args: string[]): Promise<number> {
  const nowMs = Date.now();
  const entries = await loadSchedules(context.schedulesRoot);
  const rows: ListRow[] = [];
  const invalid: { name: string; problems: string[] }[] = [];
  for (const entry of entries) {
    if (entry.kind === "invalid") {
      invalid.push({ name: entry.name, problems: entry.issues.map((issue) => `${issue.path}: ${issue.message}`) });
      continue;
    }
    const state = await readScheduleState(context.storeRoot, entry.name);
    const alerts = visibleAlerts(await readAlerts(context.storeRoot, entry.name), nowMs);
    const nextDue = nextDueAtMs({ config: entry.config, state });
    rows.push({
      name: entry.name,
      description: entry.config.description,
      cadence: formatDuration(entry.config.cadenceMs),
      enabled: entry.config.enabled,
      lastRunAt: state.lastRunAt,
      lastOutcome: state.lastOutcome,
      nextDueAt: nextDue === null ? null : new Date(nextDue).toISOString(),
      due: isDue({ config: entry.config, state }, nowMs),
      overdue: isOverdue({ config: entry.config, state }, nowMs),
      openAlerts: alerts.filter((alert) => alert.state === "open").length,
    });
  }
  const storeState = await readStoreState(context.storeRoot);
  const lastTickAt = storeState === null ? null : storeState.lastTickAt;

  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ lastTickAt, schedules: rows, invalid })}\n`);
    return 0;
  }
  const lines = [`scheduler: last tick ${agoText(lastTickAt, nowMs)}`];
  for (const row of rows) {
    const marks = [
      row.enabled ? null : "disabled",
      row.overdue ? "OVERDUE" : null,
      row.due && row.enabled ? "due" : null,
      row.openAlerts === 0 ? null : `${String(row.openAlerts)} alert(s)`,
    ].filter((mark) => mark !== null);
    lines.push(
      `${row.name}  every ${row.cadence}  last ${agoText(row.lastRunAt, nowMs)} (${row.lastOutcome ?? "—"})${marks.length === 0 ? "" : `  [${marks.join(", ")}]`}`,
    );
  }
  for (const entry of invalid) lines.push(`${entry.name}  INVALID: ${entry.problems.join("; ")}`);
  if (rows.length === 0 && invalid.length === 0) lines.push("no schedules");
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

// ─── run / tick / logs ────────────────────────────────────────────────────

async function requireSchedule(context: Context, name: string): Promise<LoadedSchedule> {
  const entry = await loadSchedule(path.join(context.schedulesRoot, name));
  if (entry.kind === "invalid") {
    const detail = entry.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(`schedule '${name}' is not runnable — ${detail}`);
  }
  return entry;
}

async function commandRun(context: Context, args: string[]): Promise<number> {
  const [name] = args;
  if (name === undefined || name.startsWith("--")) {
    process.stderr.write("schedules run: needs a schedule name\n");
    return 2;
  }
  const schedule = await requireSchedule(context, name);
  const dryRun = args.includes("--dry-run");
  const deps = runnerDeps(context);

  if (!dryRun && !args.includes("--force")) {
    await ensureStoreRoot(context.storeRoot);
    const state = await readScheduleState(context.storeRoot, name);
    if (!isDue({ config: schedule.config, state }, Date.now())) {
      process.stdout.write(`${name} is not due (--force to run anyway).\n`);
      return 0;
    }
  }
  if (!dryRun) await ensureStoreRoot(context.storeRoot);

  const report = await runSchedule(deps, { schedule, dryRun });
  if (report.kind === "skipped") {
    process.stdout.write(`${name} skipped: ${report.reason}\n`);
    return 0;
  }
  if (report.kind === "dry-run") {
    process.stdout.write(report.output.endsWith("\n") || report.output === "" ? report.output : `${report.output}\n`);
    process.stdout.write(`dry run: would record '${report.outcome}' (exit ${String(report.exitCode)}); nothing written.\n`);
    return report.outcome === "failed" ? 1 : 0;
  }
  process.stdout.write(`${name} ${report.runId}: ${report.outcome} (exit ${String(report.exitCode)})\n`);
  return report.outcome === "failed" ? 1 : 0;
}

async function commandTick(context: Context): Promise<number> {
  const result = await tick(runnerDeps(context));
  if (result.heartbeatError !== null) {
    process.stderr.write(`schedules tick: ${result.heartbeatError}\n`);
    return result.exitCode;
  }
  for (const report of result.reports) {
    if (report.kind === "skipped") process.stdout.write(`${report.name}: ${report.reason}\n`);
    else if (report.kind === "ran") process.stdout.write(`${report.name} ${report.runId}: ${report.outcome}\n`);
  }
  return result.exitCode;
}

async function commandLogs(context: Context, args: string[]): Promise<number> {
  const [name] = args;
  if (name === undefined || name.startsWith("--")) {
    process.stderr.write("schedules logs: needs a schedule name\n");
    return 2;
  }
  const runId = flags(args).get("run") ?? (await latestRunId(context.storeRoot, name));
  if (runId === null || runId === undefined || runId === "") {
    process.stdout.write(`${name} has no recorded runs.\n`);
    return 0;
  }
  const log = await readRunLog(context.storeRoot, { name, runId });
  if (log === null) {
    process.stderr.write(`schedules logs: no log for ${name} run ${runId}\n`);
    return 1;
  }
  process.stdout.write(log.endsWith("\n") ? log : `${log}\n`);
  return 0;
}

// ─── handoff / alert / done / ack ─────────────────────────────────────────

/** The run id a reporting command belongs to. `--run` wins over the env so a
 *  session that lost its environment (a resumed tab) can still report; with
 *  neither there is nothing to attach the record to, so it refuses. */
function resolveRunId(options: Map<string, string>): string | null {
  return envOr(options.get("run"), "SCHEDULE_RUN_ID");
}

function resolveWorkstream(options: Map<string, string>): string | null {
  return envOr(options.get("workstream"), "SCHEDULE_NAME");
}

async function commandHandoff(context: Context, args: string[]): Promise<number> {
  const options = flags(args);
  const title = options.get("title");
  const rawBody = options.get("body");
  if (title === undefined || title === "") {
    process.stderr.write("schedules handoff: --title is required\n");
    return 2;
  }
  if (rawBody === undefined) {
    process.stderr.write("schedules handoff: --body is required (@file, - for stdin, or text)\n");
    return 2;
  }
  const name = resolveWorkstream(options);
  const runId = resolveRunId(options);
  if (name === null || runId === null) {
    process.stderr.write("schedules handoff: needs SCHEDULE_NAME/SCHEDULE_RUN_ID (or --workstream/--run)\n");
    return 2;
  }
  const body = await readValue(rawBody);
  if (body.length > HANDOFF_BODY_MAX) {
    process.stderr.write(`schedules handoff: body is ${String(body.length)} bytes, over the ${String(HANDOFF_BODY_MAX)} limit\n`);
    return 2;
  }
  if (isDryRun()) {
    // A dry run writes nothing anywhere; the marker is how the runner reports
    // the would-be outcome.
    process.stdout.write(`${DRY_RUN_HANDOFF_MARKER} ${title}\n${body}\n`);
    return 0;
  }
  await ensureStoreRoot(context.storeRoot);
  await ensureScheduleDir(context.storeRoot, name);
  await writeHandoff(context.storeRoot, { name, runId, title, body, at: new Date().toISOString() });
  return 0;
}

function parsePriority(raw: string | undefined): Priority {
  if (raw === undefined || raw === "") return "normal";
  const parsed = prioritySchema.safeParse(raw);
  if (!parsed.success) throw new Error(`--priority must be important|normal|backlog|fyi, got '${raw}'`);
  return parsed.data;
}

async function commandAlert(context: Context, args: string[]): Promise<number> {
  const options = flags(args);
  const title = options.get("title");
  const message = options.get("message");
  if (title === undefined || title === "") {
    process.stderr.write("schedules alert: --title is required\n");
    return 2;
  }
  if (message === undefined || message === "") {
    process.stderr.write("schedules alert: --message is required\n");
    return 2;
  }
  const name = resolveWorkstream(options);
  const runId = resolveRunId(options);
  if (name === null || runId === null) {
    process.stderr.write("schedules alert: needs SCHEDULE_NAME/SCHEDULE_RUN_ID (or --workstream/--run)\n");
    return 2;
  }
  const rawDetails = options.get("details");
  const details = rawDetails === undefined || rawDetails === "" ? null : await readValue(rawDetails);
  if (isDryRun()) {
    process.stdout.write(`[schedules] would alert (${parsePriority(options.get("priority"))}): ${title}\n${message}\n`);
    return 0;
  }
  await ensureStoreRoot(context.storeRoot);
  const alert = await raiseAlert(runnerDeps(context), {
    workstream: name,
    runId,
    title,
    message,
    details,
    priority: parsePriority(options.get("priority")),
  });
  await writeResult(context.storeRoot, { name, runId, kind: "alert", alertId: alert.id, at: new Date().toISOString() });
  process.stdout.write(`${alert.id}\n`);
  return 0;
}

async function commandDone(context: Context, args: string[]): Promise<number> {
  const options = flags(args);
  const name = resolveWorkstream(options);
  const runId = resolveRunId(options);
  if (name === null || runId === null) {
    process.stderr.write("schedules done: needs SCHEDULE_NAME/SCHEDULE_RUN_ID (or --workstream/--run)\n");
    return 2;
  }
  if (isDryRun()) {
    process.stdout.write("[schedules] would record done\n");
    return 0;
  }
  await ensureStoreRoot(context.storeRoot);
  await ensureScheduleDir(context.storeRoot, name);
  await writeResult(context.storeRoot, { name, runId, kind: "done", alertId: null, at: new Date().toISOString() });
  return 0;
}

async function commandAck(context: Context, args: string[]): Promise<number> {
  const [id] = args;
  if (id === undefined || id.startsWith("--")) {
    process.stderr.write("schedules ack: needs an alert id\n");
    return 2;
  }
  const alerts = await readAllAlerts(context.storeRoot);
  const alert = alerts.find((candidate) => candidate.id === id);
  if (alert === undefined) {
    process.stderr.write(`schedules ack: no alert '${id}'\n`);
    return 1;
  }
  if (alert.state === "acknowledged") {
    process.stdout.write(`${id} was already acknowledged.\n`);
    return 0;
  }
  await writeAlert(context.storeRoot, { ...alert, state: "acknowledged", acknowledgedAt: new Date().toISOString() });
  return 0;
}

// ─── Dispatch ─────────────────────────────────────────────────────────────

async function dispatch(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(USAGE);
    return command === undefined ? 2 : 0;
  }
  const context = await resolveContext();
  if (command === "list") return commandList(context, args);
  if (command === "tick") return commandTick(context);
  if (command === "run") return commandRun(context, args);
  if (command === "logs") return commandLogs(context, args);
  if (command === "handoff") return commandHandoff(context, args);
  if (command === "alert") return commandAlert(context, args);
  if (command === "done") return commandDone(context, args);
  if (command === "ack") return commandAck(context, args);
  if (command === "install") return installTick({ repoRoot: context.repoRoot });
  if (command === "uninstall") return uninstallTick();
  process.stderr.write(`schedules: unknown command '${command}'\n\n${USAGE}`);
  return 2;
}

async function main(): Promise<number> {
  try {
    return await dispatch();
  } catch (e) {
    if (process.env["CB_SCHEDULES_DEBUG"] === "1") throw e;
    process.stderr.write(`schedules: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

process.exitCode = await main();
