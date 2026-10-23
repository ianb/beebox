/**
 * The walker's phone, as pure pieces: what a wait runs and in what order, how
 * long a wait is, which notification a tick produced, and how a notification reads on
 * the phone. `phone.ts` does the reading, ticking, and writing.
 * See docs/implemented-plans/walk-simulated-time.md (Track 7).
 */
import { CronExpressionParser } from "cron-parser";
import rrulePkg from "rrule";
import type { LoggedNotification } from "../../../src/core/notification/log.ts";
import { parseTarget, targetUrl } from "../../../src/core/notification/target.ts";

const { rrulestr } = rrulePkg;

/** One schedule card, as much of it as a wait needs. */
export interface ScheduleCard {
  name: string;
  /** `notify:` sends a notification; `runs:` runs a command (often an agent). */
  kind: "notify" | "runs";
  enabled: boolean;
  at: string | undefined;
  cron: string | undefined;
  rrule: string | undefined;
  until: string | undefined;
}

/** One time a card comes due during a wait. */
export interface Occurrence {
  name: string;
  kind: ScheduleCard["kind"];
  at: Date;
}

/** `<card>@<iso>`: how the wait record names an occurrence. */
export function occurrenceKey(o: Occurrence): string {
  return `${o.name}@${o.at.toISOString()}`;
}

/** A `notify:` card sends nothing slow; a `runs:` card may run an agent each time. */
const MAX_PER_CARD = { notify: 50, runs: 8 } as const;

function cardOccurrences(card: ScheduleCard, opts: { from: Date; to: Date }): Date[] {
  const { from, to } = opts;
  const until = card.until === undefined ? null : new Date(card.until).getTime();
  const times: Date[] = [];
  if (card.cron !== undefined) {
    const interval = CronExpressionParser.parse(card.cron, { currentDate: from });
    for (let next = interval.next().toDate(); next.getTime() <= to.getTime(); next = interval.next().toDate()) {
      times.push(next);
      if (times.length > MAX_PER_CARD[card.kind]) break;
    }
  } else if (card.rrule !== undefined) {
    times.push(...rrulestr(card.rrule).between(from, to, true).filter((d) => d.getTime() > from.getTime()));
  } else if (card.at !== undefined) {
    // A one-shot that still exists has not run (a run one is deleted), so an overdue
    // one is due too, at the wait's current point: time only moves forward.
    const at = new Date(card.at);
    if (at.getTime() <= to.getTime()) times.push(at.getTime() < from.getTime() ? from : at);
  }
  return until === null ? times : times.filter((d) => d.getTime() <= until);
}

export interface WaitPlan {
  /** Every occurrence in `(from, to]`, plus overdue one-shots, oldest first. */
  queue: Occurrence[];
  /** Cards that come due more often than a wait runs them: the wait refuses. */
  refused: string[];
}

/** What a wait from `from` to `to` runs, in time order. */
export function planWait(cards: readonly ScheduleCard[], opts: { from: Date; to: Date }): WaitPlan {
  const queue: Occurrence[] = [];
  const refused: string[] = [];
  for (const card of cards) {
    if (!card.enabled) continue;
    const times = cardOccurrences(card, opts);
    if (times.length > MAX_PER_CARD[card.kind]) {
      refused.push(`${card.name} (more than ${String(MAX_PER_CARD[card.kind])} times; wait less at once)`);
      continue;
    }
    queue.push(...times.map((at) => ({ name: card.name, kind: card.kind, at })));
  }
  queue.sort((a, b) => a.at.getTime() - b.at.getTime() || a.name.localeCompare(b.name));
  return { queue, refused: refused.toSorted() };
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
