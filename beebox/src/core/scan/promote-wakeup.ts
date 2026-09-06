/**
 * The scan pipeline's durable wakeup trigger (Track 3 of
 * `docs/plans/scanner-ingest.md`).
 *
 * `scan-import` ends at an intake job; jobs drain only when something runs
 * `bbx wakeup`. Two facts make a fire-and-forget spawn unacceptable here:
 * connector-scoped scheduled wakeups filter jobs by `source`, so a `source:
 * scan` job never drains on the prod default schedules — a lost run is
 * indefinite, not late — and wakeup as a whole is not locked, so nothing else
 * would notice the gap. Hence a marker file written BEFORE the run and cleared
 * only after a zero-exit run, with every promote pass retrying a marker it
 * finds. The marker lives beside the sidecars, so it survives restarts exactly
 * as the quarantine state machine does.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../../lib/error-guards.js";
import { getBoxTimeISO } from "../../lib/time.js";
import { runBbxWakeup } from "../commands/wakeup.js";
import { ensureQuarantineDir, quarantineDir } from "./quarantine.js";
import {
  clearWakeupAbandoned,
  clearWakeupFailures,
  decideWakeupRetry,
  isWakeupAbandoned,
  MAX_WAKEUP_ATTEMPTS,
  recordWakeupAbandoned,
  recordWakeupFailure,
} from "./wakeup-retry.js";

/** Not a `.json` file, so `readAllQuarantineEntries` never sees it as an entry. */
const MARKER_FILENAME = "wakeup-pending";

export function wakeupMarkerPath(boxRoot: string): string {
  return path.join(quarantineDir(boxRoot), MARKER_FILENAME);
}

/**
 * Record that a wakeup is owed. Idempotent: the newest reason wins.
 *
 * New files entering promote are new information, so the retry budget starts
 * over — including after an abandonment. Otherwise one permanently-broken
 * connector would silently strand every future scan on the box.
 */
export async function markWakeupPending(boxRoot: string, reason: string): Promise<void> {
  await ensureQuarantineDir(boxRoot);
  await fs.writeFile(wakeupMarkerPath(boxRoot), `${getBoxTimeISO(boxRoot)} ${reason}\n`);
  await clearWakeupFailures(boxRoot);
  await clearWakeupAbandoned(boxRoot);
}

/** The pending marker's contents, or null when no wakeup is owed. */
async function readWakeupMarker(boxRoot: string): Promise<string | null> {
  try {
    return (await fs.readFile(wakeupMarkerPath(boxRoot), "utf-8")).trim();
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
}

async function clearWakeupMarker(boxRoot: string): Promise<void> {
  await fs.rm(wakeupMarkerPath(boxRoot), { force: true });
}

/** Run one full `bbx wakeup` for the box. Injected in tests. */
export type WakeupRunner = (opts: { boxRoot: string }) => Promise<{ ok: boolean; detail: string }>;

/** The real runner: a supervised `bbx wakeup` child, awaited, output captured. */
export const spawnBbxWakeup: WakeupRunner = async ({ boxRoot }) => {
  const result = await runBbxWakeup({ boxRoot, triggeredBy: "scan-promote" });
  return { ok: result.ok, detail: result.ok ? "" : `${result.detail}\n${result.output}`.trim() };
};

/** Where a caller should look when a wakeup has been abandoned. */
const wakeupAbandonedRelPath = "_tmp/scan-quarantine/wakeup-abandoned";

/**
 * What one pass did about the owed wakeup. `failed` carries how long the
 * caller should wait before the next attempt; `abandoned` means the budget is
 * spent and the caller must NOT re-arm — that re-arm is the loop this
 * vocabulary exists to end.
 */
export type WakeupOutcome =
  | { kind: "ran" }
  | { kind: "not-needed" }
  | { kind: "abandoned" }
  | { kind: "failed"; retryDelayMs: number };

/**
 * Run the owed wakeup, if one is owed, clearing the marker only on success.
 * Returns what happened so the caller can report it without re-reading disk.
 */
export async function runPendingWakeup(opts: {
  boxRoot: string;
  runWakeup: WakeupRunner;
}): Promise<WakeupOutcome> {
  const { boxRoot, runWakeup } = opts;
  const marker = await readWakeupMarker(boxRoot);
  if (marker === null) return { kind: "not-needed" };
  // The budget is spent and no new files have arrived since. Retrying would
  // re-enter the loop the budget exists to stop.
  if (await isWakeupAbandoned(boxRoot)) return { kind: "abandoned" };

  const result = await runWakeup({ boxRoot });
  if (result.ok) {
    await clearWakeupMarker(boxRoot);
    await clearWakeupFailures(boxRoot);
    return { kind: "ran" };
  }

  const failures = await recordWakeupFailure(boxRoot);
  const decision = decideWakeupRetry(failures);
  if (decision.kind === "abandon") {
    await recordWakeupAbandoned(boxRoot, { failures, detail: result.detail });
    console.error(
      `[scan] bbx wakeup after promote failed ${String(failures)} time(s); giving up. ` +
        "The intake job stays undrained until this is fixed and " +
        `${wakeupAbandonedRelPath} is removed: ${result.detail}`,
    );
    return { kind: "abandoned" };
  }
  // The marker IS the retry: the next promote pass, debounced or at startup,
  // picks it up. The caller schedules that pass `delayMs` from now.
  console.error(
    `[scan] bbx wakeup after promote failed (attempt ${String(failures)} of ` +
      `${String(MAX_WAKEUP_ATTEMPTS)}, retrying in ${String(Math.round(decision.delayMs / 1000))}s): ${result.detail}`,
  );
  return { kind: "failed", retryDelayMs: decision.delayMs };
}
