import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  parseScheduledScript,
  isWithinBudget,
  ScheduledScriptSchema,
} from "../../../schemas/scheduled-script.js";
import { cardFields, parseCardText } from "../../../core/card-io.js";
import { createCardSchemaMap } from "../../../schemas/registry.js";
import { checkMissingConnectors } from "../../../connectors/requirements.js";
import {
  loadScriptState,
  loadRunningScripts,
} from "../../../core/schedule/state.js";
import { describeCadence } from "../../../core/schedule/describe.js";

export interface ScheduleEntry {
  name: string;
  description: string | undefined;
  /** Raw schedule expression, e.g. "cron 0 4 * * *" — for editing/debugging. */
  schedule: string;
  /** Human-readable cadence sentence, e.g. "At 4:00 AM, at most once every 20 hours". */
  cadence: string;
  scheduleType: "cron" | "at" | "rrule" | "wakeup-only";
  enabled: boolean;
  onWakeup: boolean;
  notBefore: string | undefined;
  until: string | undefined;
  runs: string;
  lastRun: string | null;
  lastResult: "success" | "failure" | "deferred" | null;
  lastError: string | null;
  runCount: number;
  once: boolean;
  budget?: { limitMs: number; windowMs: number; usedMs: number } | undefined;
  running?: { startedAt: string; triggeredBy: string } | undefined;
  missingRequirements?: string[] | undefined;
}

/** Entry returned when a schedule card fails to parse — surfaced rather than hidden. */
function parseErrorEntry(scriptName: string): ScheduleEntry {
  return {
    name: scriptName,
    description: undefined,
    schedule: "parse error",
    cadence: "parse error",
    scheduleType: "wakeup-only",
    enabled: false,
    onWakeup: false,
    notBefore: undefined,
    until: undefined,
    runs: "",
    lastRun: null,
    lastResult: null,
    lastError: null,
    runCount: 0,
    once: false,
    budget: undefined,
    running: undefined,
  };
}

/** Human-readable schedule string plus its discriminating type. */
function describeSchedule(parsed: ReturnType<typeof parseScheduledScript>): {
  schedule: string;
  scheduleType: ScheduleEntry["scheduleType"];
} {
  if (parsed.cron) {
    return { schedule: `cron ${parsed.cron}`, scheduleType: "cron" };
  }
  if (parsed.at) {
    return { schedule: `at ${parsed.at}`, scheduleType: "at" };
  }
  if (parsed.rrule) {
    return { schedule: `rrule ${parsed.rrule.substring(0, 60)}`, scheduleType: "rrule" };
  }
  return { schedule: "on-wakeup only", scheduleType: "wakeup-only" };
}

interface BuildEntryOptions {
  boxRoot: string;
  scriptName: string;
  parsed: ReturnType<typeof parseScheduledScript>;
  running: Awaited<ReturnType<typeof loadRunningScripts>>;
  now: Date;
}

/** Assemble a fully-resolved schedule entry from a parsed card and its persisted state. */
async function buildScheduleEntry(options: BuildEntryOptions): Promise<ScheduleEntry> {
  const { boxRoot, scriptName, parsed, running, now } = options;
  const state = await loadScriptState(boxRoot, scriptName);
  const { schedule, scheduleType } = describeSchedule(parsed);

  let budgetInfo: { limitMs: number; windowMs: number; usedMs: number } | undefined;
  if (parsed.budget) {
    const check = isWithinBudget(parsed.budget, { recentRuns: state.recentRuns, now });
    budgetInfo = { limitMs: parsed.budget.limitMs, windowMs: parsed.budget.windowMs, usedMs: check.usedMs };
  }

  const lock = running.get(scriptName);

  const missingReqs = parsed.requires
    ? await checkMissingConnectors(boxRoot, parsed.requires)
    : undefined;

  return {
    name: scriptName,
    description: parsed.description,
    schedule,
    cadence: describeCadence(parsed),
    scheduleType,
    enabled: parsed.enabled,
    onWakeup: parsed.onWakeup,
    notBefore: parsed.notBefore,
    until: parsed.until,
    runs: parsed.runs,
    lastRun: state.lastRun,
    lastResult: state.lastResult,
    lastError: state.lastError,
    runCount: state.runCount,
    once: parsed.once,
    budget: budgetInfo,
    running: lock ? { startedAt: lock.startedAt, triggeredBy: lock.triggeredBy } : undefined,
    missingRequirements: missingReqs && missingReqs.length > 0 ? missingReqs : undefined,
  };
}

/** List all schedule cards in a box, parsing each into a resolved entry. */
export async function listSchedules(boxRoot: string): Promise<ScheduleEntry[]> {
  const schedulesDir = path.join(boxRoot, "config/schedules");

  let files: string[];
  try {
    files = (await fs.readdir(schedulesDir)).filter((f) =>
      f.endsWith(".scheduled-script.card")
    );
  } catch (_e) {
    // No schedules directory means there are no schedules to list.
    return [];
  }

  const schedules: ScheduleEntry[] = [];
  const now = new Date();
  const running = await loadRunningScripts(boxRoot);

  for (const file of files) {
    const scriptName = file.replace(".scheduled-script.card", "");
    const cardPath = path.join(schedulesDir, file);

    let parsed;
    try {
      const content = await fs.readFile(cardPath, "utf-8");
      const card = parseCardText(content, { source: file, schemas: await createCardSchemaMap(boxRoot) });
      parsed = parseScheduledScript(cardFields(card, ScheduledScriptSchema));
    } catch (e) {
      console.warn(`Failed to parse schedule "${scriptName}", listing as parse error:`, e);
      schedules.push(parseErrorEntry(scriptName));
      continue;
    }

    schedules.push(await buildScheduleEntry({ boxRoot, scriptName, parsed, running, now }));
  }

  return schedules;
}
