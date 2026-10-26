/** Operator-only encrypted snapshots of one box and its machine-owned state. */
import { Command } from "commander";
import { boxMaintenanceStatus, boxWorkHolders } from "../../lib/box-maintenance/admission.js";
import { errorMessage, toError } from "../../shared/error-guards.js";
import { checkBackup } from "../../core/box-backup/check.js";
import { configureBackup, runBackup } from "../../core/box-backup/run/backup.js";
import { pruneBackup } from "../../core/box-backup/retention.js";
import { backupStatus } from "../../core/box-backup/status.js";
import { readBackupConfig } from "../../core/box-backup/config.js";
import { recordBackupPostVerificationFailure } from "../../core/box-backup/attempt.js";
import { previewBoxBackup, restoreBoxBackup } from "../../core/box-backup/restore.js";
import type { BackupRetention } from "../../core/box-backup/config.js";

function fail(stage: string, error: unknown): void {
  console.error(`Backup ${stage} failed: ${errorMessage(error)}`);
  process.exitCode = 1;
}

function retention(options: { keepDaily?: string; keepWeekly?: string; keepMonthly?: string }): BackupRetention | undefined {
  const { keepDaily, keepWeekly, keepMonthly } = options;
  if (keepDaily === undefined && keepWeekly === undefined && keepMonthly === undefined) return undefined;
  const values = {
    daily: Number(keepDaily ?? 7),
    weekly: Number(keepWeekly ?? 4),
    monthly: Number(keepMonthly ?? 12),
  };
  for (const value of Object.values(values)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new InvalidBackupRetentionError();
  }
  return values;
}

class InvalidBackupRetentionError extends Error {
  constructor() { super("Backup retention counts must be positive integers"); this.name = "InvalidBackupRetentionError"; }
}

class RestoreSnapshotPinRequiredError extends Error {
  constructor(snapshotId: string) { super(`To write this restore, rerun with --snapshot ${snapshotId} --apply`); this.name = "RestoreSnapshotPinRequiredError"; }
}

async function runAndRetain(boxRoot: string): Promise<void> {
  const result = await runBackup({ boxRoot });
  const state = result.externalState;
  const skipped = state.skippedKinds.length > 0 ? `; skipped ${state.skippedKinds.join(", ")}` : "";
  console.log(`Verified snapshot ${result.snapshotId} at ${result.verifiedAt} (${Math.round(result.durationMs / 1000)}s). External: ${state.included} items, ${state.secretEntries} secrets${skipped}.`);
  try {
    await pruneBackup({ boxRoot });
  } catch (error) {
    await recordBackupPostVerificationFailure({ boxRoot, snapshotId: result.snapshotId, startedAt: result.startedAt });
    fail(`retention after verified snapshot ${result.snapshotId}`, error);
  }
}

export const backupCommand = new Command("backup")
  .description("Configure, run, inspect, and restore encrypted box backups");

backupCommand
  .command("configure")
  .description("Configure a repository and make the first backup")
  .argument("<boxRoot>", "Box root")
  .requiredOption("--repository <url>", "Restic repository URL or accessible local path")
  .requiredOption("--password-file <path>", "Protected file holding the recovery password")
  .option("--keep-daily <count>", "Daily snapshots to retain (default: 7)")
  .option("--keep-weekly <count>", "Weekly snapshots to retain (default: 4)")
  .option("--keep-monthly <count>", "Monthly snapshots to retain (default: 12)")
  .option("--configure-only", "Record configuration without a first capture (for a host service setup)")
  .option("--backup-id <uuid>", "Adopt an existing repository with this backup identity")
  .action(async (boxRoot: string, options: { repository: string; passwordFile: string; keepDaily?: string; keepWeekly?: string; keepMonthly?: string; configureOnly?: boolean; backupId?: string }) => {
    try {
      const keep = retention(options);
      const config = await configureBackup({ boxRoot, repository: options.repository, passwordFile: options.passwordFile, ...(keep === undefined ? {} : { retention: keep }), ...(options.backupId === undefined ? {} : { backupId: options.backupId }) });
      console.log(`Configured backup ${config.backupId} for ${config.boxRoot}. Keep the recovery password outside this machine.`);
      if (options.configureOnly) console.log("First snapshot pending; run the host backup service before enabling its timer.");
      else await runAndRetain(boxRoot);
    } catch (error) { fail("configuration or first capture", error); }
  });

