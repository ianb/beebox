/**
 * `bbx chat trigger log`: the trace of this chat's evaluations, newest last.
 * One line per evaluation in words, with the records indented under it; or
 * the raw JSON lines with `--json`.
 */

import { Command } from "commander";
import { readTrace, type TraceLine, type TraceRecord } from "../../../../core/triggers/trace.js";
import { requireBoxRoot } from "../../../../lib/paths/core.js";
import { requireSession, runCli } from "./shared.js";

function clock(at: string): string {
  const d = new Date(at);
  const two = (n: number): string => String(n).padStart(2, "0");
  return Number.isNaN(d.getTime()) ? at : `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

function renderRecord(record: TraceRecord): string {
  switch (record.kind) {
    case "log":
      return `log: ${record.message}`;
    case "judge":
      return `judge ${record.card ?? record.questions.join(", ")} (${String(record.ms)} ms): ${JSON.stringify(record.verdict)}`;
    case "result":
      return `result${record.done === true ? " (done)" : ""}: ${JSON.stringify(record.text)}${record.note === undefined ? "" : `  note: ${JSON.stringify(record.note)}`}`;
    case "none":
      return "no result";
    case "error":
      return `error: ${record.message}`;
  }
}

/** `HH:MM:SS  label  reason  entries=N  outcome [— error] (ms)` then the records indented. */
export function renderTraceLine(line: TraceLine): string {
  const head = [clock(line.at), line.label, line.reason, `entries=${String(line.entries)}`, line.outcome + (line.dryRun === true ? " (dry run)" : "")];
  if (line.error !== undefined) head.push(`— ${line.error}`);
  head.push(`(${String(Math.round(line.ms))} ms)`);
  const records = line.records.map((r) => `    ${renderRecord(r)}`);
  if (line.truncated === true) records.unshift("    (earlier records cut to fit the log line)");
  return [head.join("  "), ...records].join("\n");
}

export const logCommand = new Command("log")
  .description("The trace of this chat's trigger evaluations: what each one was given, logged, asked the judge, and returned")
  .option("--json", "Print the raw JSON lines")
  .option("--since <time>", "Only evaluations at or after this ISO time")
  .option("--all-sessions", "Every chat's evaluations, not only this one's")
  .action((options: { json?: boolean; since?: string; allSessions?: boolean }) => runCli(async () => {
    const boxRoot = await requireBoxRoot();
    const session = options.allSessions === true ? undefined : await requireSession();
    const since = options.since === undefined ? undefined : new Date(options.since);
    const lines = await readTrace(boxRoot, { session, since });
    if (options.json === true) {
      for (const line of lines) console.log(JSON.stringify(line));
      return;
    }
    if (lines.length === 0) {
      console.log("No trigger evaluations recorded.");
      return;
    }
    for (const line of lines) console.log(renderTraceLine(line));
  }));
