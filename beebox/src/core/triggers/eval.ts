/**
 * The parent half of a trigger evaluation: spawn `bbx chat trigger eval-one`
 * with the job on stdin, keep every trace record as it arrives, and kill the
 * child at the deadline. Each child is a fresh process and compiles the
 * trigger file cold; the cost is a node start plus an esbuild bundle per
 * evaluation (measured in the plan, Track B).
 *
 * Every stderr line and any stdout line that is not a record become `log`
 * records, so nothing a trigger printed is lost and one stray line cannot
 * hide a later judge or result record.
 */

import { spawn } from "node:child_process";
import * as path from "node:path";
import { PACKAGE_ROOT } from "../../lib/package-root.js";
import { getBoxTime } from "../../lib/time.js";
import { errorMessage } from "../../shared/error-guards.js";
import { agentAllowlistEnv } from "../script-env/core.js";
import { inspectResultSchema, type EvalJob, type InspectJob, type InspectResult } from "./eval-child/core.js";
import { traceRecordSchema, type TraceRecord } from "./trace.js";

/** How long one evaluation may run before the child is killed. */
const EVAL_DEADLINE_MS = 20_000;
/** The most output (stdout plus stderr) a child may write before it is killed; a logging loop stops here, not at the deadline. */
const OUTPUT_CAP_BYTES = 1024 * 1024;

export interface EvalOutput {
  /** Every record the child wrote, in order, plus `log` records for its stray output. */
  records: TraceRecord[];
  /** The final record, or an `error` the parent wrote when the child left none. */
  final: TraceRecord;
  ms: number;
}

/** A function that runs one evaluation; the real one spawns a child, tests inject their own. */
export type Evaluate = (job: EvalJob) => Promise<EvalOutput>;

interface ChildRun {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdoutLines: string[];
  stderr: string;
  /** The child wrote more than {@link OUTPUT_CAP_BYTES} and was killed. */
  overflow: boolean;
}

function runChild(args: string[], opts: { stdin: string; cwd: string; timeoutMs: number }): Promise<ChildRun> {
  return new Promise((resolve) => {
    const proc = spawn(path.join(PACKAGE_ROOT, "bin", "bbx"), args, {
      cwd: opts.cwd,
      env: agentAllowlistEnv(),
      stdio: ["pipe", "pipe", "pipe"],
      timeout: opts.timeoutMs,
      killSignal: "SIGKILL",
    });
    const stdoutLines: string[] = [];
    let partial = "";
    let stderr = "";
    let bytes = 0;
    let overflow = false;
    const count = (chunk: Buffer): boolean => {
      bytes += chunk.length;
      if (bytes <= OUTPUT_CAP_BYTES || overflow) return !overflow;
      overflow = true;
      proc.kill("SIGKILL");
      return false;
    };
    proc.stdout.on("data", (chunk: Buffer) => {
      if (!count(chunk)) return;
      partial += chunk.toString();
      const lines = partial.split("\n");
      partial = lines.pop() ?? "";
      stdoutLines.push(...lines);
    });
    proc.stderr.on("data", (chunk: Buffer) => { if (count(chunk)) stderr += chunk.toString(); });
    proc.on("error", (e) => { stderr += e.message; });
    proc.on("close", (code, signal) => {
      if (partial !== "") stdoutLines.push(partial);
      resolve({ code, signal, stdoutLines, stderr, overflow });
    });
    proc.stdin.on("error", () => { /* the child exited before reading the job; `close` reports it */ });
    proc.stdin.end(opts.stdin);
  });
}

function parseRecords(run: ChildRun, at: string): TraceRecord[] {
  const records: TraceRecord[] = [];
  for (const line of run.stdoutLines) {
    if (line.trim() === "") continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch (_e) {
      records.push({ kind: "log", at, message: `stdout: ${line}` });
      continue;
    }
    const parsed = traceRecordSchema.safeParse(json);
    records.push(parsed.success ? parsed.data : { kind: "log", at, message: `stdout: ${line}` });
  }
  for (const line of run.stderr.split("\n")) {
    if (line.trim() !== "") records.push({ kind: "log", at, message: `stderr: ${line}` });
  }
  return records;
}

function isFinal(record: TraceRecord): boolean {
  return record.kind === "result" || record.kind === "none" || record.kind === "error";
}

/** Run one evaluation in a child. Never throws. */
export async function evaluateInChild(job: EvalJob, opts?: { timeoutMs?: number }): Promise<EvalOutput> {
  const started = Date.now();
  const timeoutMs = opts?.timeoutMs ?? EVAL_DEADLINE_MS;
  let run: ChildRun;
  try {
    run = await runChild(["chat", "trigger", "eval-one"], { stdin: JSON.stringify(job), cwd: job.boxRoot, timeoutMs });
  } catch (e) {
    const at = getBoxTime(job.boxRoot).toISOString();
    const final: TraceRecord = { kind: "error", at, message: `could not start the evaluation: ${errorMessage(e)}` };
    return { records: [final], final, ms: Date.now() - started };
  }
  const at = getBoxTime(job.boxRoot).toISOString();
  const records = parseRecords(run, at);
  const last = records.findLast(isFinal);
  if (last !== undefined) return { records, final: last, ms: Date.now() - started };
  const message = run.overflow
    ? `stopped: trigger() wrote more than ${String(OUTPUT_CAP_BYTES / 1024)} KB of logs (a logging loop?)`
    : run.signal === "SIGKILL" && run.code === null
      ? `stopped after ${String(timeoutMs / 1000)} s: trigger() never returned (an endless loop, or an await that never settles?)`
      : `eval-one exited ${String(run.code ?? run.signal)} without a result`;
  const final: TraceRecord = { kind: "error", at, message };
  return { records: [...records, final], final, ms: Date.now() - started };
}

/** Import the trigger file in a child and return its label for `config` and its tick, or an error. Never throws. */
export async function inspectTrigger(job: InspectJob, opts?: { timeoutMs?: number }): Promise<InspectResult> {
  const timeoutMs = opts?.timeoutMs ?? EVAL_DEADLINE_MS;
  const run = await runChild(["chat", "trigger", "eval-one", "--inspect"], { stdin: JSON.stringify(job), cwd: job.boxRoot, timeoutMs });
  const last = run.stdoutLines.findLast((line) => line.trim() !== "");
  if (last !== undefined) {
    try {
      const parsed = inspectResultSchema.safeParse(JSON.parse(last));
      if (parsed.success) return parsed.data;
    } catch (_e) {
      // fall through to the exit report
    }
  }
  if (run.signal === "SIGKILL" && run.code === null) return { error: `stopped after ${String(timeoutMs / 1000)} s: importing ${job.file} never finished` };
  return { error: `eval-one --inspect exited ${String(run.code ?? run.signal)} without a result${run.stderr.trim() === "" ? "" : `: ${run.stderr.trim()}`}` };
}
