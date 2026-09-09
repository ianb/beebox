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
import { stageAndCommitPaths } from "../../../lib/git.js";
import { listSchedules, type ScheduleEntry } from "./scheduler-schedules.js";
import { checkTriggerPreconditions, runScheduledScript } from "./scheduler-run.js";
import { withCardLock } from "../../../lib/card-lock.js";
import { isRecord } from "../../../lib/is-record.js";
import { BOX_DIRS } from "../../../lib/paths.js";

export type { ScheduleEntry };

/** Clean log entry type without index signature for tRPC serialization */
/**
 * A scheduler tick log line (JSONL). Validated on read (`log` query) so a
 * malformed line is skipped rather than flowing on as a mis-typed cast.
 */
const schedulerLogEntrySchema = z.object({
  ts: z.string(),
  event: z.string(),
  box: z.string().optional(),
  result: z
    .object({
      ran: z.number(),
      skipped: z.number(),
      errors: z.number(),
      // The fourth count: scripts whose work ran but whose check reached no
      // verdict. Defaulted, not required — lines written before the scheduler
      // counted them must still parse, and a dropped line is a tick the
      // dashboard silently never saw.
      inconclusive: z.number().default(0),
      scripts: z.array(
        z.object({
          name: z.string(),
          status: z.enum(["ran", "skipped", "error", "inconclusive"]),
          command: z.string().optional(),
          durationMs: z.number().optional(),
          error: z.string().optional(),
        }),
      ),
    })
    .optional(),
  error: z.string().optional(),
});
export type SchedulerLogEntry = z.infer<typeof schedulerLogEntrySchema>;

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
        const entries: SchedulerLogEntry[] = [];
        return { entries };
      }

      let entries: SchedulerLogEntry[] = [];

      const rl = readline.createInterface({
        input: createReadStream(logPath),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const parsedEntry = schedulerLogEntrySchema.safeParse(JSON.parse(line));
          if (!parsedEntry.success) {
            console.warn("Skipping scheduler log line that failed validation:", parsedEntry.error.message);
            continue;
          }
          const entry = parsedEntry.data;
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
      const relPath = path.join(BOX_DIRS.schedules, fileName);
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
        const parsedFm: unknown = parseYaml(split.frontmatterText);
        const fm: Record<string, unknown> = isRecord(parsedFm) ? parsedFm : {};
        if (input.enabled) {
          delete fm["enabled"];
        } else {
          fm["enabled"] = false;
        }
        await fs.writeFile(fullPath, renderFrontmatterBlock(fm, split.body));

        const action = input.enabled ? "Enable" : "Disable";
        await stageAndCommitPaths(ctx.boxRoot, {
          paths: [relPath],
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
      const cardPath = path.join(ctx.boxRoot, BOX_DIRS.schedules, fileName);

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
