/**
 * Schedules: the schema, the loader, and every record shape the store holds.
 *
 * A schedule is one directory `schedules/<name>/` (tracked in git) holding a
 * `schedule.yaml`, an executable `run`, an optional `check`, and a `prompt.md`
 * when the schedule can start a workstream. This module is the parse boundary
 * for all of it — nothing downstream reads YAML or JSON from disk without a
 * Zod schema here, because a schedule that fails at 03:00 on a Sunday with
 * nobody watching is the failure the whole design exists to prevent.
 *
 * Design: callback-box/docs/plans/scheduled-workstreams.md (Tracks A, B, C).
 * Store IO (marker discipline, atomic writes, locks): bin/lib/schedules-store.ts
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as YAML from "yaml";
import { z } from "zod";

/** A refusal this module raises for input it will not guess about. */
export class ScheduleError extends Error {
  override name = "ScheduleError";
}

// ─── Durations ────────────────────────────────────────────────────────────

const DURATION_PATTERN = /^([1-9][0-9]*)([hdw])$/;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/** `<n>h | <n>d | <n>w` to milliseconds. No cron syntax: a laptop that sleeps
 *  gains nothing from wall-clock expressions (the plan's "not added" list). */
export function parseDuration(text: string): number {
  const match = DURATION_PATTERN.exec(text);
  if (match === null) throw new ScheduleError(`not a duration: '${text}' (use <n>h, <n>d or <n>w)`);
  const [, count, unit] = match;
  if (count === undefined || unit === undefined) throw new ScheduleError(`not a duration: '${text}'`);
  const amount = Number(count);
  if (unit === "h") return amount * HOUR_MS;
  if (unit === "d") return amount * DAY_MS;
  return amount * WEEK_MS;
}

/** Milliseconds back to the shortest exact `<n>h|d|w` spelling, for output. */
export function formatDuration(ms: number): string {
  if (ms % WEEK_MS === 0) return `${String(ms / WEEK_MS)}w`;
  if (ms % DAY_MS === 0) return `${String(ms / DAY_MS)}d`;
  if (ms % HOUR_MS === 0) return `${String(ms / HOUR_MS)}h`;
  return `${String(Math.round(ms / 60000))}m`;
}

const durationSchema = z
  .string()
  .regex(DURATION_PATTERN, "must be <n>h, <n>d or <n>w (e.g. 7d)")
  .transform((text) => parseDuration(text));

// ─── schedule.yaml ────────────────────────────────────────────────────────

export const scheduleWorkstreamSchema = z.strictObject({
  agent: z.enum(["claude", "codex"]),
  model: z.string().min(1),
  /** Reasoning effort, passed through as `--effort`. Claude-only: codex has no
   *  equivalent, so a codex schedule that declares one is refused rather than
   *  launched at whatever effort the CLI happens to default to. */
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  /** false = the session runs in the main checkout (the SDK updater pushes). */
  worktree: z.boolean(),
  session: z.enum(["fresh", "persistent"]),
  /** No default on purpose: the author states the sandbox. */
  permissionMode: z.enum(["bypassPermissions", "dontAsk"]),
  tools: z.array(z.string()).optional(),
  allowedTools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  maxBudgetUsd: z.number().positive().optional(),
});
export type ScheduleWorkstream = z.infer<typeof scheduleWorkstreamSchema>;

export const scheduleYamlSchema = z.strictObject({
  description: z.string().min(1),
  cadence: durationSchema,
  grace: durationSchema.optional(),
  enabled: z.boolean().optional(),
  timeout: durationSchema.optional(),
  workstream: scheduleWorkstreamSchema.optional(),
});
export type ScheduleYaml = z.infer<typeof scheduleYamlSchema>;

/** `local.yaml` is the same schema, every field optional: a laptop disables a
 *  schedule (or shortens its cadence) without a commit. */
const scheduleLocalYamlSchema = scheduleYamlSchema.partial();

const DEFAULT_TIMEOUT_MS = 2 * HOUR_MS;
const GRACE_FRACTION = 0.25;

/** A schedule.yaml with every optional resolved. Defaults live here rather
 *  than in parameter defaults (code-style.md:88). */
export interface ScheduleConfig {
  description: string;
  cadenceMs: number;
  graceMs: number;
  enabled: boolean;
  timeoutMs: number;
  workstream: ScheduleWorkstream | null;
}

