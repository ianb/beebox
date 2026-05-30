import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";
import { createReadStream } from "node:fs";
import { performance } from "node:perf_hooks";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc.js";
import { boxLogFile } from "../../../core/scheduler.js";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { splitCardContent } from "cardworks";
import {
  parseScheduledScript,
  isWithinBudget,
  type ScheduledScriptFields,
} from "../../../schemas/scheduled-script.js";
import { parseCardText } from "../../../core/card-io.js";
import { createCardSchemaMap } from "../../../schemas/registry.js";
import { checkMissingConnectors } from "../../../connectors/requirements.js";
import {
  loadScriptState,
  saveScriptState,
  recordRun,
  acquireScriptLock,
  releaseScriptLock,
  loadRunningScripts,
} from "../../../core/schedule-state.js";
import { execWithTimeout, handleCreateAfterSuccess } from "../../../cli/commands/tick-utils.js";
import { buildScriptEnv } from "../../../core/script-env.js";
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
      } catch (_e) {
        // No log file yet means there are no entries to return.
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
        } catch (e) {
          console.warn("Skipping malformed scheduler log line:", e);
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
    } catch (_e) {
      // No schedules directory means there are no schedules to list.
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
        const card = parseCardText(content, { source: file, schemas: createCardSchemaMap() });
        parsed = parseScheduledScript(card.fields as unknown as ScheduledScriptFields);
      } catch (e) {
        console.warn(`Failed to parse schedule "${scriptName}", listing as parse error:`, e);
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
        ? await checkMissingConnectors(ctx.boxRoot, parsed.requires)
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
      } catch (_e) {
        // Access failure here means the schedule file does not exist; surface as NOT_FOUND.
        throw new TRPCError({ code: "NOT_FOUND", message: `Schedule not found: ${input.name}` });
      }

      const content = await fs.readFile(fullPath, "utf-8");
      const split = splitCardContent(content);
      if (!split.hasFrontmatter) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Schedule "${input.name}" has no frontmatter` });
      }
      const fm = parseYaml(split.frontmatterText) as Record<string, unknown>;
      if (input.enabled) {
        delete fm["enabled"];
      } else {
        fm["enabled"] = false;
      }
      await fs.writeFile(fullPath, `---\n${stringifyYaml(fm)}---\n${split.body}`);

      const action = input.enabled ? "Enable" : "Disable";
      await stageFiles(ctx.boxRoot, [relPath]);
      await commit(ctx.boxRoot, {
        message: `${action} schedule: ${input.name}`,
        trailers: { "Source": "webapp", "Endpoint": "scheduler.setEnabled" },
      });

      return { enabled: input.enabled };
    }),

  trigger: publicProcedure
    .input(z.object({
      name: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const fileName = `${input.name}.scheduled-script.card`;
      const cardPath = path.join(ctx.boxRoot, "config/schedules", fileName);

      let content: string;
      try {
        content = await fs.readFile(cardPath, "utf-8");
      } catch (_e) {
        // Read failure here means the schedule file does not exist; surface as NOT_FOUND.
        throw new TRPCError({ code: "NOT_FOUND", message: `Schedule not found: ${input.name}` });
      }

      const card = parseCardText(content, { source: fileName, schemas: createCardSchemaMap() });
      const parsed = parseScheduledScript(card.fields as unknown as ScheduledScriptFields);

      if (!parsed.enabled) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Schedule "${input.name}" is disabled` });
      }

      // Check requirements
      if (parsed.requires) {
        const missing = await checkMissingConnectors(ctx.boxRoot, parsed.requires);
        if (missing.length > 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Missing connectors: ${missing.join(", ")}`,
          });
        }
      }

      // Check lock conflicts
      const running = await loadRunningScripts(ctx.boxRoot);
      if (running.has(input.name)) {
        throw new TRPCError({ code: "CONFLICT", message: `"${input.name}" is already running` });
      }
      if (parsed.lockGroup) {
        const conflict = [...running.entries()].find(
          ([name, lock]) => lock.lockGroup === parsed.lockGroup && name !== input.name
        );
        if (conflict) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Lock group "${parsed.lockGroup}" held by ${conflict[0]}`,
          });
        }
      }

      // Run the script
      const SCRIPT_TIMEOUT = 10 * 60 * 1000;
      const DEFAULT_RUN_WINDOW_MS = 24 * 60 * 60 * 1000;
      const SLEEP_THRESHOLD_MS = 5_000;
      const now = new Date();
      const state = await loadScriptState(ctx.boxRoot, input.name);

      await acquireScriptLock({
        boxRoot: ctx.boxRoot,
        scriptName: input.name,
        triggeredBy: "webapp-trigger",
        ...(parsed.lockGroup ? { lockGroup: parsed.lockGroup } : {}),
      });

      const wallStart = Date.now();
      const monoStart = performance.now();
      try {
        const scriptEnv = await buildScriptEnv(ctx.boxRoot, {
          CB_TRIGGERED_BY: "webapp-trigger",
        });
        await execWithTimeout(parsed.runs, {
          cwd: ctx.boxRoot,
          stdio: "ignore",
          timeout: SCRIPT_TIMEOUT,
          env: scriptEnv,
        });

        const wallElapsed = Date.now() - wallStart;
        const monoElapsed = performance.now() - monoStart;
        const sleepAffected = Math.abs(wallElapsed - monoElapsed) > SLEEP_THRESHOLD_MS;
        const durationMs = sleepAffected ? Math.round(monoElapsed) : wallElapsed;

        state.lastRun = now.toISOString();
        state.lastResult = "success";
        state.lastError = null;
        state.runCount++;
        const windowMs = parsed.budget?.windowMs ?? DEFAULT_RUN_WINDOW_MS;
        recordRun(state, {
          record: { ts: now.toISOString(), durationMs, ...(sleepAffected ? { sleepAffected: true } : {}) },
          windowMs,
          now,
        });
        await saveScriptState({ boxRoot: ctx.boxRoot, scriptName: input.name, state });

        await handleCreateAfterSuccess({ boxRoot: ctx.boxRoot, parsed, scriptName: input.name });

        return { success: true, durationMs };
      } catch (err) {
        const wallElapsed = Date.now() - wallStart;
        const monoElapsed = performance.now() - monoStart;
        const sleepAffected = Math.abs(wallElapsed - monoElapsed) > SLEEP_THRESHOLD_MS;
        const durationMs = sleepAffected ? Math.round(monoElapsed) : wallElapsed;

        state.lastRun = now.toISOString();
        state.lastResult = "failure";
        state.lastError = (err as Error).message;
        state.runCount++;
        const windowMs = parsed.budget?.windowMs ?? DEFAULT_RUN_WINDOW_MS;
        recordRun(state, {
          record: { ts: now.toISOString(), durationMs, ...(sleepAffected ? { sleepAffected: true } : {}) },
          windowMs,
          now,
        });
        await saveScriptState({ boxRoot: ctx.boxRoot, scriptName: input.name, state });

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: (err as Error).message,
        });
      } finally {
        await releaseScriptLock({ boxRoot: ctx.boxRoot, scriptName: input.name });
      }
    }),
});
