/**
 * How alerts close: a schedule resolving its conditions, a person
 * acknowledging, and the one-time rewrite of records from before conditions.
 *
 * Design: beebox/docs/plans/schedule-alert-signal.md (Track A).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";

import { errnoCode } from "../../beebox/src/lib/error-guards.js";
import { alertSchema, type Alert, type ClosedBy } from "./schedules.js";
import { readAlerts, writeAlert } from "./schedules-store.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A condition open this long is filed as an issue (`file-standing`). */
export const FILE_AFTER_MS = 7 * DAY_MS;

/** Filing retries daily for this long after its first failure, then stops and
 *  the digest reports it as unfiled — nothing retries forever. */
export const FILING_RETRY_MS = 7 * DAY_MS;

/** Close an open alert, saying who closed it. */
export function closeAlert(alert: Alert, input: { closedBy: ClosedBy; at: string }): Alert {
  return { ...alert, state: "acknowledged", acknowledgedAt: input.at, closedBy: input.closedBy };
}

export interface ResolveSelection {
  /** Only these conditions; empty = every condition. */
  conditions: readonly string[];
  /** Every condition but these. */
  except: readonly string[];
}

/** Which open, conditioned alerts a `resolve` closes. One-off alerts
 *  (condition null) are never touched: only a person closes those. */
export function selectResolved(alerts: readonly Alert[], selection: ResolveSelection): Alert[] {
  return alerts.filter((alert) => {
    if (alert.state !== "open" || alert.condition === null) return false;
    if (selection.except.includes(alert.condition)) return false;
    return selection.conditions.length === 0 || selection.conditions.includes(alert.condition);
  });
}

/** `bin/schedules resolve`: the schedule says these conditions cleared. */
export async function resolveConditions(
  storeRoot: string,
  input: ResolveSelection & { workstream: string; at: string },
): Promise<Alert[]> {
  const closing = selectResolved(await readAlerts(storeRoot, input.workstream), input);
  for (const alert of closing) {
    await writeAlert(storeRoot, closeAlert(alert, { closedBy: "schedule", at: input.at }));
  }
  return closing;
}

// ─── Migration ────────────────────────────────────────────────────────────

/** The record shape before conditions (2026-09): what `migrate-alerts` reads.
 *  Only the migration uses it; every other reader is strict on the new shape. */
const legacyAlertSchema = z.strictObject({
  id: z.string(),
  workstream: z.string(),
  runId: z.string().nullable(),
  title: z.string().min(1),
  message: z.string(),
  details: z.string().nullable(),
  priority: z.enum(["important", "normal", "backlog", "fyi"]),
  createdAt: z.string(),
  state: z.enum(["open", "acknowledged"]),
  acknowledgedAt: z.string().nullable(),
});
type LegacyAlert = z.infer<typeof legacyAlertSchema>;

/** A legacy record in the new shape. Every open one is closed: the boxholder
 *  chose to start clean, and a condition that still holds raises again. */
function migrateLegacyAlert(legacy: LegacyAlert, at: string): Alert {
  const open = legacy.state === "open";
  return {
    ...legacy,
    priority: legacy.priority === "backlog" ? "fyi" : legacy.priority,
    state: "acknowledged",
    acknowledgedAt: open ? at : legacy.acknowledgedAt,
    closedBy: "person",
    condition: null,
    lastSeenAt: legacy.createdAt,
    occurrences: 1,
    digestedAt: null,
    issue: null,
    filingFailedSince: null,
    filingError: null,
  };
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).toSorted();
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return [];
    throw e;
  }
}

async function listJson(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter((entry) => entry.endsWith(".json")).toSorted();
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return [];
    throw e;
  }
}

/**
 * Rewrite every legacy alert record in the new shape. Idempotent: a record
 * that already parses is left alone, so a run cut short finishes next time.
 * Reads raw JSON on purpose — the store's reader is strict on the new shape
 * and would throw at the first legacy record. Returns how many it rewrote.
 */
export async function migrateAlerts(storeRoot: string, at: string): Promise<number> {
  let rewritten = 0;
  for (const name of await listDirs(storeRoot)) {
    const dir = path.join(storeRoot, name, "alerts");
    for (const file of await listJson(dir)) {
      const raw: unknown = JSON.parse(await fs.readFile(path.join(dir, file), "utf8"));
      if (alertSchema.safeParse(raw).success) continue;
      await writeAlert(storeRoot, migrateLegacyAlert(legacyAlertSchema.parse(raw), at));
      rewritten += 1;
    }
  }
  return rewritten;
}
