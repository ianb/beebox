/** Read the most recent verified restic snapshot belonging to this box. */
import { MissingBackupConfigError, readBackupConfig } from "./config.js";
import { listSnapshots } from "./run/backup.js";
import { readBackupAttempt } from "./attempt.js";

export interface BackupStatus { configured: boolean; due: boolean; newestVerified: { id: string; time: string } | null }
export async function backupStatus({ boxRoot, json }: { boxRoot: string; json?: boolean }): Promise<BackupStatus> {
  let config;
  try { config = await readBackupConfig({ boxRoot }); }
  catch (error) {
    if (error instanceof MissingBackupConfigError) return { configured: false, due: false, newestVerified: null };
    throw error;
  }
  if (json === true && config.schedule === "off") {
    const attempt = await readBackupAttempt({ boxRoot });
    const newest = attempt?.verified;
    return { configured: true, due: false, newestVerified: newest ? { id: newest.snapshotId, time: newest.verifiedAt } : null };
  }
  const snapshots = await listSnapshots({ repository: config.repository, passwordFile: config.passwordFile, backupId: config.backupId });
  const latest = snapshots.filter((snapshot) => snapshot.tags.includes("verified")).toSorted((a, b) => b.time.localeCompare(a.time))[0];
  const newestVerified = latest ? { id: latest.id, time: latest.time } : null;
  return { configured: true, due: config.schedule === "daily" && (newestVerified === null || Date.now() - Date.parse(newestVerified.time) >= 86_400_000), newestVerified };
}
