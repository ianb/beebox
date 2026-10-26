// Manual-only backup status uses the local verified result and never contacts Restic.
import { test } from "tap";
import "@ianbicking/tap-check/tap";

void test("off schedule reports the local verified snapshot without listing Restic snapshots", async (t) => {
  let resticReads = 0;
  const { backupStatus } = await t.mockImport("../../../src/core/box-backup/status.ts", {
    "../../../src/core/box-backup/config.ts": { MissingBackupConfigError: class MissingBackupConfigError extends Error {}, readBackupConfig: async () => ({ schedule: "off" }) },
    "../../../src/core/box-backup/run/backup.ts": { listSnapshots: async () => { resticReads += 1; return []; } },
    "../../../src/core/box-backup/attempt.ts": { readBackupAttempt: async () => ({ verified: { snapshotId: "local-id", verifiedAt: "2026-10-25T00:00:00.000Z" } }) },
  });

  t.check(await backupStatus({ boxRoot: "/synthetic/box", json: true }), {
    configured: true, due: false, newestVerified: { id: "local-id", time: "2026-10-25T00:00:00.000Z" },
  });
  t.check(resticReads, 0);
});

void test("off schedule human status still reads the repository", async (t) => {
  let resticReads = 0;
  const { backupStatus } = await t.mockImport("../../../src/core/box-backup/status.ts", {
    "../../../src/core/box-backup/config.ts": { MissingBackupConfigError: class MissingBackupConfigError extends Error {}, readBackupConfig: async () => ({ schedule: "off", repository: "repo", passwordFile: "password", backupId: "id" }) },
    "../../../src/core/box-backup/run/backup.ts": { listSnapshots: async () => { resticReads += 1; return [{ id: "remote-id", time: "2026-10-26T00:00:00.000Z", tags: ["verified"] }]; } },
    "../../../src/core/box-backup/attempt.ts": { readBackupAttempt: async () => ({ verified: { snapshotId: "local-id", verifiedAt: "2026-10-25T00:00:00.000Z" } }) },
  });

  t.check(await backupStatus({ boxRoot: "/synthetic/box" }), {
    configured: true, due: false, newestVerified: { id: "remote-id", time: "2026-10-26T00:00:00.000Z" },
  });
  t.check(resticReads, 1);
});
