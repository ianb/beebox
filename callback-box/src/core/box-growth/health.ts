import * as fs from "node:fs/promises";
import * as path from "node:path";
import { writeFileAtomic } from "../../lib/atomic-write.js";
import { withCardLock } from "../../lib/card-lock.js";
import { errnoCode, errorMessage } from "../../lib/error-guards.js";
import { requestScopedLock, withFileLock } from "../../lib/file-lock.js";
import {
  boxGrowthStateSchema,
  type BoxGrowthState,
  type BoxGrowthStateRead,
  type GrowthFinding,
  type GrowthMeasurement,
} from "./model.js";
import { scanBoxGrowth } from "./scan.js";
import { BOX_GROWTH_THRESHOLDS, evaluateBoxGrowth } from "./policy.js";

export { BOX_GROWTH_THRESHOLDS, evaluateBoxGrowth } from "./policy.js";

export type {
  BoxGrowthState,
  BoxGrowthStateRead,
  GrowthCounts,
  GrowthFinding,
  GrowthFindingKind,
  GrowthHistory,
  GrowthMeasurement,
  SubtreeCounts,
} from "./model.js";

export const BOX_GROWTH_STATE_FILENAME = "box-growth-health.json";
export const BOX_GROWTH_MEASUREMENT_INTERVAL_MS = 60 * 60 * 1000;
export const BOX_GROWTH_STALE_MS = 26 * 60 * 60 * 1000;

export function boxGrowthStatePath(boxRoot: string): string {
  return path.join(boxRoot, ".callback-box", BOX_GROWTH_STATE_FILENAME);
}

export function boxGrowthLockPath(boxRoot: string): string {
  return path.join(boxRoot, ".callback-box", "box-growth-health.lock");
}

export interface BoxGrowthHealthResult {
  name: "box-growth";
  ok: boolean;
  message: string;
  severity: "warning";
  action?: "accept-box-growth";
}

export class BoxGrowthAcceptanceError extends Error {
  constructor() {
    super("Box growth has no current measurement to accept");
    this.name = "BoxGrowthAcceptanceError";
  }
}

class BoxGrowthStateInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoxGrowthStateInvalidError";
  }
}

export type MeasureBoxGrowthResult =
  | { status: "skipped"; reason: "not-due" | "invalid-state"; state: BoxGrowthStateRead }
  | { status: "measured"; state: BoxGrowthState; findings: GrowthFinding[]; notice: string | null }
  | { status: "failed"; error: string; state: BoxGrowthStateRead };

const lastAttemptByBox = new Map<string, number>();

async function readStateFile(boxRoot: string): Promise<BoxGrowthStateRead> {
  const statePath = boxGrowthStatePath(boxRoot);
  let raw: string;
  try {
    raw = await fs.readFile(statePath, "utf-8");
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return { status: "missing" };
    return { status: "invalid", error: `Could not read growth state: ${errorMessage(error)}` };
  }
  try {
    const parsed = boxGrowthStateSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
    return { status: "invalid", error: `Invalid growth state: ${parsed.error.message}` };
  } catch (error) {
    return { status: "invalid", error: `Invalid growth state JSON: ${errorMessage(error)}` };
  }
}

export async function readBoxGrowthState(boxRoot: string): Promise<BoxGrowthStateRead> {
  return readStateFile(boxRoot);
}

async function writeState(boxRoot: string, state: BoxGrowthState): Promise<void> {
  const validated = boxGrowthStateSchema.parse(state);
  await writeFileAtomic(boxGrowthStatePath(boxRoot), {
    content: `${JSON.stringify(validated, null, 2)}\n`,
  });
}

async function updateState<T>(boxRoot: string, fn: (state: BoxGrowthStateRead) => Promise<T>): Promise<T> {
  const statePath = boxGrowthStatePath(boxRoot);
  const lockPath = requestScopedLock(boxGrowthLockPath(boxRoot));
  return withCardLock(statePath, () =>
    withFileLock(
      { lockPath, metadata: { purpose: "box-growth-health-state" }, waitMs: 5_000 },
      async () => fn(await readStateFile(boxRoot)),
    ),
  );
}

