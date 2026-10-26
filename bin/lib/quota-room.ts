/**
 * Quota room: how far each weekly window's use is ahead of or behind the
 * clock, and the Codex reviewer model that `bin/cross-model-run --hard` picks
 * from it. A review without `--hard` runs on Sol whatever the room.
 *
 * Room is elapsed percent minus used percent. Positive room means use is
 * behind the schedule, so a costlier model fits. In the first seventh of a
 * window (a day of a week) the pace is not known yet, so a low use counts as
 * room too.
 *
 * `cross-model-run` appends one ledger row per Codex review with the 7-day
 * use before and after, so the thresholds below can be set from what a review
 * costs. Other Codex work in the same minutes inflates a row; the per-model
 * mean over many rows is the useful number.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { isRecord } from "../../beebox/src/shared/is-record.js";
import type { Quota } from "../../workstreams-app/src/shared/documents.js";

type QuotaWindow = Quota["windows"][number];

export const SOL = "gpt-6-sol";
export const ASTRA = "gpt-6-astra";
const WEEK_MINUTES = 10_080;
/** Room, in percentage points, at which Astra is affordable. */
export const ASTRA_MIN_ROOM = 15;
/** Before this much of a window has elapsed, the pace is unknown. */
export const EARLY_PERCENT = 100 / 7;
/** An early window with at most this much used still picks Astra. */
export const EARLY_MAX_USED = 10;

export interface WindowRoom {
  label: string;
  usedPercent: number;
  elapsedPercent: number;
  /** elapsed minus used, in percentage points. */
  room: number;
  /** Use at reset at the current pace; null until the pace is known. */
  projectedPercent: number | null;
  resetsAt: string;
}

/** Null for a window with no fixed duration, such as an extra-usage line. */
export function windowRoom(window: QuotaWindow, now: Date): WindowRoom | null {
  if (window.durationMinutes === null) return null;
  const durationMs = window.durationMinutes * 60_000;
  const startMs = new Date(window.resetsAt).getTime() - durationMs;
  const elapsedMs = Math.min(Math.max(now.getTime() - startMs, 0), durationMs);
  const elapsedPercent = (elapsedMs / durationMs) * 100;
  return {
    label: window.label,
    usedPercent: window.usedPercent,
    elapsedPercent,
    room: elapsedPercent - window.usedPercent,
    projectedPercent: elapsedPercent < EARLY_PERCENT ? null : (window.usedPercent / elapsedPercent) * 100,
    resetsAt: window.resetsAt,
  };
}

/**
 * The general 7-day window. `parseCodexQuota` prefixes any other pool's label
 * with its name ("<pool> · 7-day window"); the general pool has no prefix.
 */
export function weeklyWindow(quota: Quota): QuotaWindow | null {
  return quota.windows.find((window) => window.durationMinutes === WEEK_MINUTES && !window.label.includes(" · ")) ?? null;
}

export interface ModelPick {
  model: string;
  reason: string;
}

const round = (n: number): string => n.toFixed(0);

/** The model for a hard review: Astra when the weekly window has room. */
export function pickCodexReviewModel(quota: Quota, now: Date): ModelPick {
  const weekly = quota.status === "available" ? weeklyWindow(quota) : null;
  const room = weekly === null ? null : windowRoom(weekly, now);
  if (room === null) return { model: SOL, reason: `no Codex 7-day window (${quota.message ?? quota.status})` };
  const state = `${round(room.usedPercent)}% used, ${round(room.elapsedPercent)}% of the week elapsed`;
  if (room.room >= ASTRA_MIN_ROOM) return { model: ASTRA, reason: `room ${round(room.room)} points: ${state}` };
  if (room.projectedPercent === null && room.usedPercent <= EARLY_MAX_USED) {
    return { model: ASTRA, reason: `pace not known yet in the week's first day: ${state}` };
  }
  return { model: SOL, reason: `room ${round(room.room)} points, under ${ASTRA_MIN_ROOM}: ${state}` };
}

// ── review cost ledger ───────────────────────────────────────────────────────

export const OUTCOMES = ["answered", "failed", "timed-out"] as const;

export interface ReviewCostRow {
  at: string;
  model: string;
  effort: string;
  /** A failed or timed-out review spent quota too. */
  outcome: (typeof OUTCOMES)[number];
  seconds: number;
  usedBefore: number;
  usedAfter: number;
  /** The window's reset time at each reading; different means two windows. */
  resetsBefore: string;
  resetsAfter: string;
}

export function ledgerPath(): string {
  const stateDir = process.env.BBX_STATE_DIR ?? path.join(os.homedir(), ".cache/beebox");
  return path.join(stateDir, "cross-model-quota.jsonl");
}

export function appendReviewCost(file: string, row: ReviewCostRow): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
}

/** A ledger line that is not a review cost row. */
export class LedgerRowError extends Error {
  override name = "LedgerRowError";
  constructor(readonly line: string) {
    super("cross-model quota ledger has a malformed row");
  }
}

function parseRow(line: string): ReviewCostRow {
  const value: unknown = JSON.parse(line);
  if (!isRecord(value)) throw new LedgerRowError(line);
  const { at, model, effort, outcome, seconds, usedBefore, usedAfter, resetsBefore, resetsAfter } = value;
  const knownOutcome = OUTCOMES.find((o) => o === outcome);
  if (typeof at !== "string" || typeof model !== "string" || typeof effort !== "string" || knownOutcome === undefined
    || typeof seconds !== "number" || typeof usedBefore !== "number" || typeof usedAfter !== "number"
    || typeof resetsBefore !== "string" || typeof resetsAfter !== "string") {
    throw new LedgerRowError(line);
  }
  return { at, model, effort, outcome: knownOutcome, seconds, usedBefore, usedAfter, resetsBefore, resetsAfter };
}

export function readReviewCosts(file: string): ReviewCostRow[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter((line) => line.trim() !== "").map(parseRow);
}

export interface ModelCost {
  model: string;
  runs: number;
  meanPoints: number;
}

/**
 * Mean 7-day points per review, by model, failed runs included. A row whose
 * window reset during the run compares two windows and is left out.
 */
export function summarizeCosts(rows: readonly ReviewCostRow[]): ModelCost[] {
  const byModel = new Map<string, number[]>();
  for (const row of rows) {
    if (row.resetsBefore !== row.resetsAfter) continue;
    byModel.set(row.model, [...(byModel.get(row.model) ?? []), row.usedAfter - row.usedBefore]);
  }
  return [...byModel].map(([model, deltas]) => ({
    model,
    runs: deltas.length,
    meanPoints: deltas.reduce((a, b) => a + b, 0) / deltas.length,
  })).toSorted((a, b) => a.model.localeCompare(b.model));
}
