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
 *   alerts --json                 the alert records, for the browser
 *   ack <alert-id>                stop showing an alert
 *   lint [--json]                 every schedule, checked without running it
 *   install | uninstall           the launchd tick
 *
 * THIS CLI IS THE ONLY WRITER of the store, the `bin/comments` precedent.
 *
 * Design: beebox/docs/plans/scheduled-workstreams.md
 * Schema/records: bin/lib/schedules.ts · Store: bin/lib/schedules-store.ts
 * Runner:         bin/lib/schedules-runner.ts (one schedule) + schedules-tick.ts (one launchd firing)
 * This file:      usage, `list`, `run`/`tick`/`logs`, `lint`, dispatch. The
 *                 process context and flag reader are bin/lib/schedules-cli-context.ts;
 *                 the reporting verbs are bin/lib/schedules-cli-report.ts.
 */

import * as path from "node:path";

import {
  formatDuration,
  loadSchedule,
  loadSchedules,
  type LoadedSchedule,
} from "./lib/schedules.js";
import {
  ensureStoreRoot,
  readAlerts,
  readScheduleState,
  readStoreState,
  latestRunId,
  visibleAlerts,
} from "./lib/schedules-store.js";
import {
  isDue,
  isOverdue,
  nextDueAtMs,
  readRunLog,
  refuseRunHere,
  runSchedule,
} from "./lib/schedules-runner.js";
import { tick } from "./lib/schedules-tick.js";
import { installTick, uninstallTick } from "./lib/schedules-launchd.js";
import { formatFinding, lintSchedules } from "./lib/schedules-lint.js";
import { flags, resolveContext, runnerDeps, type Context } from "./lib/schedules-cli-context.js";
import {
  commandAck,
  commandAlert,
  commandAlerts,
  commandDone,
  commandHandoff,
} from "./lib/schedules-cli-report.js";

/** `run <name>` naming a schedule the loader refuses. */
class UnrunnableScheduleError extends Error {
  constructor(readonly scheduleName: string, readonly detail: string) {
    super(`schedule '${scheduleName}' is not runnable — ${detail}`);
    this.name = "UnrunnableScheduleError";
  }
}

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
  alerts --json [--workstream <n>]
                                  Read-only: every open alert plus the ones
                                  acknowledged in the last 14 days.
  ack <alert-id>                  Acknowledge an alert.
  lint [--json]                   Check every schedule without running it:
                                  schema, shebangs, the dry-run and reporting
                                  contracts, shellcheck, eslint.
  install | uninstall             The launchd tick (main checkout only).
`;

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
  const lastTickSkippedAt = storeState === null ? null : storeState.lastTickSkippedAt;
  const lastTickSkippedReason = storeState === null ? null : storeState.lastTickSkippedReason;

  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ lastTickAt, lastTickSkippedAt, lastTickSkippedReason, schedules: rows, invalid })}\n`);
    return 0;
  }
  // A skip more recent than the last real tick is the shape of a wedged
  // scheduler: firings are happening, work is not.
  const skipped = lastTickSkippedAt !== null && (lastTickAt === null || lastTickSkippedAt > lastTickAt)
    ? ` (skipped ${agoText(lastTickSkippedAt, nowMs)}: ${lastTickSkippedReason ?? "reason unrecorded"})`
    : "";
  const lines = [`scheduler: last tick ${agoText(lastTickAt, nowMs)}${skipped}`];
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
    throw new UnrunnableScheduleError(name, detail);
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
  const refusal = refuseRunHere({ schedule, repoRoot: context.repoRoot, mainRoot: context.mainRoot, dryRun });
  if (refusal !== null) {
    process.stderr.write(`schedules run: ${refusal}\n`);
    return 2;
  }
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

// ─── lint ─────────────────────────────────────────────────────────────────

/** Silent and 0 when every schedule is clean — a lint that prints on success
 *  trains people to stop reading it (the pre-commit hook runs this). */
async function commandLint(context: Context, args: string[]): Promise<number> {
  const findings = await lintSchedules({ schedulesRoot: context.schedulesRoot, repoRoot: context.repoRoot });
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ findings })}\n`);
    return findings.length === 0 ? 0 : 1;
  }
  if (findings.length === 0) return 0;
  process.stdout.write(`${findings.map((finding) => formatFinding(finding)).join("\n")}\n`);
  return 1;
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
  if (command === "alerts") return commandAlerts(context, args);
  if (command === "ack") return commandAck(context, args);
  if (command === "lint") return commandLint(context, args);
  if (command === "install") return installTick({ repoRoot: context.repoRoot });
  if (command === "uninstall") return uninstallTick();
  process.stderr.write(`schedules: unknown command '${command}'\n\n${USAGE}`);
  return 2;
}

async function main(): Promise<number> {
  try {
    return await dispatch();
  } catch (e) {
    if (process.env["BBX_SCHEDULES_DEBUG"] === "1") throw e;
    process.stderr.write(`schedules: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

process.exitCode = await main();