export async function measureBoxGrowth(
  boxRoot: string,
  options: { now: Date; maxDurationMs?: number },
): Promise<GrowthMeasurement> {
  return scanBoxGrowth(boxRoot, { now: options.now, maxDurationMs: options.maxDurationMs ?? 10_000 });
}

function isAboveGlobalThreshold(measurement: GrowthMeasurement): boolean {
  return (
    measurement.counts.directories > BOX_GROWTH_THRESHOLDS.absoluteDirectories ||
    measurement.counts.files > BOX_GROWTH_THRESHOLDS.absoluteFiles
  );
}

function persistedAttemptTime(state: BoxGrowthStateRead): number | null {
  if (state.status !== "measured" && state.status !== "unmeasured") return null;
  return state.lastAttemptAt === null ? null : Date.parse(state.lastAttemptAt);
}

function resetNotice(state: BoxGrowthStateRead, hadPriorProcessAttempt: boolean): string | null {
  if (state.status === "missing" && hadPriorProcessAttempt) {
    return "Box growth state disappeared after this scheduler previously measured the box; a new baseline was created";
  }
  return null;
}

async function recordScanFailure(input: {
  boxRoot: string;
  before: BoxGrowthStateRead;
  now: Date;
  message: string;
}): Promise<MeasureBoxGrowthResult> {
  const { boxRoot, before, now, message } = input;
  try {
    return await updateState(boxRoot, async (latest) => {
      if (latest.status === "invalid") throw new BoxGrowthStateInvalidError(latest.error);
      const state: BoxGrowthState = latest.status === "measured"
        ? { ...latest, lastAttemptAt: now.toISOString(), lastError: message }
        : { version: 1, status: "unmeasured", lastAttemptAt: now.toISOString(), lastError: message };
      await writeState(boxRoot, state);
      return { status: "failed", error: message, state };
    });
  } catch (persistenceError) {
    return {
      status: "failed",
      error: `${message}; could not persist scan failure: ${errorMessage(persistenceError)}`,
      state: before,
    };
  }
}

export async function measureBoxGrowthIfDue(
  boxRoot: string,
  options: { now: Date; maxDurationMs?: number },
): Promise<MeasureBoxGrowthResult> {
  const before = await readStateFile(boxRoot);
  if (before.status === "invalid") {
    return { status: "skipped", reason: "invalid-state", state: before };
  }
  const priorProcessAttempt = lastAttemptByBox.get(boxRoot);
  const attemptedAt = Math.max(persistedAttemptTime(before) ?? 0, priorProcessAttempt ?? 0);
  if (attemptedAt > 0 && options.now.getTime() - attemptedAt < BOX_GROWTH_MEASUREMENT_INTERVAL_MS) {
    return { status: "skipped", reason: "not-due", state: before };
  }
  lastAttemptByBox.set(boxRoot, options.now.getTime());
  let measurement: GrowthMeasurement;
  try {
    measurement = await measureBoxGrowth(boxRoot, options);
  } catch (error) {
    return recordScanFailure({ boxRoot, before, now: options.now, message: errorMessage(error) });
  }
  try {
    return await updateState(boxRoot, async (latest) => {
      if (latest.status === "invalid") throw new BoxGrowthStateInvalidError(latest.error);
      const notice = resetNotice(latest, priorProcessAttempt !== undefined);
      const state: BoxGrowthState = latest.status === "measured"
        ? {
            ...latest,
            previous: latest.current,
            current: measurement,
            lastAttemptAt: measurement.measuredAt,
            lastError: null,
            lastNotice: latest.lastNotice,
          }
        : {
            version: 1,
            status: "measured",
            accepted: measurement,
            previous: measurement,
            current: measurement,
            acknowledgedAt: isAboveGlobalThreshold(measurement) ? null : measurement.measuredAt,
            lastAttemptAt: measurement.measuredAt,
            lastError: null,
            lastNotice: notice,
          };
      await writeState(boxRoot, state);
      const findings = evaluateBoxGrowth({ ...state });
      return { status: "measured", state, findings, notice };
    });
  } catch (error) {
    return {
      status: "failed",
      error: `Box growth measurement could not be persisted: ${errorMessage(error)}`,
      state: before,
    };
  }
}

