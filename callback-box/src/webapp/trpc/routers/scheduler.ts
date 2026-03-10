import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";
import { createReadStream } from "node:fs";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc.js";
import { boxLogFile } from "../../../core/scheduler.js";
import { parseXml } from "cardworks";
import {
  parseScheduledScript,
  isWithinBudget,
  checkMissingConnectors,
  type ScheduledScript,
} from "../../../schemas/scheduled-script.js";
import { loadScriptState, loadRunningScripts } from "../../../core/schedule-state.js";
import { createLoader } from "../../../cli/lib/loader.js";
import { stageFiles, commit } from "../../../cli/lib/git.js";

/** Clean log entry type without index signature for tRPC serialization */
export interface SchedulerLogEntry {
  ts: string;
  event: string;
  box?: string | undefined;
  result?: {
    ran: number;
    skipped: number;
    errors: number;
    scripts: Array<{
      name: string;
      status: "ran" | "skipped" | "error";
      command?: string | undefined;
      durationMs?: number | undefined;
      error?: string | undefined;
    }>;
  } | undefined;
  error?: string | undefined;
}

export interface ScheduleEntry {
  name: string;
  description: string | undefined;
  schedule: string;
  scheduleType: "cron" | "at" | "rrule" | "wakeup-only";
  enabled: boolean;
  onWakeup: boolean;
  notBefore: string | undefined;
  runs: string;
  lastRun: string | null;
  lastResult: "success" | "failure" | null;
  lastError: string | null;
  runCount: number;
  once: boolean;
  budget?: { limitMs: number; windowMs: number; usedMs: number } | undefined;
  running?: { startedAt: string; triggeredBy: string } | undefined;
  missingRequirements?: string[] | undefined;
}

export const schedulerRouter = router({
  log: publicProcedure
    .input(
      z.object({
        limit: z.number().int().positive().default(100),
        event: z.string().optional(),
        status: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const logPath = boxLogFile(ctx.boxRoot);

      try {
        await fs.access(logPath);
      } catch {
        return { entries: [] as SchedulerLogEntry[] };
      }

      let entries: SchedulerLogEntry[] = [];

      const rl = readline.createInterface({
        input: createReadStream(logPath),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as SchedulerLogEntry;
          if (input.event && entry.event !== input.event) continue;
          if (input.status && entry.result) {
            const hasMatch = entry.result.scripts.some((s) => s.status === input.status);
            if (!hasMatch) continue;
          }
          entries.push(entry);
        } catch {
          // Skip malformed lines
        }
      }

      entries.reverse();
      if (entries.length > input.limit) {
        entries = entries.slice(0, input.limit);
      }

      return { entries };
    }),

  schedules: publicProcedure.query(async ({ ctx }) => {
    const schedulesDir = path.join(ctx.boxRoot, "config/schedules");

    let files: string[];
    try {
      files = (await fs.readdir(schedulesDir)).filter((f) =>
        f.endsWith(".scheduled-script.card")
      );
    } catch {
      return { schedules: [] as ScheduleEntry[] };
    }

    const schedules: ScheduleEntry[] = [];
    const now = new Date();
    const running = await loadRunningScripts(ctx.boxRoot);

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
          scheduleType: "wakeup-only",
          enabled: false,
          onWakeup: false,
          notBefore: undefined,
          runs: "",
          lastRun: null,
          lastResult: null,
          lastError: null,
          runCount: 0,
          once: false,
          budget: undefined,
          running: undefined,
        });
        continue;
      }

      const state = await loadScriptState(ctx.boxRoot, scriptName);

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

      const lock = running.get(scriptName);

      const missingReqs = parsed.requires
        ? checkMissingConnectors(ctx.boxRoot, parsed.requires)
        : undefined;

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
        lastResult: state.lastResult as "success" | "failure" | null,
        lastError: state.lastError,
        runCount: state.runCount,
        once: parsed.once,
        budget: budgetInfo,
        running: lock ? { startedAt: lock.startedAt, triggeredBy: lock.triggeredBy } : undefined,
        missingRequirements: missingReqs && missingReqs.length > 0 ? missingReqs : undefined,
      });
    }

    return { schedules };
  }),

  setEnabled: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      enabled: z.boolean(),
    }))
    .mutation(async ({ input, ctx }) => {
      const fileName = `${input.name}.scheduled-script.card`;
      const relPath = path.join("config/schedules", fileName);
      const fullPath = path.join(ctx.boxRoot, relPath);

      try {
        await fs.access(fullPath);
      } catch {
        throw new TRPCError({ code: "NOT_FOUND", message: `Schedule not found: ${input.name}` });
      }

      const loader = await createLoader(ctx.boxRoot);
      const card = await loader.load(fullPath);

      if (input.enabled) {
        delete card.element.attrs.enabled;
      } else {
        card.element.attrs.enabled = "false";
      }

      await loader.save(card);

      const action = input.enabled ? "Enable" : "Disable";
      await stageFiles(ctx.boxRoot, [relPath]);
      await commit(ctx.boxRoot, {
        message: `${action} schedule: ${input.name}`,
        trailers: { "Source": "webapp", "Endpoint": "scheduler.setEnabled" },
      });

      return { enabled: input.enabled };
    }),
});
