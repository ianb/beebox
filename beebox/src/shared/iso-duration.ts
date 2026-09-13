/**
 * ISO-8601 durations (`P30D`, `PT12H`, `P2W`): the one grammar and the one
 * millisecond conversion, shared by the backend (question aging, task
 * cadence) and the browser (the browser-task view computes "due" itself).
 *
 * Pure and bundler-safe. Moved here from `schemas/question.ts`, which
 * re-exports for its existing importers.
 */

import { z } from "zod";

/**
 * The subset used for card fields. Requires at least one designated
 * component; bare `P` or `PT` are rejected.
 */
const ISO_8601_DURATION =
  /^P(?!$)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?!$)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/;

export function isIso8601Duration(value: string): boolean {
  return ISO_8601_DURATION.test(value);
}

export const IsoDuration = z
  .string()
  .refine(isIso8601Duration, { message: "must be an ISO-8601 duration, e.g. P30D or PT12H" });

/** Same components as {@link ISO_8601_DURATION}, captured for arithmetic. */
const ISO_8601_DURATION_CAPTURE =
  /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

export class InvalidIso8601DurationError extends Error {
  constructor(value: string) {
    super(`Invalid ISO-8601 duration: "${value}"`);
    this.name = "InvalidIso8601DurationError";
  }
}

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MS_PER_WEEK = 7 * MS_PER_DAY;
// Y/M are calendar-relative in the spec, but callers have no reference date.
// Fields using this are day-to-week scale; Y/M get a fixed 30-day-month /
// 365-day-year approximation, consistent even if not calendar-exact.
const MS_PER_MONTH = 30 * MS_PER_DAY;
const MS_PER_YEAR = 365 * MS_PER_DAY;

/** Convert an ISO-8601 duration to milliseconds; throws on an invalid string. */
export function parseIso8601DurationMs(value: string): number {
  const match = ISO_8601_DURATION_CAPTURE.exec(value);
  if (!match) {
    throw new InvalidIso8601DurationError(value);
  }
  const [, years, months, weeks, days, hours, minutes, seconds] = match;
  return (
    Number(years ?? 0) * MS_PER_YEAR +
    Number(months ?? 0) * MS_PER_MONTH +
    Number(weeks ?? 0) * MS_PER_WEEK +
    Number(days ?? 0) * MS_PER_DAY +
    Number(hours ?? 0) * MS_PER_HOUR +
    Number(minutes ?? 0) * MS_PER_MINUTE +
    Number(seconds ?? 0) * MS_PER_SECOND
  );
}