export async function acceptCurrentBoxGrowth(
  boxRoot: string,
  options: { now: Date },
): Promise<BoxGrowthState> {
  return updateState(boxRoot, async (latest) => {
    if (latest.status !== "measured") throw new BoxGrowthAcceptanceError();
    const state: BoxGrowthState = {
      ...latest,
      accepted: latest.current,
      previous: latest.current,
      current: latest.current,
      acknowledgedAt: options.now.toISOString(),
      lastNotice: null,
    };
    await writeState(boxRoot, state);
    return state;
  });
}

function healthy(message: string): BoxGrowthHealthResult {
  return { name: "box-growth", ok: true, message, severity: "warning" };
}

function warning(message: string, action?: boolean): BoxGrowthHealthResult {
  return { name: "box-growth", ok: false, message, severity: "warning", ...(action ? { action: "accept-box-growth" as const } : {}) };
}

function count(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function describeFinding(finding: GrowthFinding): string {
  const pathDetail = finding.path === undefined ? "" : `; largest contributor: ${finding.path}`;
  if (finding.kind === "absolute-directories") {
    return `${count(finding.actual)} directories total (limit ${count(finding.threshold)})${pathDetail}`;
  }
  if (finding.kind === "absolute-files") {
    return `${count(finding.actual)} files total (limit ${count(finding.threshold)})${pathDetail}`;
  }
  if (finding.kind === "rate-commits") {
    return `${count(finding.actual)} commits/hour (limit ${count(finding.threshold)})`;
  }
  const unit = finding.kind.endsWith("directories") ? "directories" : "files";
  const connector = finding.kind.startsWith("rate-connector");
  const scope = connector ? finding.path ?? "connector subtree" : "box";
  const detail = connector || finding.path === undefined ? "" : `; fastest subtree: ${finding.path}`;
  return `${scope} grew by ${count(finding.actual)} ${unit}/hour (limit ${count(finding.threshold)})${detail}`;
}

export async function boxGrowthHealthCheck(
  boxRoot: string,
  options: { now: Date; schedulerStatus: "running" | "stale" | "never" },
): Promise<BoxGrowthHealthResult> {
  const state = await readStateFile(boxRoot);
  if (state.status === "missing") {
    return options.schedulerStatus === "never"
      ? healthy("Box growth monitoring has never run")
      : warning("Box growth monitoring has not published a measurement");
  }
  if (state.status === "invalid") return warning(state.error);
  if (state.status === "unmeasured") {
    return warning(state.lastError === null ? "Box growth has not been measured" : `Box growth scan failed: ${state.lastError}`);
  }
  if (options.now.getTime() - Date.parse(state.lastAttemptAt) > BOX_GROWTH_STALE_MS) {
    return warning("Box growth measurement is stale");
  }
  const findings = evaluateBoxGrowth({ ...state });
  const historyError = state.current.history.status === "unavailable" ? state.current.history.error : null;
  if (findings.length === 0 && state.lastError === null && state.lastNotice === null) {
    return healthy(
      historyError === null
        ? "Box growth is within accepted limits"
        : "Box growth is within accepted limits; Git history measurement is unavailable",
    );
  }
  const parts = findings.map(describeFinding);
  if (state.lastError !== null) parts.push(`latest scan failed: ${state.lastError}`);
  if (state.lastNotice !== null) parts.push(state.lastNotice);
  if (historyError !== null && findings.length > 0) parts.push(`history measurement failed: ${historyError}`);
  return warning(`Box growth warning: ${parts.join("; ")}`, findings.length > 0 || state.lastNotice !== null);
}
