/** Read the most recent verified restic snapshot belonging to this box. */
import { MissingBackupConfigError, readBackupConfig } from "./config.js";
import { listSnapshots } from "./run/backup.js";

export interface BackupStatus { configured: boolean; due: boolean; newestVerified: { id: string; time: string } | null }
export async function backupStatus({ boxRoot }: { boxRoot: string }): Promise<BackupStatus> {
  let config;
  try { config = await readBackupConfig({ boxRoot }); }
  catch (error) {
    if (error instanceof MissingBackupConfigError) return { configured: false, due: false, newestVerified: null };
    throw error;
  }
  const snapshots = await listSnapshots({ repository: config.repository, passwordFile: config.passwordFile, backupId: config.backupId });
  const latest = snapshots.filter((snapshot) => snapshot.tags.includes("verified")).toSorted((a, b) => b.time.localeCompare(a.time))[0];
  const newestVerified = latest ? { id: latest.id, time: latest.time } : null;
  return { configured: true, due: newestVerified === null || Date.now() - Date.parse(newestVerified.time) >= 86_400_000, newestVerified };
}
