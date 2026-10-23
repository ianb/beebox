/**
 * When a reminder fires, and how `bbx remind` says it. Pure: the clock and
 * the box zone are passed in.
 *
 * `--in` adds a duration to box time. `--at` without an offset is wall time
 * in the box's zone, converted here so the card carries an explicit offset:
 * the scheduler reads `at` with `new Date(...)` in the server process's zone
 * (`schemas/scheduled-script/due.ts`), which need not be the box's. A wall
 * time the zone skips (spring forward) or repeats (fall back) is refused, as
 * is an offset-less `--at` on a box with no timezone. A zone of `null` means
 * the box has none configured; times are then shown and written in UTC.
 */

import { parseDuration } from "../../../scheduled-script-duration.js";
import { err, ok, type Result } from "../../../shared/result.js";

interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const AT_SHAPE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?$/;
const AT_FORMS = "use YYYY-MM-DDTHH:MM in the box's timezone, or add the person's UTC offset (Z for UTC, or ±HH:MM after the time)";
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** The wall-clock parts of `instant` in `zone`. */
function wallTimeIn(instant: Date, zone: string): WallTime {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(fmt.formatToParts(instant).find((p) => p.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute"), second: part("second") };
}

function wallAsUtcMs(wall: WallTime): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
}

/** Minutes `zone` is ahead of UTC at `instant`. */
function offsetMinutes(instant: Date, zone: string): number {
  const whole = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((wallAsUtcMs(wallTimeIn(new Date(whole), zone)) - whole) / MINUTE_MS);
}

/**
 * Every instant whose wall time in `zone` is `wall`: none in a spring-forward
 * gap, two in a fall-back overlap, else one. A transition changes the offset,
 * so the offsets a day either side of the naive reading cover every candidate.
 */
function instantsForWallTime(wall: WallTime, zone: string): Date[] {
  const naive = wallAsUtcMs(wall);
  const offsets = new Set([-DAY_MS, 0, DAY_MS].map((shift) => offsetMinutes(new Date(naive + shift), zone)));
  const found = new Set<number>();
  for (const offset of offsets) {
    const candidate = naive - offset * MINUTE_MS;
    if (offsetMinutes(new Date(candidate), zone) === offset) found.add(candidate);
  }
  return [...found].toSorted((a, b) => a - b).map((ms) => new Date(ms));
}

function parseOffset(text: string): number {
  if (text === "Z") return 0;
  const digits = text.slice(1).replace(":", "");
  const minutes = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2));
  return text.startsWith("-") ? -minutes : minutes;
}

function resolveAt(at: string, zone: string | null): Result<Date> {
  const match = AT_SHAPE.exec(at.trim());
  if (match === null) return err(`--at "${at}" is not a datetime; ${AT_FORMS}`);
  const [, y, mo, d, h, mi, s, offset] = match;
  const wall: WallTime = { year: Number(y), month: Number(mo), day: Number(d), hour: Number(h), minute: Number(mi), second: Number(s ?? "0") };
  const roundTrip = new Date(wallAsUtcMs(wall));
  const fields = [roundTrip.getUTCFullYear(), roundTrip.getUTCMonth() + 1, roundTrip.getUTCDate(), roundTrip.getUTCHours(), roundTrip.getUTCMinutes(), roundTrip.getUTCSeconds()];
  if (fields.join(",") !== [wall.year, wall.month, wall.day, wall.hour, wall.minute, wall.second].join(",")) {
    return err(`--at "${at}" is not a real date and time; ${AT_FORMS}`);
  }
  if (offset !== undefined && Math.abs(parseOffset(offset)) > 14 * 60) return err(`--at "${at}" has an offset past ±14:00; ${AT_FORMS}`);
  if (offset !== undefined) return ok(new Date(wallAsUtcMs(wall) - parseOffset(offset) * MINUTE_MS));
  if (zone === null) {
    return err(`This box has no timezone set, so --at "${at}" is ambiguous; add the person's own UTC offset (Z for UTC, or ±HH:MM after the time), or set "timezone" in _config/box.json`);
  }
  const instants = instantsForWallTime(wall, zone);
  const [first] = instants;
  if (first === undefined) return err(`--at "${at}" does not exist in ${zone} (the clocks skip it); add an offset`);
  if (instants.length > 1) return err(`--at "${at}" happens twice in ${zone} (the clocks fall back); add an offset to pick one`);
  return ok(first);
}

function resolveIn(duration: string, now: Date): Result<Date> {
  let ms: number;
  try {
    ms = parseDuration(duration.trim());
  } catch (_e) {
    // parseDuration throws one error class for every malformed input; the message below names the forms.
    return err(`--in "${duration}" is not a duration; use a number and a unit s, m, h, d, or w (20m, 30d)`);
  }
  return ok(new Date(now.getTime() + ms));
}

/** The instant a reminder fires, or the one-sentence refusal. */
export function resolveReminderTime(opts: { in: string | undefined; at: string | undefined; now: Date; zone: string | null }): Result<Date> {
  const { now, zone } = opts;
  if (opts.in !== undefined && opts.at !== undefined) return err("Give --in or --at, not both");
  if (opts.in === undefined && opts.at === undefined) {
    return err("A reminder needs a time: --in <duration> (20m, 30d) or --at <datetime> (2026-11-18T09:00); add --here for a check-in in this chat");
  }
  const resolved = opts.in !== undefined ? resolveIn(opts.in, now) : resolveAt(opts.at ?? "", zone);
  if (!resolved.ok) return resolved;
  if (resolved.value.getTime() <= now.getTime()) {
    return err(`${formatWhen(resolved.value, zone)} is not in the future (now ${formatWhen(now, zone)}); pick a later time`);
  }
  return resolved;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function parts(instant: Date, zone: string | null): Record<string, string> {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: zone ?? "UTC",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) out[p.type] = p.value;
  return out;
}

/** `Tue 2026-11-18 09:41 CST`: the echo the agent repeats to the person. */
export function formatWhen(instant: Date, zone: string | null): string {
  const p = parts(instant, zone);
  return `${p["weekday"]} ${p["year"]}-${p["month"]}-${p["day"]} ${p["hour"]}:${p["minute"]} ${p["timeZoneName"]}`;
}

/** `18:42 CDT`: a check-in's clock time, the same day as now. */
export function formatClock(instant: Date, zone: string | null): string {
  const p = parts(instant, zone);
  return `${p["hour"]}:${p["minute"]} ${p["timeZoneName"]}`;
}

/** `2026-11-18`: the box-local date, for the card's `reason`. */
export function formatDate(instant: Date, zone: string | null): string {
  const p = parts(instant, zone);
  return `${p["year"]}-${p["month"]}-${p["day"]}`;
}

/** The card's `at`: box wall time with its explicit offset, whole seconds (`2026-11-18T09:41:00-06:00`), or UTC with `Z`. */
export function formatCardAt(instant: Date, zone: string | null): string {
  const whole = new Date(Math.floor(instant.getTime() / 1000) * 1000);
  const offset = zone === null ? 0 : offsetMinutes(whole, zone);
  const w = new Date(whole.getTime() + offset * MINUTE_MS);
  const stamp = `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}-${pad(w.getUTCDate())}T${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}:${pad(w.getUTCSeconds())}`;
  if (zone === null) return `${stamp}Z`;
  const abs = Math.abs(offset);
  return `${stamp}${offset < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
