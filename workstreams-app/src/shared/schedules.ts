import { z } from "zod";

/**
 * Alert records as `bin/schedules alerts --json` hands them over. The store
 * itself is `bin/`'s (the CLI is its only writer, the `bin/comments` rule), so
 * this schema is a parse boundary over another program's stdout, not a second
 * definition of the record — `bin/lib/schedules.ts` owns that.
 *
 * Design: beebox/docs/plans/scheduled-workstreams.md (Tracks C, D).
 */

/** `<YYYYMMDD>-<HHMMSS>-<4 hex>` (bin/lib/schedules.ts `alertIdFor`). */
export const scheduleAlertIdSchema = z.string().regex(/^\d{8}-\d{6}-[0-9a-f]{4}$/u);

export const scheduleAlertPrioritySchema = z.enum(["important", "normal", "backlog", "fyi"]);

export const scheduleAlertSchema = z.object({
  id: scheduleAlertIdSchema,
  workstream: z.string().min(1),
  runId: z.string().min(1).nullable(),
  title: z.string().min(1),
  message: z.string(),
  /** Markdown: the log tail, the knip findings, whatever the run attached. */
  details: z.string().nullable(),
  priority: scheduleAlertPrioritySchema,
  createdAt: z.iso.datetime(),
  state: z.enum(["open", "acknowledged"]),
  acknowledgedAt: z.iso.datetime().nullable(),
});

export const scheduleAlertsResultSchema = z.object({
  items: z.array(scheduleAlertSchema),
});

export type ScheduleAlert = z.infer<typeof scheduleAlertSchema>;
export type ScheduleAlertPriority = z.infer<typeof scheduleAlertPrioritySchema>;
export type ScheduleAlertsResult = z.infer<typeof scheduleAlertsResultSchema>;
