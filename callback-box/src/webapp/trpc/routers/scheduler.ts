import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";
import { createReadStream } from "node:fs";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc.js";
import { boxLogFile } from "../../../core/schedule/scheduler.js";
import { parse as parseYaml } from "yaml";
import { renderFrontmatterBlock, splitCardContent } from "../../../cards/index.js";
import {
  parseScheduledScript,
  ScheduledScriptSchema,
} from "../../../schemas/scheduled-script.js";
import { cardFields, parseCardText } from "../../../core/card-io.js";
import { createCardSchemaMap } from "../../../schemas/registry.js";
import { stageFiles, commit } from "../../../lib/git.js";
import { listSchedules, type ScheduleEntry } from "./scheduler-schedules.js";
import { checkTriggerPreconditions, runScheduledScript } from "./scheduler-run.js";
import { withCardLock } from "../../../lib/card-lock.js";

export type { ScheduleEntry };

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
    return { schedules: await listSchedules(ctx.boxRoot) };
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

      // Serialize the read-modify-write on the schedule card so concurrent
      // enable/disable toggles can't clobber each other.
      return withCardLock(fullPath, async () => {
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
        await fs.writeFile(fullPath, renderFrontmatterBlock(fm, split.body));

        const action = input.enabled ? "Enable" : "Disable";
        await stageFiles(ctx.boxRoot, [relPath]);
        await commit(ctx.boxRoot, {
          message: `${action} schedule: ${input.name}`,
          trailers: { "Source": "webapp", "Endpoint": "scheduler.setEnabled" },
        });

        return { enabled: input.enabled };
      });
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

      const card = parseCardText(content, { source: fileName, schemas: await createCardSchemaMap(ctx.boxRoot) });
      const parsed = parseScheduledScript(cardFields(card, ScheduledScriptSchema));

      await checkTriggerPreconditions({ boxRoot: ctx.boxRoot, name: input.name, parsed });

      return runScheduledScript({ boxRoot: ctx.boxRoot, name: input.name, parsed });
    }),
});
