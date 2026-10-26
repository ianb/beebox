/** Machine-owned configuration for one encrypted restic repository per box. */
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../../lib/atomic-write.js";

const retentionSchema = z.object({ daily: z.number().int().positive(), weekly: z.number().int().positive(), monthly: z.number().int().positive() }).strict();
const configSchema = z.object({
  version: z.literal(1), boxRoot: z.string(), backupId: z.string().uuid(), repository: z.string().min(1),
  passwordFile: z.string().min(1), schedule: z.literal("daily"), retention: retentionSchema,
}).strict();
export type BackupConfig = z.infer<typeof configSchema>;
export type BackupRetention = BackupConfig["retention"];

export function backupConfigPath(boxRoot: string): string {
  const key = createHash("sha256").update(fsSync.realpathSync.native(boxRoot)).digest("hex");
  return path.join(os.homedir(), ".config", "beebox", "backups", `${key}.json`);
}

export async function readBackupConfig({ boxRoot }: { boxRoot: string }): Promise<BackupConfig> {
  const file = backupConfigPath(boxRoot);
  let raw: string;
  try { raw = await fs.readFile(file, "utf8"); }
  catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") throw new MissingBackupConfigError(file);
    throw error;
  }
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch (error) { throw new InvalidBackupConfigError(file, error instanceof Error ? error.message : "invalid JSON"); }
  const parsed = configSchema.safeParse(value);
  if (!parsed.success) throw new InvalidBackupConfigError(file, parsed.error.message);
  const realRoot = await fs.realpath(boxRoot);
  if (parsed.data.boxRoot !== realRoot) throw new InvalidBackupConfigError(file, `configured box root ${parsed.data.boxRoot} does not match ${realRoot}`);
  return parsed.data;
}

export async function writeBackupConfig({ boxRoot, repository, passwordFile, retention, backupId }: {
  boxRoot: string; repository: string; passwordFile: string; retention?: BackupRetention; backupId?: string;
}): Promise<BackupConfig> {
  const realRoot = await fs.realpath(boxRoot);
  const file = backupConfigPath(realRoot);
  const config = configSchema.parse({ version: 1, boxRoot: realRoot, backupId: backupId ?? randomUUID(), repository, passwordFile: path.resolve(passwordFile), schedule: "daily", retention: retention ?? { daily: 7, weekly: 4, monthly: 12 } });
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFileAtomic(file, { content: `${JSON.stringify(config, null, 2)}\n`, mode: 0o600 });
  return config;
}

export class InvalidBackupConfigError extends Error {
  constructor(file: string, detail: string) { super(`Invalid backup configuration ${file}: ${detail}`); this.name = "InvalidBackupConfigError"; }
}
export class MissingBackupConfigError extends Error {
  constructor(file: string) { super(`Backup not configured for this box (${file})`); this.name = "MissingBackupConfigError"; }
}
