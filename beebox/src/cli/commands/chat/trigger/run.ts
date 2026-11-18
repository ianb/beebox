/**
 * `bbx chat trigger run`: a dry run. Evaluate a trigger file through the same
 * child the server uses, against this chat's live activity or a replayed
 * JSONL file, deliver nothing, and print the trace. The way to find out why
 * a trigger did not fire without a person in front of a figure.
 */

import * as fs from "node:fs/promises";
import { Command } from "commander";
import { readCursor, entriesForSession } from "../../../../core/activity/cursor.js";
import { activityLineSchema, type ActivityLine } from "../../../../core/activity/entry.js";
import { readActivity } from "../../../../core/activity/log.js";
import { evaluateInChild } from "../../../../core/triggers/eval.js";
import type { EvalJob } from "../../../../core/triggers/eval-child/core.js";
import { appendTrace, type TraceLine } from "../../../../core/triggers/trace.js";
import { HISTORY_CAP } from "../../../../core/triggers/types.js";
import { getBoxTime } from "../../../../lib/time.js";
import { requireBoxRoot } from "../../../../lib/paths/core.js";
import { renderTraceLine } from "./log.js";
import { parseConfig, requireSession, runCli, TriggerUsageError } from "./shared.js";

/** Lines from a JSONL file of `ActivityLine`s (what `bbx chat activity --json` prints). */
async function readActivityFile(file: string): Promise<ActivityLine[]> {
  const text = await fs.readFile(file, "utf-8");
  const lines: ActivityLine[] = [];
  for (const [index, raw] of text.split("\n").entries()) {
    if (raw.trim() === "") continue;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (_e) {
      throw new TriggerUsageError({ detail: `${file}:${String(index + 1)} is not JSON` });
    }
    const parsed = activityLineSchema.safeParse(json);
    if (!parsed.success) throw new TriggerUsageError({ detail: `${file}:${String(index + 1)} is not an activity line: ${parsed.error.message}` });
    lines.push(parsed.data);
  }
  return lines.toSorted((a, b) => a.seq - b.seq);
}

interface RunOptions {
  config?: string;
  since?: string;
  all?: boolean;
  reason?: string;
  activity?: string;
  json?: boolean;
}

export const runCommand = new Command("run")
  .description("Dry-run a trigger file against this chat's activity (or a replayed JSONL file): evaluates, delivers nothing, prints the trace")
  .argument("<file>", "The trigger file, box-relative")
  .option("--config <json>", "The config to pass (default null)")
  .option("--since <seq>", "Treat entries above this seq as new; the rest are history (default: everything is new)")
  .option("--all", "Same as --since 0")
  .option("--reason <reason>", "activity (default) or tick")
  .option("--activity <file>", "Replay this JSONL file of activity lines instead of the chat's live log")
  .option("--json", "Print the trace line as JSON")
  .action((file: string, options: RunOptions) => runCli(async () => {
    const boxRoot = await requireBoxRoot();
    const config = parseConfig(options.config);
    const reason = options.reason ?? "activity";
    if (reason !== "activity" && reason !== "tick") throw new TriggerUsageError({ detail: "--reason is activity or tick" });
    const since = options.since === undefined ? 0 : Number(options.since);
    if (!Number.isSafeInteger(since) || since < 0) throw new TriggerUsageError({ detail: "--since takes a whole number" });
    let lines: ActivityLine[];
    let sessionId: string;
    if (options.activity !== undefined) {
      lines = await readActivityFile(options.activity);
      sessionId = (await requireSessionOrNull()) ?? "replay";
    } else {
      sessionId = await requireSession();
      lines = entriesForSession(await readActivity(boxRoot), { sessionId, cursor: await readCursor(boxRoot, sessionId) });
    }
    const history = lines.slice(-HISTORY_CAP);
    const entries = lines.filter((l) => l.seq > since);
    const now = getBoxTime(boxRoot);
    const latest = lines.at(-1);
    const job: EvalJob = {
      boxRoot,
      file,
      config,
      reason,
      entries,
      history,
      sinceLastActivityMs: latest === undefined ? null : Math.max(0, now.getTime() - Date.parse(latest.at)),
      fires: 0,
      lastFireAt: null,
      armedAt: (lines.at(0)?.at ?? now.toISOString()),
      dryRun: true,
    };
    const output = await evaluateInChild(job);
    const line: TraceLine = {
      at: now.toISOString(),
      session: sessionId,
      activation: "dry-run",
      label: file,
      reason,
      entries: entries.length,
      records: output.records,
      outcome: output.final.kind === "result" ? "fired" : output.final.kind === "none" ? "none" : "error",
      ...(output.final.kind === "error" ? { error: output.final.message } : {}),
      ms: output.ms,
      dryRun: true,
    };
    await appendTrace(boxRoot, line);
    console.log(options.json === true ? JSON.stringify(line) : renderTraceLine(line));
    if (output.final.kind === "error") process.exitCode = 1;
  }));

async function requireSessionOrNull(): Promise<string | null> {
  try {
    return await requireSession();
  } catch (_e) {
    return null;
  }
}