backupCommand
  .command("run")
  .description("Capture one snapshot, then apply retention")
  .argument("<boxRoot>", "Box root")
  .option("--scheduled", "Skip capture when the configured schedule is manual-only")
  .action(async (boxRoot: string, options: { scheduled?: boolean }) => {
    try {
      if (options.scheduled && (await readBackupConfig({ boxRoot })).schedule === "off") {
        console.log("Scheduled backup skipped; automatic backups are off.");
        return;
      }
      await runAndRetain(boxRoot);
    }
    catch (error) { fail("capture", error); }
  });

backupCommand
  .command("status")
  .description("Show the most recent verified snapshot and whether another is due")
  .argument("<boxRoot>", "Box root")
  .option("--json", "Machine-readable status")
  .action(async (boxRoot: string, options: { json?: boolean }) => {
    try {
      const status = await backupStatus({ boxRoot, json: options.json === true });
      if (options.json) console.log(JSON.stringify(status));
      else if (!status.configured) console.log("Backup not configured.");
      else if (status.newestVerified === null) console.log(status.due ? "Backup configured; no verified snapshot yet." : "No verified snapshot found in the repository; automatic backups are off.");
      else console.log(`Latest verified snapshot ${status.newestVerified.id} at ${status.newestVerified.time}${status.due ? " (backup due)" : ""}.`);
    } catch (error) { fail("status", error); }
  });

backupCommand
  .command("check")
  .description("Check the configured restic repository")
  .argument("<boxRoot>", "Box root")
  .option("--read-data", "Read all stored data during the check")
  .action(async (boxRoot: string, options: { readData?: boolean }) => {
    try {
      await checkBackup({ boxRoot, readData: options.readData === true });
      console.log("Repository check passed.");
    } catch (error) { fail("check", error); }
  });

backupCommand
  .command("restore")
  .description("Preview a verified snapshot; --apply writes it to an empty target")
  .requiredOption("--repository <url>", "Restic repository URL or path")
  .requiredOption("--password-file <path>", "Recovery password file")
  .requiredOption("--target <empty-dir>", "Empty restore destination")
  .option("--snapshot <id>", "Verified snapshot ID (default: newest)")
  .option("--apply", "Restore the exact snapshot named by --snapshot after showing the preview")
  .action(async (options: { repository: string; passwordFile: string; target: string; snapshot?: string; apply?: boolean }) => {
    try {
      const preview = await previewBoxBackup(options);
      console.log(`Verified snapshot: ${preview.snapshotId} (${preview.snapshotTime})`);
      console.log(`Backup identity: ${preview.backupId}`);
      console.log("Snapshot source paths:");
      for (const source of preview.sourcePaths) console.log(`  ${source}`);
      console.log("Snapshot exclusions:");
      if (preview.excludedPatterns.length === 0) console.log("  (none recorded)");
      else for (const pattern of preview.excludedPatterns) console.log(`  ${pattern}`);
      console.log(`Box output: ${preview.boxPath}`);
      console.log(`External state output: ${preview.externalPath}`);
      if (!options.apply) {
        console.log(`Preview only; restore target untouched. To restore, rerun with --snapshot ${preview.snapshotId} --apply.`);
        return;
      }
      if (options.snapshot !== preview.snapshotId) throw new RestoreSnapshotPinRequiredError(preview.snapshotId);
      const restored = await restoreBoxBackup({ repository: options.repository, passwordFile: options.passwordFile, target: options.target, snapshot: preview.snapshotId });
      console.log(`Restored verified snapshot ${restored.snapshotId} to ${restored.boxPath}. External state awaits review in ${restored.externalPath}.`);
    } catch (error) { fail("restore", error); }
  });

// The Mac app samples this while open. The command itself takes no box-work
// admission, so it can observe holders without becoming one.
backupCommand
  .command("idle", { hidden: true })
  .argument("<boxRoot>", "Box root")
  .action(async (boxRoot: string) => {
    try {
      const [holders, maintenance] = await Promise.allSettled([boxWorkHolders(boxRoot), boxMaintenanceStatus(boxRoot)]);
      if (holders.status === "rejected") throw toError(holders.reason);
      if (maintenance.status === "rejected") throw toError(maintenance.reason);
      if (holders.value.length > 0 || maintenance.value !== null) process.exitCode = 1;
    } catch (error) {
      console.error(`Backup idle check failed: ${errorMessage(error)}`);
      process.exitCode = 2;
    }
  });
