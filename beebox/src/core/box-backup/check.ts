/** Check repository readability and optionally all stored data. */
import { readBackupConfig } from "./config.js";
import { runRestic } from "./restic.js";

export async function checkBackup({ boxRoot, readData }: { boxRoot: string; readData?: boolean }): Promise<void> {
  const config = await readBackupConfig({ boxRoot });
  await runRestic({ repository: config.repository, passwordFile: config.passwordFile, args: ["check", ...(readData ? ["--read-data"] : [])] });
}
