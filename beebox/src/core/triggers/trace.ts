/**
 * The trigger trace: `.beebox/triggers.jsonl` plus `.1`, one JSON line per
 * evaluation (or skip, suppression, stale drop, error). It is how the agent
 * answers "why didn't my trigger fire?" (`bbx chat trigger log`). Modeled on
 * the notification log: one `O_APPEND` write per line, rename to rotate,
 * readers read both files. A line that would not fit one atomic append has
 * its records cut, then dropped, so a chatty trigger cannot break the log.
 */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { errnoCode } from "../../shared/error-guards.js";
import { getBoxTime } from "../../lib/time.js";

const LOG_FILE = "triggers.jsonl";
const ROTATED_FILE = "triggers.1.jsonl";
const MAX_LINE_BYTES = 4000;
const ROTATE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const ROTATE_BYTES = 8 * 1024 * 1024;

/** One record the evaluation child streamed: a `ctx.log` call, a judge call with its verdict, the result, or an error. */
export const traceRecordSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("log"), at: z.string(), message: z.string() }),
  z.object({
    kind: z.literal("judge"),
    at: z.string(),
    /** The question names asked, or the judgment card. */
    questions: z.array(z.string()),
    card: z.string().optional(),
    /** `JudgeResult.answers` or the `unavailable` reason. */
    verdict: z.unknown(),
    ms: z.number(),
  }),
  z.object({ kind: z.literal("result"), at: z.string(), text: z.string().optional(), note: z.string().optional(), done: z.boolean().optional(), card: z.string().optional() }),
  z.object({ kind: z.literal("none"), at: z.string() }),
  z.object({ kind: z.literal("error"), at: z.string(), message: z.string() }),
]);
export type TraceRecord = z.infer<typeof traceRecordSchema>;

const TRACE_OUTCOMES = ["none", "fired", "done", "suppressed", "stale", "error", "delivery-failed", "skipped", "expired"] as const;
export type TraceOutcome = (typeof TRACE_OUTCOMES)[number];

const traceLineSchema = z.object({
  at: z.string(),
  session: z.string(),
  activation: z.string(),
  label: z.string(),
  /** What started it: new activity, a tick, or (for an `expired` line) the turn count or the deadline. */
  reason: z.enum(["activity", "tick", "turns", "time"]),
  /** How many new entries the evaluation was given. */
  entries: z.number().int().nonnegative(),
  records: z.array(traceRecordSchema),
  outcome: z.enum(TRACE_OUTCOMES),
  error: z.string().optional(),
  ms: z.number(),
  dryRun: z.boolean().optional(),
  /** Set when `records` were cut to fit the line. */
  truncated: z.boolean().optional(),
});
export type TraceLine = z.infer<typeof traceLineSchema>;

export function traceLogPath(boxRoot: string): string {
  return path.join(boxRoot, ".beebox", LOG_FILE);
}

function rotatedPath(boxRoot: string): string {
  return path.join(boxRoot, ".beebox", ROTATED_FILE);
}

/** Thrown when a line would not fit one atomic append even with its records emptied. */
class TraceLineTooLongError extends Error {
  readonly bytes: number;
  constructor(bytes: number) {
    super("A trigger trace line does not fit one atomic append even with its records emptied");
    this.name = "TraceLineTooLongError";
    this.bytes = bytes;
  }
}

/** Serialize under the line cap: keep the newest records that fit (one pass from the end), marking `truncated`. */
export function serializeTraceLine(line: TraceLine): string {
  let current = line;
  let text = JSON.stringify(current);
  if (Buffer.byteLength(text) >= MAX_LINE_BYTES && current.records.length > 0) {
    const base = Buffer.byteLength(JSON.stringify({ ...current, records: [], truncated: true }));
    let budget = MAX_LINE_BYTES - 1 - base;
    const kept: TraceRecord[] = [];
    for (const record of current.records.toReversed()) {
      const size = Buffer.byteLength(JSON.stringify(record)) + 1;
      if (size > budget) break;
      budget -= size;
      kept.unshift(record);
    }
    current = { ...current, records: kept, truncated: true };
    text = JSON.stringify(current);
  }
  if (Buffer.byteLength(text) >= MAX_LINE_BYTES && current.error !== undefined) {
    current = { ...current, error: current.error.slice(0, 500), truncated: true };
    text = JSON.stringify(current);
  }
  const bytes = Buffer.byteLength(text);
  if (bytes >= MAX_LINE_BYTES) throw new TraceLineTooLongError(bytes);
  return `${text}\n`;
}

/** Append one line. Rotates first when due. Never throws on a write failure: a trace must not fail an evaluation. */
export async function appendTrace(boxRoot: string, line: TraceLine): Promise<void> {
  const logPath = traceLogPath(boxRoot);
  try {
    const text = serializeTraceLine(line);
    await rotateIfNeeded(boxRoot, { now: getBoxTime(boxRoot) });
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const fd = fs.openSync(logPath, "a");
    try {
      fs.writeSync(fd, text);
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    console.warn(`[triggers] could not append to ${logPath}:`, e);
  }
}

async function readLines(filePath: string): Promise<TraceLine[]> {
  let raw: string;
  try {
    raw = await fsp.readFile(filePath, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return [];
    throw e;
  }
  const lines: TraceLine[] = [];
  for (const text of raw.split("\n")) {
    if (text.trim() === "") continue;
    try {
      const parsed = traceLineSchema.safeParse(JSON.parse(text));
      if (parsed.success) lines.push(parsed.data);
      else console.warn(`[triggers] skipping an invalid trace line in ${filePath}: ${parsed.error.message}`);
    } catch (e) {
      console.warn(`[triggers] skipping an unparseable trace line in ${filePath}:`, e);
    }
  }
  return lines;
}

/** Both files, oldest first, optionally one session's and only lines at or after `since`. */
export async function readTrace(boxRoot: string, opts?: { session?: string | undefined; since?: Date | undefined }): Promise<TraceLine[]> {
  const all = [...(await readLines(rotatedPath(boxRoot))), ...(await readLines(traceLogPath(boxRoot)))];
  const sinceMs = opts?.since?.getTime();
  return all.filter((line) =>
    (opts?.session === undefined || line.session === opts.session)
    && (sinceMs === undefined || Date.parse(line.at) >= sinceMs));
}

async function firstLineAt(filePath: string): Promise<number | null> {
  const handle = await fsp.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(MAX_LINE_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, MAX_LINE_BYTES, 0);
    const first = buffer.subarray(0, bytesRead).toString("utf-8").split("\n")[0] ?? "";
    const parsed = traceLineSchema.safeParse(JSON.parse(first));
    return parsed.success ? Date.parse(parsed.data.at) : null;
  } catch (e) {
    console.warn(`[triggers] could not read the first line of ${filePath}:`, e);
    return null;
  } finally {
    await handle.close();
  }
}

/** Rename to `.1` when the first line is over 30 days old or the file exceeds 8 MB. */
export async function rotateIfNeeded(boxRoot: string, opts: { now: Date }): Promise<boolean> {
  const logPath = traceLogPath(boxRoot);
  let size: number;
  try {
    size = (await fsp.stat(logPath)).size;
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return false;
    throw e;
  }
  if (size === 0) return false;
  const firstAt = size > ROTATE_BYTES ? null : await firstLineAt(logPath);
  const tooOld = firstAt !== null && opts.now.getTime() - firstAt > ROTATE_AGE_MS;
  if (size <= ROTATE_BYTES && !tooOld) return false;
  await fsp.rename(logPath, rotatedPath(boxRoot));
  return true;
}
