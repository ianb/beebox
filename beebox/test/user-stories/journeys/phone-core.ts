/**
 * The walker's phone, as pure pieces: which reminders a wait fires, how long a
 * wait is, which notification a tick produced, and how a notification reads on
 * the phone. `phone.ts` does the reading, ticking, and writing.
 * See docs/plans/journey-simulated-notifications.md.
 */
import type { LoggedNotification } from "../../../src/core/notification/log.ts";
import { parseTarget, targetUrl } from "../../../src/core/notification/target.ts";

/** One schedule card, as much of it as a wait needs. */
export interface ReminderCard {
  name: string;
  notify: boolean;
  enabled: boolean;
  at: string | undefined;
  /** It has `cron` or `rrule`: it repeats, and a wait does not simulate it. */
  recurring: boolean;
}

export interface PendingReminders {
  /** One-shot `notify:` cards due at or before the wait's end, in `at` order. */
  pending: Array<{ name: string; at: Date }>;
  /** Repeating `notify:` cards, which the phone names but does not fire. */
  notSimulated: string[];
}

/**
 * A one-shot card that still exists has not fired (a fired one is deleted), so
 * every one due by `to` is pending, including one already overdue.
 */
export function pendingReminders(cards: readonly ReminderCard[], to: Date): PendingReminders {
  const pending: PendingReminders["pending"] = [];
  const notSimulated: string[] = [];
  for (const card of cards) {
    if (!card.notify || !card.enabled) continue;
    if (card.recurring) {
      notSimulated.push(card.name);
      continue;
    }
    if (card.at === undefined) continue;
    const at = new Date(card.at);
    if (at.getTime() <= to.getTime()) pending.push({ name: card.name, at });
  }
  pending.sort((a, b) => a.at.getTime() - b.at.getTime() || a.name.localeCompare(b.name));
  return { pending, notSimulated: notSimulated.toSorted() };
}

const UNIT_MS = { h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000, w: 7 * 24 * 60 * 60 * 1000 } as const;
const MAX_WAIT_MS = 8 * UNIT_MS.w;

/** `36h`, `2d`, `1w`: a whole number and a unit, up to eight weeks. */
export function parseWait(text: string): number {
  const match = /^(\d+)([dhw])$/u.exec(text.trim());
  if (match === null) throw new Error(`--wait takes a whole number and h, d or w (for example 2d or 1w), not "${text}"`);
  const [, count, unit] = match;
  const unitMs = unit === "h" ? UNIT_MS.h : unit === "d" ? UNIT_MS.d : UNIT_MS.w;
  const ms = Number(count) * unitMs;
  if (ms === 0 || ms > MAX_WAIT_MS) throw new Error(`--wait must be more than 0 and at most 8w, not "${text}"`);
  return ms;
}

function sentToPhone(n: LoggedNotification): boolean {
  return n.deliveries.some((d) => d.status === "sent");
}

/** Held back because the person had the app open: the app showed it as a banner instead. */
function shownInApp(n: LoggedNotification): boolean {
  return n.deliveries.some((d) => d.status === "skipped" && d.detail === "present");
}

/** A notification reached the person when a channel sent it, or the open app showed it. */
export function reachedPerson(n: LoggedNotification): boolean {
  return sentToPhone(n) || shownInApp(n);
}

/** The notification a tick of `name` sent, if it sent one. */
export function firedFor(after: readonly LoggedNotification[], opts: { seen: ReadonlySet<string>; name: string }): LoggedNotification | undefined {
  const { seen, name } = opts;
  return after.find((n) => !seen.has(n.intent.id) && n.intent.source === `schedule:${name}` && reachedPerson(n));
}

const LOUDNESS_WORD = { loud: "sound", quiet: "silent", dot: "badge only" } as const;

/** Where a tap goes, as a path `bin/browse open` takes (it adds the box). */
function tapPath(n: LoggedNotification, boxSlug: string): string {
  let url: string;
  try {
    url = targetUrl(parseTarget(n.intent.target), { boxSlug, notificationId: n.intent.id });
  } catch (e) {
    return `(cannot open ${n.intent.target}: ${e instanceof Error ? e.message : String(e)})`;
  }
  const prefix = `/${boxSlug}`;
  return url.startsWith(prefix) ? url.slice(prefix.length) || "/" : url;
}

/** One notification as the phone shows it. */
export function formatPhoneEntry(n: LoggedNotification, opts: { boxSlug: string; timeZone?: string | undefined }): string {
  const when = new Date(n.intent.at).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: opts.timeZone,
  });
  return [
    sentToPhone(n) ? `${when} — ${LOUDNESS_WORD[n.intent.loudness]}` : `${when} — shown in the app, which was open; not sent to the phone`,
    n.intent.title,
    ...(n.intent.body.trim() === "" ? [] : [n.intent.body]),
    `Tap opens: ${tapPath(n, opts.boxSlug)}`,
  ].join("\n");
}
