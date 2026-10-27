// Scheduled runs use local verified/failure records so every host runner shares
// one retry policy without querying Restic merely to decide whether it is due.
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { scheduledBackupDecision, waitForScheduledBackupQuiet } from "../../../src/core/box-backup/scheduled.js";
import type { BackupAttempt } from "../../../src/core/box-backup/attempt.js";

const NOW = Date.parse("2026-10-26T12:00:00.000Z");
const verified: BackupAttempt = {
  startedAt: "2026-10-25T11:59:00.000Z", completedAt: "2026-10-25T12:00:00.000Z", outcome: "verified",
  verified: { snapshotId: "snapshot-1", verifiedAt: "2026-10-25T12:00:00.000Z" },
};

void test("scheduled due policy skips disabled, recent verified, and recent failures", (t) => {
  const failed: BackupAttempt = {
    ...verified, startedAt: "2026-10-26T11:30:00.000Z", completedAt: "2026-10-26T11:31:00.000Z",
    outcome: "failed", error: "Backup could not be verified",
  };
  t.check({
    off: scheduledBackupDecision({ schedule: "off", serverAutoEnabled: false, attempt: null, now: NOW }),
    recent: scheduledBackupDecision({ schedule: "daily", serverAutoEnabled: false, attempt: { ...verified, verified: { snapshotId: "snapshot-2", verifiedAt: NOW_DATE(0) }, completedAt: NOW_DATE(0) }, now: NOW }),
    failure: scheduledBackupDecision({ schedule: "daily", serverAutoEnabled: false, attempt: failed, now: NOW }),
    retentionFailure: scheduledBackupDecision({ schedule: "daily", serverAutoEnabled: false, attempt: { ...failed, verified: { snapshotId: "snapshot-3", verifiedAt: NOW_DATE(-30 * 60 * 1000) } }, now: NOW }),
    oldFailure: scheduledBackupDecision({ schedule: "daily", serverAutoEnabled: false, attempt: failed, now: NOW + 60 * 60 * 1000 }),
    noRecord: scheduledBackupDecision({ schedule: "daily", serverAutoEnabled: false, attempt: null, now: NOW }),
    serverLegacy: scheduledBackupDecision({ schedule: "daily", serverAutoEnabled: false, attempt: null, unitHost: true, now: NOW }),
    serverEnabled: scheduledBackupDecision({ schedule: "daily", serverAutoEnabled: true, attempt: null, unitHost: true, now: NOW }),
    nextTimerDay: scheduledBackupDecision({ schedule: "daily", serverAutoEnabled: true, attempt: { ...verified, verified: { snapshotId: "snapshot-4", verifiedAt: "2026-10-25T13:00:00.000Z" } }, unitHost: true, now: NOW }),
  }, { off: "off", recent: "recently-verified", failure: "recent-failure", retentionFailure: "recently-verified", oldFailure: "due", noRecord: "due", serverLegacy: "server-runner-not-enabled", serverEnabled: "due", nextTimerDay: "due" });
  t.end();
});

void test("a crashed backup's ownerless drain does not block retry after the quiet window", async (t) => {
  const { waitForScheduledBackupQuiet: wait } = await t.mockImport("../../../src/core/box-backup/scheduled.ts", {
    "../../../src/lib/box-maintenance/admission.ts": {
      boxWorkHolders: async () => [],
      boxMaintenanceStatus: async () => ({ reason: "box backup", phase: "draining", owner: null }),
    },
  });
  let now = 0;
  const result = await wait({ boxRoot: "/synthetic/box", quietMs: 10, pollMs: 10, now: () => now, sleep: async (ms: number) => { now += ms; } });
  t.check(result, { quiet: true, waitedMs: 10 });
});

void test("quiet wait requires ten uninterrupted minutes and gives up at its bound", async (t) => {
  let now = 0;
  let probes = 0;
  const quiet = await waitForScheduledBackupQuiet({
    boxRoot: "/unused", quietMs: 20, pollMs: 10, maxWaitMs: 100,
    now: () => now,
    sleep: async (ms) => { now += ms; },
    isBusy: async () => { probes += 1; return probes === 1; },
  });
  t.check(quiet, { quiet: true, waitedMs: 30 });

  now = 0;
  const busy = await waitForScheduledBackupQuiet({
    boxRoot: "/unused", quietMs: 20, pollMs: 10, maxWaitMs: 30,
    now: () => now,
    sleep: async (ms) => { now += ms; },
    isBusy: async () => true,
  });
  t.check(busy, { quiet: false, waitedMs: 30 });
});

function NOW_DATE(offsetMs: number): string { return new Date(NOW + offsetMs).toISOString(); }
