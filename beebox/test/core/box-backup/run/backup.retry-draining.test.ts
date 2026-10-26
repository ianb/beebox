// A crashed backup's ownerless draining phase can be retried by the next backup.
import { test } from "tap";
import "@ianbicking/tap-check/tap";

void test("ownerless backup draining reaches maintenance admission for retry", async (t) => {
  const retryReached = new Error("retry reached maintenance admission");
  let failures = 0;
  const { runBackup } = await t.mockImport("../../../../src/core/box-backup/run/backup.ts", {
    "../../../../src/core/box-backup/config.ts": {
      backupConfigPath: () => "/tmp/config.json",
      MissingBackupConfigError: class MissingBackupConfigError extends Error {},
      readBackupConfig: async () => ({ boxRoot: "/tmp/box", backupId: "identity", repository: "/tmp/repo", passwordFile: "/tmp/password" }),
      writeBackupConfig: async () => { throw new Error("not used"); },
    },
    "../../../../src/lib/box-maintenance/admission.ts": {
      withBoxWork: async (_boxRoot: string, fn: () => unknown) => fn(),
      boxMaintenanceStatus: async () => ({ reason: "box backup", phase: "draining", owner: null }),
      acquireBoxMaintenance: async () => { throw retryReached; },
    },
    "../../../../src/core/box-backup/restic.ts": {
      ResticCommandError: class ResticCommandError extends Error {},
      runRestic: async () => { throw new Error("not used"); },
    },
    "../../../../src/core/box-backup/attempt.ts": { recordBackupFailure: async () => { failures += 1; }, recordBackupVerified: async () => {} },
  });

  await t.checkThrows(() => runBackup({ boxRoot: "/tmp/box" }), "Error: retry reached maintenance admission");
  t.check(failures, 1);
});

void test("live backup admission refusal does not record a false failed attempt", async (t) => {
  const refusal = new Error("backup already running");
  let failures = 0;
  const { runBackup } = await t.mockImport("../../../../src/core/box-backup/run/backup.ts", {
    "../../../../src/core/box-backup/config.ts": { backupConfigPath: () => "/tmp/config.json", MissingBackupConfigError: class MissingBackupConfigError extends Error {}, readBackupConfig: async () => ({ boxRoot: "/tmp/box", backupId: "identity", repository: "/tmp/repo", passwordFile: "/tmp/password" }), writeBackupConfig: async () => { throw new Error("not used"); } },
    "../../../../src/lib/box-maintenance/admission.ts": {
      withBoxWork: async (_boxRoot: string, fn: () => unknown) => fn(),
      boxMaintenanceStatus: async () => ({ reason: "box backup", phase: "backing up", owner: { pid: 3 } }),
      acquireBoxMaintenance: async () => { throw refusal; },
    },
    "../../../../src/core/box-backup/restic.ts": { ResticCommandError: class ResticCommandError extends Error {}, runRestic: async () => { throw new Error("not used"); } },
    "../../../../src/core/box-backup/attempt.ts": { recordBackupFailure: async () => { failures += 1; }, recordBackupVerified: async () => {} },
  });

  await t.checkThrows(() => runBackup({ boxRoot: "/tmp/box" }), "Error: backup already running");
  t.check(failures, 0);
});
