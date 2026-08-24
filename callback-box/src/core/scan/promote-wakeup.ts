/**
 * The scan pipeline's durable wakeup trigger (Track 3 of
 * `docs/plans/scanner-ingest.md`).
 *
 * `scan-import` ends at an intake job; jobs drain only when something runs
 * `cb wakeup`. Two facts make a fire-and-forget spawn unacceptable here:
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
import { runCbWakeup } from "../commands/wakeup.js";
import { ensureQuarantineDir, quarantineDir } from "./quarantine.js";

/** Not a `.json` file, so `readAllQuarantineEntries` never sees it as an entry. */
const MARKER_FILENAME = "wakeup-pending";

export function wakeupMarkerPath(boxRoot: string): string {
  return path.join(quarantineDir(boxRoot), MARKER_FILENAME);
}

/** Record that a wakeup is owed. Idempotent: the newest reason wins. */
export async function markWakeupPending(boxRoot: string, reason: string): Promise<void> {
  await ensureQuarantineDir(boxRoot);
  await fs.writeFile(wakeupMarkerPath(boxRoot), `${getBoxTimeISO(boxRoot)} ${reason}\n`);
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

/** Run one full `cb wakeup` for the box. Injected in tests. */
export type WakeupRunner = (opts: { boxRoot: string }) => Promise<{ ok: boolean; detail: string }>;

/** The real runner: a supervised `cb wakeup` child, awaited, output captured. */
export const spawnCbWakeup: WakeupRunner = async ({ boxRoot }) => {
  const result = await runCbWakeup({ boxRoot, triggeredBy: "scan-promote" });
  return { ok: result.ok, detail: result.ok ? "" : `${result.detail}\n${result.output}`.trim() };
};

/**
 * Run the owed wakeup, if one is owed, clearing the marker only on success.
 * Returns what happened so the caller can report it without re-reading disk.
 */
export async function runPendingWakeup(opts: {
  boxRoot: string;
  runWakeup: WakeupRunner;
}): Promise<"ran" | "failed" | "not-needed"> {
  const { boxRoot, runWakeup } = opts;
  const marker = await readWakeupMarker(boxRoot);
  if (marker === null) return "not-needed";
  const result = await runWakeup({ boxRoot });
  if (!result.ok) {
    // Left deliberately: the marker IS the retry, and the next promote pass
    // (debounced or at startup) picks it up.
    console.error(`[scan] cb wakeup after promote failed (marker kept, will retry): ${result.detail}`);
    return "failed";
  }
  await clearWakeupMarker(boxRoot);
  return "ran";
}
