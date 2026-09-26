/**
 * Schedule memory: what a scheduled `runs:` command knows about its own
 * previous run. The change cursor (`lastCommit`, the box HEAD when the
 * schedule last ran) and one carried value (`carry`) live in the schedule's
 * machine-local state, never in git. Each run sees them as environment
 * variables, gets a file to write the next carry to, and gets a fresh path for
 * a defer marker. See docs/plans/notifications.md (Track D).
 *
 * - `BBX_SINCE_COMMIT`: the cursor. Set to HEAD before a schedule's first run,
 *   so the first run sees no changes: a schedule is about the future.
 * - `BBX_SINCE_TIME`: the previous run's time, empty on the first run.
 * - `BBX_CARRY_IN` / `BBX_CARRY_OUT`: the carried value, and a file the run
 *   may write the next one to. An absent or empty file keeps the old value.
 * - `BBX_DEFER_FILE`: where `bbx changes --or-skip` (and later `bbx judge`)
 *   write `{ "reason": ... }` before exiting 75.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { getHead, hasCommits } from "../../lib/git.js";
import { errnoCode, errorMessage } from "../../lib/error-guards.js";
import { saveScriptState, type ScriptState } from "./state.js";
import { DEFER_REASONS, type DeferReason } from "./defer-reason.js";

/** The five environment names; `script-env-allowlist.ts` lets them through to procedure shells. */
export const MEMORY_ENV = {
  sinceCommit: "BBX_SINCE_COMMIT",
  sinceTime: "BBX_SINCE_TIME",
  carryIn: "BBX_CARRY_IN",
  carryOut: "BBX_CARRY_OUT",
  deferFile: "BBX_DEFER_FILE",
} as const;

const DeferMarkerSchema = z.object({ reason: z.enum(DEFER_REASONS) });

/** The largest carry kept, in UTF-8 bytes. */
export const CARRY_MAX_BYTES = 4096;

export interface RunMemory {
  env: Record<string, string>;
  carryOutPath: string;
  deferFilePath: string;
  /** Remove the run's temporary files. */
  dispose(): Promise<void>;
}

/**
 * Initialize and save the cursor before a schedule's first run, and lay out
 * this run's environment and files. A box with no commits yet has no HEAD, so
 * its cursor stays unset until one exists.
 */
export async function prepareRunMemory(
  boxRoot: string,
  { state, scriptName }: { state: ScriptState; scriptName: string },
): Promise<RunMemory> {
  if (state.lastCommit === null && (await hasCommits(boxRoot))) {
    state.lastCommit = await getHead(boxRoot);
    await saveScriptState({ boxRoot, scriptName, state });
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-schedule-"));
  const carryOutPath = path.join(dir, "carry-out");
  const deferFilePath = path.join(dir, "defer.json");
  const env: Record<string, string> = {
    [MEMORY_ENV.sinceTime]: state.lastRun ?? "",
    [MEMORY_ENV.carryIn]: state.carry ?? "",
    [MEMORY_ENV.carryOut]: carryOutPath,
    [MEMORY_ENV.deferFile]: deferFilePath,
  };
  if (state.lastCommit !== null) env[MEMORY_ENV.sinceCommit] = state.lastCommit;
  return {
    env,
    carryOutPath,
    deferFilePath,
    dispose: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

/** A file's text, or null when it does not exist. */
async function readIfPresent(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
}

/** Cut at a byte limit without splitting a UTF-8 sequence. */
function truncateUtf8(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf-8");
  if (bytes.length <= maxBytes) return text;
  let end = maxBytes;
  // Back up over continuation bytes (0b10xxxxxx) so the cut lands on a character boundary.
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString("utf-8");
}

/**
 * Write the marker a skipping command leaves before exiting 75. The first
 * marker of a run wins: in `bbx changes --or-skip | bbx judge --or-skip`, the
 * judge sees empty stdin because nothing changed, and `no-change` is the
 * reason the run should record. Returns whether this marker was the one written.
 */
export async function writeDeferMarker(filePath: string, reason: DeferReason): Promise<boolean> {
  try {
    await fs.writeFile(filePath, `${JSON.stringify({ reason })}\n`, { flag: "wx" });
    return true;
  } catch (e) {
    if (errnoCode(e) !== "EEXIST") throw e;
    return false;
  }
}

/** The reason in a run's defer marker, or null when it wrote none (or an unreadable one, with a warning). */
export async function readDeferMarker(filePath: string): Promise<DeferReason | null> {
  const text = await readIfPresent(filePath);
  if (text === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    console.warn(`  Ignoring an unreadable defer marker: ${errorMessage(e)}`);
    return null;
  }
  const parsed = DeferMarkerSchema.safeParse(json);
  if (!parsed.success) {
    console.warn(`  Ignoring a defer marker with no known reason: ${text.slice(0, 200)}`);
    return null;
  }
  return parsed.data.reason;
}

/**
 * Whether a run's outcome moves the cursor to HEAD. `success` does, and so
 * does a deferral whose items were seen (`no-change`, `no-pass`). A failure,
 * and a deferral for budget, an unavailable judge, or missing configuration,
 * hold it, so the next run sees the same items and nothing is dropped.
 */
export function cursorAdvances(result: NonNullable<ScriptState["lastResult"]>, reason: DeferReason | null): boolean {
  switch (result) {
    case "success":
      return true;
    case "deferred":
      return reason === "no-change" || reason === "no-pass";
    case "failure":
    case "inconclusive":
      return false;
  }
}

/**
 * After a run: take the carry the run wrote (truncated to 4 KB with a warning
 * line), and advance the cursor when the recorded outcome (and its defer
 * reason) says so. Mutates `state`; the caller saves it.
 */
export async function finishRunMemory(
  boxRoot: string,
  opts: { memory: RunMemory; state: ScriptState; scriptName: string },
): Promise<void> {
  const { memory, state, scriptName } = opts;
  const carry = await readIfPresent(memory.carryOutPath);
  if (carry !== null && carry !== "") {
    const kept = truncateUtf8(carry, CARRY_MAX_BYTES);
    if (kept !== carry) {
      const size = Buffer.byteLength(carry, "utf-8");
      console.warn(`  ${scriptName}: carry of ${String(size)} bytes truncated to ${String(CARRY_MAX_BYTES)}`);
    }
    state.carry = kept;
  }
  const result = state.lastResult;
  if (result === null) return;
  if (cursorAdvances(result, state.lastDeferReason) && (await hasCommits(boxRoot))) {
    state.lastCommit = await getHead(boxRoot);
  }
}
