/**
 * Temporal / situational context for the per-turn `<chat-app>` snapshot.
 *
 * The agent gets a UTC ISO `time` on every message, but conversations
 * constantly reference things the model is bad at deriving from that:
 * day of week, phase of day, "how long since we last talked", "what's
 * on today". These helpers compute those as short strings, rendered in
 * the box's configured timezone.
 *
 * Everything here lands in message text (snapshot attributes), never in
 * the system prompt — the warm-pool backend reuses a prewarmed
 * subprocess only when the system prompt matches exactly, so the system
 * prompt must stay time-invariant.
 */

import * as path from "node:path";
import { loadBoxTimezone } from "../webapp/box-config.js";
import { getMostActiveSavedAt } from "./chat-session-history.js";
import { composeChatAppSnapshot, type FeatureMap } from "./chat-features.js";
import {
  loadScheduleHealth,
  summarizeScheduleHealth,
} from "./schedule-health-box.js";
import {
  filterByDateRange,
  loadAllEvents,
  type CalendarEvent,
} from "../connectors/calendar-utils.js";

const CALENDAR_HORIZON_MS = 24 * 60 * 60 * 1000;
const MAX_CALENDAR_ITEMS = 4;

function phaseOfDay(hour: number): string {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "late night";
}

interface LocalParts {
  weekday: string;
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
}

/**
 * Format a Date's wall-clock parts in the given IANA timezone.
 * `timezone: null` (box has none configured) means server-local time.
 * An invalid timezone string falls back to server-local with a warning.
 */
function localParts(date: Date, timezone: string | null): LocalParts {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat(
      "en-US",
      timezone === null ? options : { ...options, timeZone: timezone },
    );
  } catch (e) {
    // Intl throws RangeError on an unknown zone name; recover to
    // server-local time either way — a bad config value must not take
    // down chat sends.
    console.warn(`[session-context] Unusable timezone "${timezone}" (${e instanceof Error ? e.message : e}), using server-local time`);
    fmt = new Intl.DateTimeFormat("en-US", options);
  }
  const raw: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) raw[part.type] = part.value;
  // Every requested option yields a part, so the fallbacks never fire in
  // practice — they exist to give the index accesses a guaranteed string.
  return {
    weekday: raw.weekday ?? "",
    year: raw.year ?? "",
    month: raw.month ?? "",
    day: raw.day ?? "",
    hour: raw.hour ?? "",
    minute: raw.minute ?? "",
  };
}

/**
 * Human-oriented local time: named weekday, local date and clock, phase
 * of day. E.g. `Tuesday 2026-06-09 14:32 (afternoon)`. The named
 * weekday and phase are the point — models misderive both from a UTC
 * ISO timestamp.
 */
export function formatLocalTime(
  date: Date,
  { timezone }: { timezone: string | null },
): string {
  const p = localParts(date, timezone);
  const phase = phaseOfDay(Number(p.hour));
  return `${p.weekday} ${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} (${phase})`;
}

/**
 * Coarse human duration: "moments", "5 minutes", "3 hours", "2 days",
 * "3 weeks". Coarse on purpose — this seeds phrasing like "it's been a
 * few days", not arithmetic.
 */
export function describeElapsed(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "moments";
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 48) return plural(hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 14) return plural(days, "day");
  return plural(Math.round(days / 7), "week");
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/**
 * One-line summary of upcoming events for the snapshot's `calendar`
 * attribute: `16:00-17:00 Dentist; Wed 09:00-09:30 Standup; +2 more`.
 * Events on a later local day than `now` get a short weekday prefix.
 * Cancelled events are skipped. Returns null when there's nothing.
 */
export function summarizeEvents(
  events: CalendarEvent[],
  { timezone, now }: { timezone: string | null; now: Date },
): string | null {
  const active = events.filter((e) => e.status.toUpperCase() !== "CANCELLED");
  if (active.length === 0) return null;
  const today = dayKey(now, timezone);
  const items = active.slice(0, MAX_CALENDAR_ITEMS).map((e) => {
    const p = localParts(e.start, timezone);
    const prefix = dayKey(e.start, timezone) === today ? "" : `${p.weekday.slice(0, 3)} `;
    if (e.allDay) return `${prefix}all day: ${e.summary}`;
    const end = localParts(e.end, timezone);
    return `${prefix}${p.hour}:${p.minute}-${end.hour}:${end.minute} ${e.summary}`;
  });
  const overflow = active.length - items.length;
  return items.join("; ") + (overflow > 0 ? `; +${overflow} more` : "");
}

function dayKey(date: Date, timezone: string | null): string {
  const p = localParts(date, timezone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Snapshot attribute values computed per send. */
interface SnapshotContext {
  localTime: string;
  lastActivity?: string;
  calendar?: string;
  health?: string;
}

/**
 * Compose the full `<chat-app>` snapshot for one send: feature flags,
 * UTC `time`, and the situational context attributes, stamped at call
 * time. The one-stop entry point for `ChatSession.send`.
 */
export async function composeSendSnapshot(
  boxRoot: string,
  { features, sessionStart, channel, openCard, cardActivity }: {
    features: FeatureMap;
    sessionStart: boolean;
    channel?: string;
    openCard?: string;
    cardActivity?: string;
  },
): Promise<string> {
  const now = new Date();
  const context = await buildSnapshotContext(boxRoot, { now, sessionStart });
  return composeChatAppSnapshot({
    features,
    time: now.toISOString(),
    ...context,
    ...(channel !== undefined ? { channel } : {}),
    ...(openCard !== undefined ? { openCard } : {}),
    ...(cardActivity !== undefined ? { cardActivity } : {}),
  });
}

/**
 * Compute the snapshot context for one send. `localTime` is always
 * present. The session-start extras (`lastActivity` from the
 * most-active pointer's savedAt, `calendar` from the next 24h of
 * `store/calendar/`, `health` from scheduled-task health — present
 * only when something is failing or overdue, so every-session green
 * noise never trains the agent to ignore it) are computed only when
 * `sessionStart` is true — the first message of a brand-new
 * conversation. Failures in the extras degrade to omission; they must
 * never block a send.
 */
export async function buildSnapshotContext(
  boxRoot: string,
  { now, sessionStart }: { now: Date; sessionStart: boolean },
): Promise<SnapshotContext> {
  const timezone = await loadBoxTimezone(boxRoot);
  const out: SnapshotContext = { localTime: formatLocalTime(now, { timezone }) };
  if (!sessionStart) return out;

  try {
    const savedAt = await getMostActiveSavedAt(boxRoot);
    if (savedAt !== null && savedAt.getTime() < now.getTime()) {
      out.lastActivity = `${describeElapsed(now.getTime() - savedAt.getTime())} ago`;
    }
  } catch (e) {
    console.warn(`[session-context] last-activity lookup failed: ${e instanceof Error ? e.message : e}`);
  }

  try {
    const range = { from: now, to: new Date(now.getTime() + CALENDAR_HORIZON_MS) };
    const events = filterByDateRange(
      await loadAllEvents(path.join(boxRoot, "store", "calendar"), range),
      range,
    );
    const calendar = summarizeEvents(events, { timezone, now });
    if (calendar !== null) out.calendar = calendar;
  } catch (e) {
    console.warn(`[session-context] calendar summary failed: ${e instanceof Error ? e.message : e}`);
  }

  try {
    const health = summarizeScheduleHealth(await loadScheduleHealth(boxRoot, now), now);
    if (health !== null) out.health = health;
  } catch (e) {
    console.warn(`[session-context] schedule health summary failed: ${e instanceof Error ? e.message : e}`);
  }

  return out;
}
