/**
 * Run summaries: what a scheduled run says about itself, and the short run
 * history the dashboard shows. The task writes its own summary (a headline,
 * a short Markdown body, optional notes, and a priority) to
 * `BBX_SUMMARY_FILE`, usually through `bbx run-summary`; the runner reads it
 * after the run and appends one history entry per run. The history is
 * machine-local UI state next to the schedule's timing state, never
 * committed, and keeps the last {@link RUN_HISTORY_LIMIT} runs.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { errnoCode, errorMessage } from "../../shared/error-guards.js";
import { MEMORY_ENV, truncateUtf8 } from "./memory.js";
import { stateDir, type ScriptState } from "./state.js";
import { DEFER_REASONS } from "./defer-reason.js";

/** `normal`: the run went as usual. `attention`: the boxholder should look at it. */
export const RUN_PRIORITIES = ["normal", "attention"] as const;
export type RunPriority = (typeof RUN_PRIORITIES)[number];

const HEADLINE_MAX_CHARS = 120;
const BODY_MAX_BYTES = 1024;
const NOTES_MAX_BYTES = 4096;
/** Runs kept per schedule; older entries drop off. */
export const RUN_HISTORY_LIMIT = 20;

const RunSummarySchema = z.object({
  headline: z.string().min(1),
  body: z.string().optional(),
  notes: z.string().optional(),
  priority: z.enum(RUN_PRIORITIES),
});
export type RunSummary = z.infer<typeof RunSummarySchema>;

class EmptyHeadlineError extends Error {
  constructor() {
    super("a run summary needs a non-empty headline");
    this.name = "EmptyHeadlineError";
  }
}

/** The summary cut to its limits, and which fields were cut. */
export function normalizeRunSummary(input: RunSummary): { summary: RunSummary; cut: string[] } {
  const cut: string[] = [];
  let headline = input.headline.replace(/\s+/g, " ").trim();
  if (headline === "") throw new EmptyHeadlineError();
  if (headline.length > HEADLINE_MAX_CHARS) {
    headline = `${headline.slice(0, HEADLINE_MAX_CHARS - 1)}…`;
    cut.push(`headline (over ${String(HEADLINE_MAX_CHARS)} characters)`);
  }
  const summary: RunSummary = { headline, priority: input.priority };
  const fields = [
    ["body", input.body, BODY_MAX_BYTES],
    ["notes", input.notes, NOTES_MAX_BYTES],
  ] as const;
  for (const [name, value, maxBytes] of fields) {
    const text = value?.trim() ?? "";
    if (text === "") continue;
    const kept = truncateUtf8(text, maxBytes);
    if (kept !== text) cut.push(`${name} (over ${String(maxBytes)} bytes)`);
    summary[name] = kept;
  }
  return { summary, cut };
}

/** Write a run's summary, replacing any earlier one from the same run. Returns the fields cut to fit. */
export async function writeRunSummary(filePath: string, input: RunSummary): Promise<string[]> {
  const { summary, cut } = normalizeRunSummary(input);
  await fs.writeFile(filePath, `${JSON.stringify(summary)}\n`);
  return cut;
}

/** The summary a run wrote, or null when it wrote none (or an unreadable one, with a warning). */
export async function readRunSummary(filePath: string): Promise<RunSummary | null> {
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
  try {
    const parsed = RunSummarySchema.safeParse(JSON.parse(text));
    if (parsed.success) return normalizeRunSummary(parsed.data).summary;
    console.warn(`  Ignoring a run summary that does not match the shape: ${parsed.error.message}`);
  } catch (e) {
    console.warn(`  Ignoring an unreadable run summary: ${errorMessage(e)}`);
  }
  return null;
}

// --- Run history ---

