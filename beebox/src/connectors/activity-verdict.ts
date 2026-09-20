/**
 * Decide, from a connector's activity record, whether it has gone quiet or
 * keeps failing. Pure: the scheduler alert, the dashboard check and the
 * dismiss action all call it with what they read.
 *
 * The rule (boxholder decision, 2026-09-18) prefers silence to a false alarm,
 * which on a real box is worse than no alarm: the box-growth level warning
 * that fired forever taught the boxholder to ignore the dashboard.
 *
 * - Only **run days** count — days with at least one sync attempt. A week with
 *   the scheduler stopped neither extends nor breaks a stretch.
 * - **failing**: the latest run days, at least 2 of them, errored on every
 *   attempt.
 * - **quiet**: the latest run days with a successful sync (`ok > 0`) brought
 *   no new items. A run day whose attempts all errored or skipped is passed
 *   over; the failing check covers errors, and a skip already says why.
 * - Only a **steady producer** can be quiet: history reaching at least 21 days
 *   before the quiet stretch, and new items on at least 60% of the 28
 *   calendar days before it. The denominator is calendar days on purpose: a
 *   connector that runs three times a week reaches at most 12 of 28 and is
 *   never watched; a scheduler outage in the baseline lowers the ratio, which
 *   errs toward silence.
 * - The quiet stretch is too long when it exceeds max(2, 2 × the longest run
 *   of no-new-item days in the baseline).
 * - An open episode does not age out: once quiet, a connector stays quiet
 *   until new items arrive, even after its baseline leaves the 60-day record.
 */

import { assertNever } from "../lib/invariant.js";
import { addDays, type ActivityFile, type ConnectorDay, type ConnectorEpisode } from "./activity.js";

const BASELINE_DAYS = 28;
const MIN_HISTORY_DAYS = 21;
const MIN_PRODUCING_SHARE = 0.6;
const MIN_ALLOWED_QUIET_DAYS = 2;
const MIN_FAILING_DAYS = 2;

export type ConnectorVerdict =
  | { kind: "healthy" }
  | { kind: "unwatched" }
  | {
      kind: "quiet";
      since: string;
      quietDays: number;
      /** Quiet run days this connector's own baseline allows; null once the baseline has aged out. */
      allowedDays: number | null;
    }
  | { kind: "failing"; since: string; failingDays: number; lastError: string };

interface VerdictInput {
  days: Record<string, ConnectorDay>;
  /** Box-local `YYYY-MM-DD`; days after it are ignored. */
  today: string;
  /** The stored episode, so an open one continues instead of aging out. */
  openEpisode: Pick<ConnectorEpisode, "kind" | "since"> | null;
}

type Entry = [day: string, record: ConnectorDay];

/** The trailing entries that satisfy `matches`, oldest first; stops at the first that doesn't. */
function trailing(entries: Entry[], matches: (record: ConnectorDay) => boolean): Entry[] {
  const out: Entry[] = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry === undefined || !matches(entry[1])) break;
    out.unshift(entry);
  }
  return out;
}

/** Allowed quiet run days from the 28 calendar days before `since`, or null when not a steady producer. */
function allowedQuietDays(runDays: Entry[], since: string): number | null {
  const oldest = runDays[0]?.[0];
  if (oldest === undefined || oldest > addDays(since, -MIN_HISTORY_DAYS)) return null;
  const start = addDays(since, -BASELINE_DAYS);
  const baseline = runDays.filter(([day]) => day >= start && day < since);
  const producing = baseline.filter(([, record]) => record.newItems > 0).length;
  if (producing < Math.ceil(BASELINE_DAYS * MIN_PRODUCING_SHARE)) return null;
  let longestGap = 0;
  let gap = 0;
  for (const [, record] of baseline) {
    if (record.ok === 0) continue;
    gap = record.newItems === 0 ? gap + 1 : 0;
    longestGap = Math.max(longestGap, gap);
  }
  return Math.max(MIN_ALLOWED_QUIET_DAYS, 2 * longestGap);
}

/** Continue an open episode of the same kind: keep its start day. */
function episodeSince(input: VerdictInput, computed: Pick<ConnectorEpisode, "kind" | "since">): string {
  const open = input.openEpisode;
  return open !== null && open.kind === computed.kind && open.since < computed.since ? open.since : computed.since;
}

