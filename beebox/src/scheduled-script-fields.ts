/**
 * Field-level Zod validators for scheduled-script timing fields. Split out
 * of scheduled-script.tsx to keep that file under the line limit.
 *
 * `at`/`until`/`cron`/`rrule` are only parse-checked lazily at evaluation
 * time otherwise — a malformed value passes card validation and then does
 * nothing at runtime (see
 * issues/bugs/2026-08-10-invalid-schedule-dates-silently-inert.md).
 */

import { z } from "zod";
import { CronExpressionParser } from "cron-parser";
import rrulePkg from "rrule";
import { LOUDNESS, targetStringSchema } from "./core/notification/intent.js";
import { resolveRefPath } from "./shared/ref-path/core.js";

const { rrulestr } = rrulePkg;

// `new Date()` alone is far too permissive ("5" parses as May 2001), so
// require an ISO 8601 shape first: date, optionally time, optionally zone.
const ISO_DATETIME_SHAPE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** An ISO 8601 datetime that also parses to a real date. Used for `at`/`until`. */
export const DatetimeField = z.string().refine(
  (value) => ISO_DATETIME_SHAPE.test(value) && !isNaN(new Date(value).getTime()),
  { message: "must be an ISO 8601 datetime (e.g. 2026-09-01T14:30:00)" }
);

export const CronField = z.string().refine(
  (value) => {
    try {
      // Exercise prev(), not just parse — it's what isCronDue calls, and an
      // expression can construct but still fail to produce an occurrence.
      CronExpressionParser.parse(value).prev();
      return true;
    } catch (_e) {
      return false;
    }
  },
  { message: "invalid cron expression" }
);

export const RruleField = z.string().refine(
  (value) => {
    try {
      rrulestr(value);
      return true;
    } catch (_e) {
      return false;
    }
  },
  { message: "invalid RRULE" }
);

/** A card path inside the box, resolved like every other ref (fails closed on `..`). */
const ContextRefField = z.string().refine(
  (value) => resolveRefPath({ fromPath: undefined, ref: value, kind: "card" }) !== null,
  { message: "must be a card path inside the box (e.g. _content/pets/pepper-shots.todo.card)" }
);

/** `notify:` on a scheduled script: the notification the tick sends in place of running a command. */
export const NotifyField = z.strictObject({
  title: z.string().regex(/\S/, { message: "a notification needs a title" }),
  body: z.string().optional(),
  loudness: z.enum(LOUDNESS).optional(),
  target: targetStringSchema.optional(),
  context: ContextRefField.optional(),
});
export type ScheduleNotify = z.infer<typeof NotifyField>;