export function resolveScheduleConfig(parsed: ScheduleYaml): ScheduleConfig {
  const cadenceMs = parsed.cadence;
  return {
    description: parsed.description,
    cadenceMs,
    graceMs: parsed.grace === undefined ? Math.round(cadenceMs * GRACE_FRACTION) : parsed.grace,
    enabled: parsed.enabled === undefined ? true : parsed.enabled,
    timeoutMs: parsed.timeout === undefined ? DEFAULT_TIMEOUT_MS : parsed.timeout,
    workstream: parsed.workstream === undefined ? null : parsed.workstream,
  };
}

// ─── Loading a directory ──────────────────────────────────────────────────

export interface ScheduleIssue {
  /** Dotted path into the YAML, or the file name for a whole-file problem. */
  path: string;
  message: string;
}

export interface LoadedSchedule {
  kind: "ok";
  name: string;
  dir: string;
  config: ScheduleConfig;
}

export interface InvalidSchedule {
  kind: "invalid";
  name: string;
  dir: string;
  issues: ScheduleIssue[];
}

export type ScheduleEntry = LoadedSchedule | InvalidSchedule;

function zodIssues(file: string, error: z.ZodError): ScheduleIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length === 0 ? file : `${file}: ${issue.path.join(".")}`,
    message: issue.message,
  }));
}

