/** Operator-only encrypted snapshots of one box and its machine-owned state. */
import { Command } from "commander";
import { boxMaintenanceStatus, boxWorkHolders } from "../../lib/box-maintenance/admission.js";
import { errorMessage, toError } from "../../shared/error-guards.js";
import { checkBackup } from "../../core/box-backup/check.js";
import { configureBackup, runBackup } from "../../core/box-backup/run/backup.js";
import { pruneBackup } from "../../core/box-backup/retention.js";
import { backupStatus } from "../../core/box-backup/status.js";
import { restoreBoxBackup } from "../../core/box-backup/restore.js";
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

async function runAndRetain(boxRoot: string): Promise<void> {
  const result = await runBackup({ boxRoot });
  const state = result.externalState;
  const skipped = state.skippedKinds.length > 0 ? `; skipped ${state.skippedKinds.join(", ")}` : "";
  console.log(`Verified snapshot ${result.snapshotId} at ${result.verifiedAt} (${Math.round(result.durationMs / 1000)}s). External: ${state.included} items, ${state.secretEntries} secrets${skipped}.`);
  try {
    await pruneBackup({ boxRoot });
  } catch (error) {
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
  .action(async (boxRoot: string) => {
    try { await runAndRetain(boxRoot); }
    catch (error) { fail("capture", error); }
  });

backupCommand
  .command("status")
  .description("Show the most recent verified snapshot and whether another is due")
  .argument("<boxRoot>", "Box root")
  .option("--json", "Machine-readable status")
  .action(async (boxRoot: string, options: { json?: boolean }) => {
    try {
      const status = await backupStatus({ boxRoot });
      if (options.json) console.log(JSON.stringify(status));
      else if (!status.configured) console.log("Backup not configured.");
      else if (status.newestVerified === null) console.log("Backup configured; no verified snapshot yet.");
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
  .description("Restore a verified snapshot to an empty target for inspection")
  .requiredOption("--repository <url>", "Restic repository URL or path")
  .requiredOption("--password-file <path>", "Recovery password file")
  .requiredOption("--target <empty-dir>", "Empty restore destination")
  .option("--snapshot <id>", "Verified snapshot ID (default: newest)")
  .action(async (options: { repository: string; passwordFile: string; target: string; snapshot?: string }) => {
    try {
      const restored = await restoreBoxBackup(options);
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
