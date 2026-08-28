/**
 * The reporting verbs — `handoff`, `alert`, `done`, `alerts`, `ack`.
 *
 * Split out of `bin/schedules.ts` as a pure move. These are what a schedule's
 * `run` script and the agent session it starts call to leave a durable record;
 * `alerts` is the read side the workstream browser goes through.
 */

import {
  HANDOFF_BODY_MAX,
  prioritySchema,
  type Priority,
} from "./schedules.js";
import {
  ensureScheduleDir,
  ensureStoreRoot,
  readAlerts,
  readAllAlerts,
  visibleAlerts,
  writeAlert,
  writeHandoff,
  writeResult,
} from "./schedules-store.js";
import { raiseAlert } from "./schedules-alerts.js";
import { DRY_RUN_HANDOFF_MARKER } from "./schedules-runner.js";
import { envOr, flags, isDryRun, readValue, runnerDeps, type Context } from "./schedules-cli-context.js";

/** `--priority` must name one of the four levels. */
class UnknownPriorityError extends Error {
  constructor(readonly raw: string) {
    super(`--priority must be important|normal|backlog|fyi, got '${raw}'`);
    this.name = "UnknownPriorityError";
  }
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

export async function commandHandoff(context: Context, args: string[]): Promise<number> {
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
  if (!parsed.success) throw new UnknownPriorityError(raw);
  return parsed.data;
}

export async function commandAlert(context: Context, args: string[]): Promise<number> {
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

export async function commandDone(context: Context, args: string[]): Promise<number> {
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

/**
 * Read-only alert listing. The workstream browser reads the store through this
 * rather than opening it itself: the CLI is the only thing that knows the
 * store's layout, and the app is downstream of `bin/` everywhere else too.
 */
export async function commandAlerts(context: Context, args: string[]): Promise<number> {
  if (!args.includes("--json")) {
    process.stderr.write("schedules alerts: --json is required (the human view is `list`)\n");
    return 2;
  }
  const workstream = flags(args).get("workstream");
  const all = workstream === undefined || workstream === ""
    ? await readAllAlerts(context.storeRoot)
    : await readAlerts(context.storeRoot, workstream);
  const alerts = visibleAlerts(all, Date.now())
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
  process.stdout.write(`${JSON.stringify({ alerts })}\n`);
  return 0;
}

export async function commandAck(context: Context, args: string[]): Promise<number> {
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