async function readIfPresent(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/** Executable for somebody — launchd runs as the user, so any x bit is the
 *  question worth asking; a `run` with none is the mode mistake that reads as
 *  "command not found" at 03:00. */
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
 * Parse one `schedules/<name>/` directory. Everything that can be wrong is
 * collected — an author fixing a schedule wants the whole list, not the first
 * complaint.
 */
export async function loadSchedule(dir: string): Promise<ScheduleEntry> {
  const name = path.basename(dir);
  const issues: ScheduleIssue[] = [];

  const yamlText = await readIfPresent(path.join(dir, "schedule.yaml"));
  if (yamlText === null) {
    return { kind: "invalid", name, dir, issues: [{ path: "schedule.yaml", message: "missing" }] };
  }

  let base: ScheduleYaml | null = null;
  try {
    const parsed = scheduleYamlSchema.safeParse(YAML.parse(yamlText));
    if (parsed.success) base = parsed.data;
    else issues.push(...zodIssues("schedule.yaml", parsed.error));
  } catch (e) {
    issues.push({ path: "schedule.yaml", message: `unparseable YAML: ${e instanceof Error ? e.message : String(e)}` });
  }

  const localText = await readIfPresent(path.join(dir, "local.yaml"));
  let local: Record<string, unknown> = {};
  if (localText !== null) {
    try {
      const parsed = scheduleLocalYamlSchema.safeParse(YAML.parse(localText));
      if (parsed.success) local = parsed.data;
      else issues.push(...zodIssues("local.yaml", parsed.error));
    } catch (e) {
      issues.push({ path: "local.yaml", message: `unparseable YAML: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  if (!(await isExecutable(path.join(dir, "run")))) {
    issues.push({ path: "run", message: "missing or not executable" });
  }
  if (base?.workstream !== undefined && (await readIfPresent(path.join(dir, "prompt.md"))) === null) {
    issues.push({ path: "prompt.md", message: "required when the schedule has a workstream" });
  }

  if (base === null || issues.length > 0) return { kind: "invalid", name, dir, issues };

  // `local.yaml` is an override, so only the keys it actually declares win.
  const merged: ScheduleYaml = { ...base };
  for (const [key, value] of Object.entries(local)) {
    if (value !== undefined) Object.assign(merged, { [key]: value });
  }
  return { kind: "ok", name, dir, config: resolveScheduleConfig(merged) };
}

/** Every `schedules/<name>/` under `root`, name-sorted. A root that does not
 *  exist is no schedules, not an error: a fresh clone has none. */
export async function loadSchedules(root: string): Promise<ScheduleEntry[]> {
  let names: string[];
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const loaded: ScheduleEntry[] = [];
  for (const name of names) loaded.push(await loadSchedule(path.join(root, name)));
  return loaded;
}

// ─── Store records ────────────────────────────────────────────────────────

export const outcomeSchema = z.enum(["clean", "handoff", "failed"]);
export type Outcome = z.infer<typeof outcomeSchema>;

/** `<store>/<name>/state.json` — the per-schedule due-ness input. */
export const scheduleStateSchema = z.strictObject({
  lastRunAt: z.string().nullable(),
  lastRunId: z.string().nullable(),
  lastExit: z.number().nullable(),
  lastOutcome: outcomeSchema.nullable(),
  /** `session: persistent` keeps one resumed session id here (chunk 5). */
  sessionId: z.string().nullable(),
});
export type ScheduleState = z.infer<typeof scheduleStateSchema>;

export const EMPTY_SCHEDULE_STATE: ScheduleState = {
  lastRunAt: null,
  lastRunId: null,
  lastExit: null,
  lastOutcome: null,
  sessionId: null,
};

/** `<store>/state.json` — the scheduler heartbeat, the anti-silence primitive.
 *  Every tick stamps it FIRST, so "nothing ran" is visible without any job
 *  having to report its own death. */
export const storeStateSchema = z.strictObject({
  lastTickAt: z.string(),
  lastTickExit: z.number().nullable(),
});
export type StoreState = z.infer<typeof storeStateSchema>;

export const prioritySchema = z.enum(["important", "normal", "backlog", "fyi"]);
export type Priority = z.infer<typeof prioritySchema>;

export const alertSchema = z.strictObject({
  id: z.string(),
  workstream: z.string(),
  runId: z.string().nullable(),
  title: z.string().min(1),
  message: z.string(),
  details: z.string().nullable(),
  priority: prioritySchema,
  createdAt: z.string(),
  state: z.enum(["open", "acknowledged"]),
  acknowledgedAt: z.string().nullable(),
});
export type Alert = z.infer<typeof alertSchema>;

/** 256 KB: a handoff is a briefing, not a data transfer. */
export const HANDOFF_BODY_MAX = 256 * 1024;

export const handoffSchema = z.strictObject({
  runId: z.string(),
  title: z.string().min(1),
  body: z.string().max(HANDOFF_BODY_MAX),
  at: z.string(),
});
export type Handoff = z.infer<typeof handoffSchema>;

/** A run with a session and no result is a bailed run — that is what this
 *  record exists to make distinguishable. */
export const resultSchema = z.strictObject({
  runId: z.string(),
  kind: z.enum(["alert", "done"]),
  alertId: z.string().nullable(),
  at: z.string(),
});
export type Result = z.infer<typeof resultSchema>;

export const runExitSchema = z.strictObject({
  runId: z.string(),
  runExit: z.number().nullable(),
  sessionExit: z.number().nullable(),
  checkExit: z.number().nullable(),
  /** Whether an agent session was started at all. It is written BEFORE the
   *  session begins, because it is what tells a later tick — reclaiming a lock
   *  from a runner the laptop killed — whether a missing result record means a
   *  bailed session or simply a run-only schedule. */
  sessionLaunched: z.boolean(),
  timedOut: z.boolean(),
  at: z.string(),
});
export type RunExit = z.infer<typeof runExitSchema>;

// ─── Store location ───────────────────────────────────────────────────────

/** The store's marker file; nothing writes under an unmarked directory. */
export const SCHEDULES_MARKER = ".schedule-runs";

/**
 * Store-beside-checkout, the exhibits/comments convention
 * (`bin/lib/worktree-paths.sh` `WT_SCHEDULES_ROOT`). `mainRoot` is the MAIN
 * checkout — one store behind every worktree, so a scheduled run's history
 * does not evaporate with the worktree that happened to trigger it.
 */
export function schedulesStoreRoot(mainRoot: string): string {
  const override = process.env["CALLBACK_SCHEDULES_ROOT"];
  if (override !== undefined && override !== "") return override;
  return path.join(path.dirname(mainRoot), "schedule-runs");
}

// ─── Ids ──────────────────────────────────────────────────────────────────

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** `<YYYYMMDD-HHMMSS>`, local time — a run id a human reads in a filename. */
export function runIdFor(at: Date): string {
  return [
    `${String(at.getFullYear())}${pad(at.getMonth() + 1, 2)}${pad(at.getDate(), 2)}`,
    `${pad(at.getHours(), 2)}${pad(at.getMinutes(), 2)}${pad(at.getSeconds(), 2)}`,
  ].join("-");
}

/** `<run-id>-<4 hex>`: several alerts can share one second of one run. */
export function alertIdFor(at: Date, suffix: string): string {
  return `${runIdFor(at)}-${suffix}`;
}
