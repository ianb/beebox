/**
 * Scheduler log routes — serves JSONL scheduler logs for the current box.
 */

import type { FastifyInstance } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";
import { createReadStream } from "node:fs";
import { boxLogFile, type LogEntry } from "../../core/scheduler.js";
import { parseXml } from "cardworks";
import {
  parseScheduledScript,
  isWithinBudget,
  type ScheduledScript,
} from "../../schemas/scheduled-script.js";
import { loadScriptState } from "../../core/schedule-state.js";

export async function registerSchedulerRoutes(
  server: FastifyInstance,
  boxRoot: string,
): Promise<void> {
  /**
   * GET /api/scheduler/log?limit=100&event=tick&status=ran
   *
   * Returns scheduler log entries for the current box.
   * - limit: max entries to return (default 100, newest first)
   * - event: filter by event type (e.g. "tick")
   * - status: filter ticks that have scripts with this status ("ran" or "error")
   */
  server.get<{
    Querystring: { limit?: string; event?: string; status?: string };
  }>("/api/scheduler/log", async (request) => {
    const limit = parseInt(request.query.limit ?? "100", 10);
    const eventFilter = request.query.event;
    const statusFilter = request.query.status;

    const logPath = boxLogFile(boxRoot);

    try {
      await fs.access(logPath);
    } catch {
      return { entries: [] };
    }

    let entries: LogEntry[] = [];

    // Read JSONL and filter
    const rl = readline.createInterface({
      input: createReadStream(logPath),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as LogEntry;

        // Event filter
        if (eventFilter && entry.event !== eventFilter) continue;

        // Status filter — only include ticks where at least one script matches
        if (statusFilter && entry.result) {
          const hasMatch = entry.result.scripts.some(
            (s) => s.status === statusFilter,
          );
          if (!hasMatch) continue;
        }

        entries.push(entry);
      } catch {
        // Skip malformed lines
      }
    }

    // Newest first, limited
    entries.reverse();
    if (entries.length > limit) {
      entries = entries.slice(0, limit);
    }

    return { entries };
  });

  /**
   * GET /api/schedules
   *
   * Returns all scheduled scripts with their config + run state.
   */
  server.get("/api/schedules", async () => {
    const schedulesDir = path.join(boxRoot, "config/schedules");

    let files: string[];
    try {
      files = (await fs.readdir(schedulesDir)).filter((f) =>
        f.endsWith(".scheduled-script.card"),
      );
    } catch {
      return { schedules: [] };
    }

    const schedules = [];
    const now = new Date();

    for (const file of files) {
      const scriptName = file.replace(".scheduled-script.card", "");
      const cardPath = path.join(schedulesDir, file);

      let parsed;
      try {
        const content = await fs.readFile(cardPath, "utf-8");
        const root = await parseXml(content, file);
        parsed = parseScheduledScript(root as ScheduledScript);
      } catch {
        schedules.push({
          name: scriptName,
          description: undefined,
          schedule: "parse error",
          scheduleType: "wakeup-only" as const,
          enabled: false,
          onWakeup: false,
          notBefore: undefined,
          runs: "",
          lastRun: null,
          lastResult: null,
          lastError: null,
          runCount: 0,
          once: false,
          budget: undefined as { limitMs: number; windowMs: number; usedMs: number } | undefined,
        });
        continue;
      }

      const state = await loadScriptState(boxRoot, scriptName);

      let schedule: string;
      let scheduleType: "cron" | "at" | "rrule" | "wakeup-only";
      if (parsed.cron) {
        schedule = `cron ${parsed.cron}`;
        scheduleType = "cron";
      } else if (parsed.at) {
        schedule = `at ${parsed.at}`;
        scheduleType = "at";
      } else if (parsed.rrule) {
        schedule = `rrule ${parsed.rrule.substring(0, 60)}`;
        scheduleType = "rrule";
      } else {
        schedule = "on-wakeup only";
        scheduleType = "wakeup-only";
      }

      let budgetInfo: { limitMs: number; windowMs: number; usedMs: number } | undefined;
      if (parsed.budget) {
        const check = isWithinBudget(parsed.budget, { recentRuns: state.recentRuns, now });
        budgetInfo = { limitMs: parsed.budget.limitMs, windowMs: parsed.budget.windowMs, usedMs: check.usedMs };
      }

      schedules.push({
        name: scriptName,
        description: parsed.description,
        schedule,
        scheduleType,
        enabled: parsed.enabled,
        onWakeup: parsed.onWakeup,
        notBefore: parsed.notBefore,
        runs: parsed.runs,
        lastRun: state.lastRun,
        lastResult: state.lastResult,
        lastError: state.lastError,
        runCount: state.runCount,
        once: parsed.once,
        budget: budgetInfo,
      });
    }

    return { schedules };
  });
}
