// Restore previews the exact recovery point before the operator opts into writing.
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs/promises";
import { backupConfigPath, updateBackupSchedule, writeBackupConfig } from "../../../src/core/box-backup/config.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

void test("restore previews without writing, then applies only a pinned snapshot", async (t) => {
  const snapshotId = "a".repeat(64);
  const target = "/tmp/synthetic-restore-target";
  const applied: Array<{ repository: string; passwordFile: string; target: string; snapshot?: string }> = [];
  const lines: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  t.teardown(() => { console.log = originalLog; console.error = originalError; process.exitCode = originalExitCode; });
  const { backupCommand } = await t.mockImport("../../../src/cli/commands/backup.ts", {
    "../../../src/core/box-backup/restore.ts": {
      previewBoxBackup: async () => ({
        snapshotId,
        snapshotTime: "2026-10-26T10:00:00.000Z",
        backupId: "synthetic-box-id",
        sourcePaths: ["/synthetic/box", "/synthetic/secrets.json"],
        excludedPatterns: ["node_modules"],
        boxPath: `${target}/box`,
        externalPath: `${target}/external`,
      }),
      restoreBoxBackup: async (options: { repository: string; passwordFile: string; target: string; snapshot?: string }) => {
        applied.push(options);
        return { snapshotId, boxPath: `${target}/box`, externalPath: `${target}/external` };
      },
    },
  });
  const baseArgs = ["restore", "--repository", "synthetic-repo", "--password-file", "synthetic-password", "--target", target];
  await backupCommand.parseAsync(baseArgs, { from: "user" });
  t.check({ applied, lines }, {
    applied: [],
    lines: [
      `Verified snapshot: ${snapshotId} (2026-10-26T10:00:00.000Z)`,
      "Backup identity: synthetic-box-id",
      "Snapshot source paths:",
      "  /synthetic/box",
      "  /synthetic/secrets.json",
      "Snapshot exclusions:",
      "  node_modules",
      `Box output: ${target}/box`,
      `External state output: ${target}/external`,
      `Preview only; restore target untouched. To restore, rerun with --snapshot ${snapshotId} --apply.`,
    ],
  });

  lines.length = 0;
  await backupCommand.parseAsync([...baseArgs, "--apply"], { from: "user" });
  t.check({ applied, errors, exitCode: process.exitCode }, {
    applied: [],
    errors: [`Backup restore failed: To write this restore, rerun with --snapshot ${snapshotId} --apply`],
    exitCode: 1,
  });

  process.exitCode = originalExitCode;
  lines.length = 0;
  await backupCommand.parseAsync([...baseArgs, "--snapshot", snapshotId, "--apply"], { from: "user" });
  t.check(applied, [{ repository: "synthetic-repo", passwordFile: "synthetic-password", target, snapshot: snapshotId }]);
  t.check(lines.at(-1), `Restored verified snapshot ${snapshotId} to ${target}/box. External state awaits review in ${target}/external.`);
});

void test("scheduled run skips when off while a manual run still captures", async (t) => {
  const box = await makeTmpBox();
  const originalLog = console.log;
  const originalExitCode = process.exitCode;
  const lines: string[] = [];
  let captures = 0;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  t.teardown(async () => {
    console.log = originalLog;
    process.exitCode = originalExitCode;
    await fs.rm(backupConfigPath(box.root), { force: true });
    await box.cleanup();
  });
  await writeBackupConfig({ boxRoot: box.root, repository: "/tmp/repository", passwordFile: "/tmp/password" });
  await updateBackupSchedule({ boxRoot: box.root, schedule: "off" });
  const { backupCommand } = await t.mockImport("../../../src/cli/commands/backup.ts", {
    "../../../src/core/box-backup/run/backup.ts": {
      configureBackup: async () => { throw new Error("not used"); },
      listSnapshots: async () => [],
      runBackup: async () => {
        captures += 1;
        return { snapshotId: "snapshot-id", verifiedAt: "2026-10-26T00:00:00.000Z", durationMs: 1, externalState: { included: 1, skipped: 0, secretEntries: 0, includedKinds: [], skippedKinds: [] } };
      },
    },
    "../../../src/core/box-backup/retention.ts": { pruneBackup: async () => ({ pruned: 0 }) },
  });

  await backupCommand.parseAsync(["run", box.root, "--scheduled"], { from: "user" });
  t.check({ captures, lines, exitCode: process.exitCode }, { captures: 0, lines: ["Scheduled backup skipped; automatic backups are off."], exitCode: originalExitCode });
  lines.length = 0;
  await backupCommand.parseAsync(["run", box.root], { from: "user" });
  t.check({ captures, lines, exitCode: process.exitCode }, {
    captures: 1,
    lines: ["Verified snapshot snapshot-id at 2026-10-26T00:00:00.000Z (0s). External: 1 items, 0 secrets."],
    exitCode: originalExitCode,
  });
});
