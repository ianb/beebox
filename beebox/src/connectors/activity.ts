/**
 * The connector activity record: per connector, per box-local day, what its
 * syncs did. It exists so a connector that stops producing can be told apart
 * from a quiet week (`activity-verdict.ts` reads it).
 *
 * Nothing else keeps this history. A sync's result is printed and dropped, and
 * connector commits do not separate new items from refreshes — a production
 * box went five days importing no new mail while its Gmail connector kept
 * committing refreshes of tracked threads, and every surface looked healthy.
 *
 * The record is machine-local transient state
 * (`_bookkeeping/connectors/connector-activity.state.json`). Losing it only
 * restarts the baseline: the verdict watches nothing until history rebuilds,
 * so a lost file can delay an alert but never cause a false one.
 */

import { z } from "zod";
import { loadBoxTimezone } from "../core/box/config.js";
import { errorMessage } from "../lib/error-guards.js";
import { getBoxTime } from "../lib/time.js";
import type { Connector, SyncResult } from "./index.js";
import { loadTransientState, transientStatePath, updateTransientState } from "./transient-state.js";

const STATE_NAME = "connector-activity";

/** Days of history kept per connector. The verdict's baseline needs 28 plus the quiet stretch. */
export const ACTIVITY_RETENTION_DAYS = 60;

/** A kept error is read by a person on the dashboard, not parsed. */
const LAST_ERROR_MAX_CHARS = 300;

const count = z.number().int().nonnegative();
const dayKey = z.iso.date();

const connectorDaySchema = z.strictObject({
  /** sync() attempts, including ones that threw. */
  runs: count,
  /** Attempts that succeeded with no error and were not skipped. */
  ok: count,
  /** New top-level cards: `created` paths outside any `.attach/` scope. */
  newItems: count,
  /** Raw `created` count, kept for diagnosis. */
  created: count,
  updated: count,
  /** Attempts that threw or returned `error`. */
  errored: count,
  skipped: count,
  lastError: z.string().nullable(),
});

const episodeSchema = z.strictObject({
  kind: z.enum(["quiet", "failing"]),
  /** First box-local day of the episode. */
  since: dayKey,
  notifiedAt: z.iso.datetime().nullable(),
  dismissedAt: z.iso.datetime().nullable(),
});

const connectorActivitySchema = z.strictObject({
  days: z.record(dayKey, connectorDaySchema),
  /** The open quiet/failing episode, if any — the alert latch. */
  episode: episodeSchema.nullable(),
});

const activityFileSchema = z.strictObject({
  version: z.literal(1),
  connectors: z.record(z.string(), connectorActivitySchema),
});

export type ConnectorDay = z.infer<typeof connectorDaySchema>;
export type ConnectorEpisode = z.infer<typeof episodeSchema>;
export type ActivityFile = z.infer<typeof activityFileSchema>;

const EMPTY_FILE: ActivityFile = { version: 1, connectors: {} };

/**
 * The activity file exists but does not match its schema — a hand edit or a
 * file from a future version. Reported, never silently reset: resetting would
 * also discard an open episode's dismissal.
 */
export class ConnectorActivityInvalidError extends Error {
  constructor(filePath: string, detail: string) {
    super(`Connector activity record at ${filePath} is invalid: ${detail}`);
    this.name = "ConnectorActivityInvalidError";
  }
}

function parseActivityFile(boxRoot: string, raw: unknown): ActivityFile {
  const parsed = activityFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConnectorActivityInvalidError(transientStatePath(boxRoot, STATE_NAME), z.prettifyError(parsed.error));
  }
  return parsed.data;
}

export async function loadConnectorActivity(boxRoot: string): Promise<ActivityFile> {
  const raw = await loadTransientState<unknown>({ boxRoot, connectorName: STATE_NAME, defaultValue: EMPTY_FILE });
  return parseActivityFile(boxRoot, raw);
}

/** Read-modify-write the activity file under the transient-state locks. */
export async function updateConnectorActivity(
  boxRoot: string,
  update: (file: ActivityFile) => ActivityFile,
): Promise<ActivityFile> {
  const updated = await updateTransientState<unknown>({
    boxRoot,
    connectorName: STATE_NAME,
    defaultValue: EMPTY_FILE,
    update: (raw) => update(parseActivityFile(boxRoot, raw)),
  });
  return parseActivityFile(boxRoot, updated);
}

