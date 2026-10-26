/** Apply verified-snapshot retention and prune as a separate operation. */
import { readBackupConfig } from "./config.js";
import { listSnapshots, type BackupSnapshot } from "./run/backup.js";
import { runRestic } from "./restic.js";

export async function pruneBackup({ boxRoot }: { boxRoot: string }): Promise<void> {
  const config = await readBackupConfig({ boxRoot });
  const snapshots = await listSnapshots({ repository: config.repository, passwordFile: config.passwordFile, backupId: config.backupId });
  const stale = expiredUnverifiedSnapshotIds({ snapshots, backupId: config.backupId, now: Date.now() });
  if (stale.length > 0) await runRestic({ repository: config.repository, passwordFile: config.passwordFile, args: ["forget", ...stale] });
  await runRestic({ repository: config.repository, passwordFile: config.passwordFile, args: [
    "forget", "--tag", "verified", "--host", config.backupId, "--group-by", "host",
    "--keep-daily", String(config.retention.daily), "--keep-weekly", String(config.retention.weekly), "--keep-monthly", String(config.retention.monthly),
  ] });
  await runRestic({ repository: config.repository, passwordFile: config.passwordFile, args: ["prune"] });
}

export function expiredUnverifiedSnapshotIds({ snapshots, backupId, now }: { snapshots: BackupSnapshot[]; backupId: string; now: number }): string[] {
  const cutoff = now - 2 * 86_400_000;
  return snapshots.filter((snapshot) => snapshot.tags.includes(`bbx-backup:${backupId}`) && !snapshot.tags.includes("verified") && Date.parse(snapshot.time) < cutoff).map((snapshot) => snapshot.id);
}
