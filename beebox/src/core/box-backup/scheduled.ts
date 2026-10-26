/** Shared due and quiet policy for host-triggered encrypted backup captures. */
import { boxMaintenanceStatus, boxWorkHolders } from "../../lib/box-maintenance/admission.js";
import { onUnitHost } from "../../lib/unit-host.js";
import { startAwakeTimeout } from "../../shared/awake-timeout.js";
import { toError } from "../../shared/error-guards.js";
import type { BackupAttempt } from "./attempt.js";

const MIN_DAILY_GAP_MS = 20 * 60 * 60 * 1000;
const FAILURE_RETRY_MS = 60 * 60 * 1000;
const QUIET_MS = 10 * 60 * 1000;
const POLL_MS = 30 * 1000;
const MAX_WAIT_MS = 60 * 60 * 1000;

export type ScheduledBackupDecision = "off" | "server-runner-not-enabled" | "recently-verified" | "recent-failure" | "due";

export function scheduledBackupDecision({ schedule, serverAutoEnabled, attempt, unitHost, now }: {
  schedule: "daily" | "off";
  serverAutoEnabled: boolean;
  attempt: BackupAttempt | null;
  unitHost?: boolean;
  now?: number;
}): ScheduledBackupDecision {
  const currentTime = now ?? Date.now();
  if (schedule === "off") return "off";
  if ((unitHost ?? onUnitHost()) && !serverAutoEnabled) return "server-runner-not-enabled";
  if (attempt?.verified) {
    const verifiedTime = Date.parse(attempt.verified.verifiedAt);
    const verifiedDate = new Date(verifiedTime);
    const currentDate = new Date(currentTime);
    const sameCalendarDay = verifiedDate.getFullYear() === currentDate.getFullYear()
      && verifiedDate.getMonth() === currentDate.getMonth()
      && verifiedDate.getDate() === currentDate.getDate();
    if (sameCalendarDay || currentTime - verifiedTime < MIN_DAILY_GAP_MS) return "recently-verified";
  }
  if (attempt?.outcome === "failed" && currentTime - Date.parse(attempt.completedAt) < FAILURE_RETRY_MS) return "recent-failure";
  return "due";
}

export interface ScheduledQuietResult { quiet: boolean; waitedMs: number }
export interface ScheduledQuietOptions {
  boxRoot: string;
  quietMs?: number;
  pollMs?: number;
  maxWaitMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  isBusy?: () => Promise<boolean>;
}

/**
 * Wait for a quiet window before requesting backup maintenance. The probe
 * deliberately takes no box-work lease, because the subsequent capture must
 * drain all such leases. A stale ownerless backup drain can be retried by the
 * backup command itself and therefore does not keep this courtesy wait busy.
 */
export async function waitForScheduledBackupQuiet(options: ScheduledQuietOptions): Promise<ScheduledQuietResult> {
  const quietMs = options.quietMs ?? QUIET_MS;
  const pollMs = options.pollMs ?? POLL_MS;
  const maxWaitMs = options.maxWaitMs ?? MAX_WAIT_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? sleepAwake;
  const isBusy = options.isBusy ?? (() => boxIsBusy(options.boxRoot));
  let quietSince: number | null = null;
  let previousProbeAt = now();
  let awakeWaitMs = 0;
  for (;;) {
    const checkedAt = now();
    const probeGap = checkedAt - previousProbeAt;
    if (probeGap >= pollMs * 6) awakeWaitMs += Math.min(probeGap, pollMs);
    else if (probeGap > 0) awakeWaitMs += probeGap;
    if (awakeWaitMs >= maxWaitMs) return { quiet: false, waitedMs: awakeWaitMs };
    // A long gap between probes is a machine sleep. Require a fresh quiet
    // window after wake instead of treating sleep as idle box time.
    if (probeGap >= pollMs * 6) quietSince = null;
    previousProbeAt = checkedAt;
    if (await isBusy()) quietSince = null;
    else if (quietSince === null) quietSince = checkedAt;
    else if (checkedAt - quietSince >= quietMs) return { quiet: true, waitedMs: awakeWaitMs };
    await sleep(Math.min(pollMs, maxWaitMs - awakeWaitMs));
  }
}

async function boxIsBusy(boxRoot: string): Promise<boolean> {
  const [holdersResult, maintenanceResult] = await Promise.allSettled([boxWorkHolders(boxRoot), boxMaintenanceStatus(boxRoot)]);
  if (holdersResult.status === "rejected") throw toError(holdersResult.reason);
  if (maintenanceResult.status === "rejected") throw toError(maintenanceResult.reason);
  const maintenance = maintenanceResult.value;
  const recoverableBackupDrain = maintenance?.reason === "box backup" && maintenance.phase === "draining" && maintenance.owner === null;
  return holdersResult.value.length > 0 || (maintenance !== null && !recoverableBackupDrain);
}

function sleepAwake(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    startAwakeTimeout({ timeoutMs, periodMs: Math.min(5_000, timeoutMs), onTimeout: () => resolve() });
  });
}