/** The box-local calendar day `now` falls on, as `YYYY-MM-DD`. */
export async function boxLocalDay(boxRoot: string, now: Date): Promise<string> {
  const timeZone = (await loadBoxTimezone(boxRoot)) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** `day` shifted by `delta` calendar days. Day keys are plain dates, so UTC arithmetic is exact. */
export function addDays(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** A new item is a new top-level card; files inside an `.attach/` scope belong to a card that already counted. */
export function countNewItems(created: readonly string[]): number {
  return created.filter((p) => !p.split(/[/\\]/).some((segment) => segment.endsWith(".attach"))).length;
}

type Attempt = { kind: "returned"; result: SyncResult } | { kind: "threw"; error: string };

const EMPTY_DAY: ConnectorDay = {
  runs: 0, ok: 0, newItems: 0, created: 0, updated: 0, errored: 0, skipped: 0, lastError: null,
};

function addAttempt(day: ConnectorDay, attempt: Attempt): ConnectorDay {
  const next = { ...day, runs: day.runs + 1 };
  if (attempt.kind === "threw") {
    return { ...next, errored: next.errored + 1, lastError: attempt.error.slice(0, LAST_ERROR_MAX_CHARS) };
  }
  const { result } = attempt;
  // Counts are kept even for a run that also errored: Gmail can import mail and
  // then fail a draft upload in the same sync.
  const counted = {
    ...next,
    newItems: next.newItems + countNewItems(result.created),
    created: next.created + result.created.length,
    updated: next.updated + result.updated.length,
  };
  if (result.error !== undefined || !result.success) {
    const error = result.error ?? "sync reported failure without an error message";
    return { ...counted, errored: counted.errored + 1, lastError: error.slice(0, LAST_ERROR_MAX_CHARS) };
  }
  if (result.skipped !== undefined) return { ...counted, skipped: counted.skipped + 1 };
  return { ...counted, ok: counted.ok + 1 };
}

function recordAttempt(file: ActivityFile, input: { name: string; today: string; attempt: Attempt }): ActivityFile {
  const { name, today, attempt } = input;
  const existing = file.connectors[name] ?? { days: {}, episode: null };
  const oldest = addDays(today, -(ACTIVITY_RETENTION_DAYS - 1));
  const days = Object.fromEntries(Object.entries(existing.days).filter(([day]) => day >= oldest));
  days[today] = addAttempt(days[today] ?? EMPTY_DAY, attempt);
  return { ...file, connectors: { ...file.connectors, [name]: { ...existing, days } } };
}

async function record(connector: Connector, input: { boxRoot: string; now: Date; attempt: Attempt }): Promise<void> {
  const { boxRoot, now, attempt } = input;
  try {
    const today = await boxLocalDay(boxRoot, now);
    await updateConnectorActivity(boxRoot, (file) => recordAttempt(file, { name: connector.name, today, attempt }));
  } catch (e) {
    // The sync itself is done and its result is real; losing this attempt costs
    // at most a delayed alert (thin history is never watched). A person still
    // needs to know the record is not being kept.
    console.error(`[connector-activity] could not record ${connector.name} sync for ${boxRoot}: ${errorMessage(e)}`);
  }
}

/**
 * Run one connector sync and record what it did. Every caller that syncs a
 * connector goes through here, so the activity record sees each attempt once.
 * A sync that throws is recorded and rethrown unchanged.
 */
export async function syncConnector(connector: Connector, opts: { boxRoot: string; now?: Date }): Promise<SyncResult> {
  const now = opts.now ?? getBoxTime(opts.boxRoot);
  let result: SyncResult;
  try {
    result = await connector.sync();
  } catch (e) {
    await record(connector, { boxRoot: opts.boxRoot, now, attempt: { kind: "threw", error: errorMessage(e) } });
    throw e;
  }
  await record(connector, { boxRoot: opts.boxRoot, now, attempt: { kind: "returned", result } });
  return result;
}
