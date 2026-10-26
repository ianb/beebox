// Restore previews the exact recovery point before the operator opts into writing.
import { test } from "tap";
import "@ianbicking/tap-check/tap";

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
