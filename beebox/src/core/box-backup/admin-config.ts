/** Machine-owned helpers used by the authenticated Admin backup setup. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { backupConfigPath } from "./config.js";

/** Create a new private Restic password file alongside the machine config. */
export async function createManagedBackupPasswordFile({ boxRoot, password }: {
  boxRoot: string;
  password: string;
}): Promise<{ passwordFile: string; cleanup: () => Promise<void> }> {
  const directory = path.dirname(backupConfigPath(boxRoot));
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  const passwordFile = path.join(directory, `password-${randomUUID()}`);
  const handle = await fs.open(passwordFile, "wx", 0o600);
  try {
    await handle.writeFile(password, "utf8");
    await handle.chmod(0o600);
  } catch (error) {
    await handle.close();
    await fs.rm(passwordFile, { force: true });
    throw error;
  }
  await handle.close();
  return { passwordFile, cleanup: () => fs.rm(passwordFile, { force: true }) };
}