export function connectorVerdict(input: VerdictInput): ConnectorVerdict {
  const runDays = Object.entries(input.days)
    .filter(([day, record]) => day <= input.today && record.runs > 0)
    .toSorted(([a], [b]) => a.localeCompare(b));

  const failing = trailing(runDays, (record) => record.errored === record.runs);
  const lastFailing = failing.at(-1);
  if (failing.length >= MIN_FAILING_DAYS && lastFailing !== undefined && failing[0] !== undefined) {
    return {
      kind: "failing",
      since: episodeSince(input, { kind: "failing", since: failing[0][0] }),
      failingDays: failing.length,
      lastError: lastFailing[1].lastError ?? "no error message recorded",
    };
  }

  const activeDays = runDays.filter(([, record]) => record.ok > 0);
  const quiet = trailing(activeDays, (record) => record.newItems === 0);
  const firstQuiet = quiet[0];
  if (firstQuiet === undefined) return activeDays.length === 0 ? { kind: "unwatched" } : { kind: "healthy" };

  const stretchStart = firstQuiet[0];
  if (input.openEpisode?.kind === "quiet") {
    return {
      kind: "quiet",
      since: episodeSince(input, { kind: "quiet", since: stretchStart }),
      quietDays: quiet.length,
      allowedDays: allowedQuietDays(runDays, stretchStart),
    };
  }
  const allowed = allowedQuietDays(runDays, stretchStart);
  if (allowed === null) return { kind: "unwatched" };
  if (quiet.length <= allowed) return { kind: "healthy" };
  return { kind: "quiet", since: stretchStart, quietDays: quiet.length, allowedDays: allowed };
}

/**
 * The stored episode after this verdict: unchanged while the same episode
 * continues (so its notification and dismissal stick), fresh when a new one
 * starts, and gone when the condition clears.
 */
export function nextEpisode(previous: ConnectorEpisode | null, verdict: ConnectorVerdict): ConnectorEpisode | null {
  if (verdict.kind === "healthy" || verdict.kind === "unwatched") return null;
  if (previous !== null && previous.kind === verdict.kind && previous.since === verdict.since) return previous;
  return { kind: verdict.kind, since: verdict.since, notifiedAt: null, dismissedAt: null };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** One line for the boxholder, used by both the notification and the dashboard. */
export function describeVerdict(connector: string, verdict: ConnectorVerdict): string | null {
  switch (verdict.kind) {
    case "healthy":
    case "unwatched":
      return null;
    case "quiet": {
      const usual = verdict.allowedDays === null
        ? ""
        : ` (more than ${plural(verdict.allowedDays, "day")} without something new is unusual for it)`;
      return `${connector} has brought in nothing new on its last ${plural(verdict.quietDays, "day")} of syncing since ${verdict.since}${usual}. Syncs are still succeeding, so check whether a filter, permission or upstream change stopped it.`;
    }
    case "failing":
      return `${connector} has failed every sync on its last ${plural(verdict.failingDays, "day")} of running, since ${verdict.since}: ${verdict.lastError}`;
    default:
      return assertNever(verdict);
  }
}

export interface ConnectorEpisodeState {
  connector: string;
  verdict: ConnectorVerdict;
  /** The stored episode after this verdict; null when nothing is wrong. */
  episode: ConnectorEpisode | null;
}

/** Every connector's verdict and resulting episode, computed from one read of the record. */
export function evaluateConnectors(file: ActivityFile, today: string): ConnectorEpisodeState[] {
  return Object.entries(file.connectors)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([connector, activity]) => {
      const verdict = connectorVerdict({ days: activity.days, today, openEpisode: activity.episode });
      return { connector, verdict, episode: nextEpisode(activity.episode, verdict) };
    });
}

/** The record with every connector's stored episode brought up to date. */
export function withEpisodes(file: ActivityFile, states: readonly ConnectorEpisodeState[]): ActivityFile {
  const connectors = { ...file.connectors };
  for (const { connector, episode } of states) {
    const activity = connectors[connector];
    if (activity !== undefined) connectors[connector] = { ...activity, episode };
  }
  return { ...file, connectors };
}