const RunHistoryEntrySchema = z.object({
  ts: z.string(),
  result: z.enum(["success", "failure", "deferred", "inconclusive"]),
  durationMs: z.number(),
  triggeredBy: z.string(),
  error: z.string().optional(),
  /** Why a `deferred` run stopped, from its defer marker (`no-change`: nothing to do). */
  deferReason: z.enum(DEFER_REASONS).optional(),
  summary: RunSummarySchema.optional(),
});
export type RunHistoryEntry = z.infer<typeof RunHistoryEntrySchema>;

/** Build the entry for a recorded run from the state `recordOutcome` just wrote. */
export function historyEntry(
  state: ScriptState,
  opts: { triggeredBy: string; summary: RunSummary | null },
): RunHistoryEntry {
  if (state.lastRun === null || state.lastResult === null || state.lastDurationMs === null) {
    throw new RunNotRecordedError();
  }
  return {
    ts: state.lastRun,
    result: state.lastResult,
    durationMs: state.lastDurationMs,
    triggeredBy: opts.triggeredBy,
    ...(state.lastError === null ? {} : { error: state.lastError }),
    ...(state.lastDeferReason === null ? {} : { deferReason: state.lastDeferReason }),
    ...(opts.summary === null ? {} : { summary: opts.summary }),
  };
}

class RunNotRecordedError extends Error {
  constructor() {
    super("a run history entry needs a recorded outcome; call recordOutcome first");
    this.name = "RunNotRecordedError";
  }
}

function historyFile(boxRoot: string, scriptName: string): string {
  return path.join(stateDir(boxRoot), `${scriptName}.runs.jsonl`);
}

/** A schedule's recent runs, oldest first. Malformed lines are skipped with a warning. */
export async function loadRunHistory(boxRoot: string, scriptName: string): Promise<RunHistoryEntry[]> {
  let text: string;
  try {
    text = await fs.readFile(historyFile(boxRoot, scriptName), "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return [];
    throw e;
  }
  const entries: RunHistoryEntry[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = RunHistoryEntrySchema.safeParse(JSON.parse(line));
      if (parsed.success) entries.push(parsed.data);
      else console.warn(`Skipping a malformed run history line for "${scriptName}": ${parsed.error.message}`);
    } catch (e) {
      console.warn(`Skipping an unreadable run history line for "${scriptName}": ${errorMessage(e)}`);
    }
  }
  return entries;
}

/**
 * Append a run and drop all but the last {@link RUN_HISTORY_LIMIT}. An entry
 * with the same time as the last one is the same run re-recorded (the tick
 * records a failure when post-success housekeeping throws), so it replaces
 * that entry and keeps the summary the run wrote. The schedule's script lock
 * serializes runs of one schedule, so a plain rewrite does not race another
 * writer.
 */
export async function appendRunHistory(
  boxRoot: string,
  { scriptName, entry }: { scriptName: string; entry: RunHistoryEntry },
): Promise<void> {
  const history = await loadRunHistory(boxRoot, scriptName);
  const last = history.at(-1);
  if (last?.ts === entry.ts) {
    history.pop();
    if (entry.summary === undefined && last.summary !== undefined) entry = { ...entry, summary: last.summary };
  }
  const kept = [...history, entry].slice(-RUN_HISTORY_LIMIT);
  await fs.mkdir(stateDir(boxRoot), { recursive: true });
  const file = historyFile(boxRoot, scriptName);
  const tmp = `${file}.${String(process.pid)}.tmp`;
  await fs.writeFile(tmp, kept.map((e) => JSON.stringify(e)).join("\n") + "\n");
  await fs.rename(tmp, file);
}

/**
 * Hand a summary to the scheduled run this process belongs to, through
 * `BBX_SUMMARY_FILE`. Returns the fields cut to fit, or null when no
 * scheduled run is listening (the variable is unset).
 */
export async function reportRunSummary(env: NodeJS.ProcessEnv, summary: RunSummary): Promise<string[] | null> {
  const file = env[MEMORY_ENV.summaryFile];
  if (file === undefined || file === "") return null;
  return writeRunSummary(file, summary);
}
