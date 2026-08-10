/**
 * Human-readable cadence descriptions for scheduled scripts.
 *
 * Turns the timing fields of a scheduled-script card into one sentence
 * ("At 4:00 AM, at most once every 20 hours") for the dashboard and
 * `cb scheduled`. The raw expression stays available wherever it's needed
 * for editing or debugging.
 */

import cronstrue from "cronstrue";
import rrulePkg from "rrule";

const { rrulestr } = rrulePkg;

/** The timing subset of a ParsedScheduledScript (which satisfies it structurally). */
export interface ScheduleCadenceInput {
  cron: string | undefined;
  at: string | undefined;
  rrule: string | undefined;
  until: string | undefined;
  notBefore: string | undefined;
  onWakeup: boolean;
  once: boolean;
}

const UNIT_NAMES: Record<string, string> = {
  s: "second",
  m: "minute",
  h: "hour",
  d: "day",
  w: "week",
};

/** "20h" → "20 hours", "1h" → "hour", "90m" → "90 minutes". Falls back to the raw string. */
function humanizeDuration(duration: string): string {
  const match = duration.match(/^(\d+\.?\d*)\s*([dhmsw])$/);
  const [, valueStr, unit] = match ?? [];
  if (valueStr === undefined || unit === undefined) return duration;
  const value = parseFloat(valueStr);
  const name = UNIT_NAMES[unit] ?? duration;
  if (value === 1) return name;
  return `${value} ${name}s`;
}

/** Format an ISO datetime for humans; falls back to the raw string when unparseable. */
function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** cronstrue zero-pads hours ("At 04:00 AM"); strip the pad for prose. */
function stripZeroPaddedHours(text: string): string {
  return text.replace(/\b0(\d:\d\d)/g, "$1");
}

function describeBase(script: ScheduleCadenceInput): string {
  if (script.cron) {
    try {
      return stripZeroPaddedHours(cronstrue.toString(script.cron));
    } catch (_e) {
      // Invalid cron: show the raw expression rather than nothing.
      return `cron ${script.cron}`;
    }
  }
  if (script.at) {
    // `at` schedules fire a single time (once now >= at and it hasn't run).
    return `Once at ${formatDateTime(script.at)}`;
  }
  if (script.rrule) {
    try {
      const text = rrulestr(script.rrule).toText();
      return text.charAt(0).toUpperCase() + text.slice(1);
    } catch (_e) {
      // Invalid rrule: show the raw expression rather than nothing.
      return `rrule ${script.rrule}`;
    }
  }
  return script.onWakeup ? "On wakeup" : "No schedule";
}

/**
 * Describe a schedule's full cadence as one sentence, e.g.
 * "Every 15 minutes and on wakeup, at most once every 10 minutes".
 */
export function describeCadence(script: ScheduleCadenceInput): string {
  const hasBase = Boolean(script.cron || script.at || script.rrule);
  let text = describeBase(script);
  if (script.onWakeup && hasBase) {
    text += " and on wakeup";
  }
  if (script.once && !script.at) {
    text += ", once";
  }
  if (script.notBefore) {
    // not-before is a floor on the interval between runs: "at most once
    // every N", never "at least".
    text += `, at most once every ${humanizeDuration(script.notBefore)}`;
  }
  if (script.until) {
    text += `, until ${formatDateTime(script.until)}`;
  }
  return text;
}
