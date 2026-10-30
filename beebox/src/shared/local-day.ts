/**
 * The calendar day an instant falls on in a timezone, as `YYYY-MM-DD`.
 *
 * Built from `formatToParts` rather than the locale's whole-date pattern, so a
 * change to how `en-CA` lays out a date cannot change the result. Pure: the
 * caller passes the clock and the zone (`core/box/local-day.ts` reads both for
 * a box).
 */

import { invariant } from "./invariant.js";

export function localDay(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string): string => {
    const value = parts.find((candidate) => candidate.type === type)?.value;
    invariant(value !== undefined, `Missing ${type} in localized date`);
    return value;
  };
  return `${part("year")}-${part("month")}-${part("day")}`;
}
