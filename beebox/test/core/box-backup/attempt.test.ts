// Backup attempt state is machine-local, safe to display, and retains its last verified snapshot.
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import * as fs from "node:fs/promises";
import { backupConfigPath, writeBackupConfig } from "../../../src/core/box-backup/config.js";
import { backupAttemptStatus, readBackupAttempt, recordBackupFailure, recordBackupPostVerificationFailure, recordBackupVerified } from "../../../src/core/box-backup/attempt.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

void test("a later failed attempt keeps the verified snapshot and hides raw errors", async (t) => {
  const box = await makeTmpBox();
  const configPath = backupConfigPath(box.root);
  t.teardown(async () => {
    await fs.rm(configPath, { force: true });
    await fs.rm(configPath.replace(/\.json$/, ".attempt.json"), { force: true });
    await box.cleanup();
  });
  await writeBackupConfig({ boxRoot: box.root, repository: "/tmp/repository", passwordFile: "/tmp/password" });
  await recordBackupVerified({ boxRoot: box.root, startedAt: "2026-10-25T00:00:00.000Z", snapshotId: "verified-id", verifiedAt: "2026-10-25T00:01:00.000Z" });
  await recordBackupFailure({ boxRoot: box.root, startedAt: "2026-10-26T00:00:00.000Z", error: new Error("password=do-not-store; restic stderr") });

  const status = await backupAttemptStatus({ boxRoot: box.root });
  t.check(status, {
    newestVerified: { snapshotId: "verified-id", verifiedAt: "2026-10-25T00:01:00.000Z" },
    lastAttempt: { startedAt: "2026-10-26T00:00:00.000Z", completedAt: any(String), outcome: "failed", error: "Backup could not be verified" },
    maintenance: null,
  });
  t.check((await readBackupAttempt({ boxRoot: box.root }))?.error, "Backup could not be verified");
});

void test("an older retention failure cannot replace a newer verified attempt", async (t) => {
  const box = await makeTmpBox();
  const configPath = backupConfigPath(box.root);
  t.teardown(async () => {
    await fs.rm(configPath, { force: true });
    await fs.rm(configPath.replace(/\.json$/, ".attempt.json"), { force: true });
    await box.cleanup();
  });
  await writeBackupConfig({ boxRoot: box.root, repository: "/tmp/repository", passwordFile: "/tmp/password" });
  const first = "2026-10-25T00:00:00.000Z";
  const second = "2026-10-26T00:00:00.000Z";
  await recordBackupVerified({ boxRoot: box.root, startedAt: first, snapshotId: "old", verifiedAt: first });
  await recordBackupVerified({ boxRoot: box.root, startedAt: second, snapshotId: "new", verifiedAt: second });
  await recordBackupPostVerificationFailure({ boxRoot: box.root, startedAt: first, snapshotId: "old" });
  await recordBackupFailure({ boxRoot: box.root, startedAt: first, error: new Error("late failure") });
  t.check((await backupAttemptStatus({ boxRoot: box.root })).newestVerified, { snapshotId: "new", verifiedAt: second });
  t.check((await readBackupAttempt({ boxRoot: box.root }))?.outcome, "verified");
});
