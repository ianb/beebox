/** Machine-local outcomes from the CLI backup runner; this module never calls Restic. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { boxMaintenanceStatus } from "../../lib/box-maintenance/admission.js";
import { errnoCode } from "../../shared/error-guards.js";
import { writeFileAtomic } from "../../lib/atomic-write.js";
import { withFileLock } from "../../lib/file-lock.js";
import { backupConfigPath, MissingBackupConfigError } from "./config.js";

const verifiedSchema = z.object({ snapshotId: z.string(), verifiedAt: z.string().datetime() }).strict();
const safeErrorSchema = z.enum([
  "Box is busy with unfinished maintenance", "Required external state is missing",
  "A transcript changed during capture; retry when idle", "Repository identity does not match this box",
  "Recovery password file is invalid or unavailable", "Repository operation failed; check repository access and credentials",
  "Backup could not be verified", "Snapshot verified; retention could not be applied",
]);
const attemptSchema = z.object({
  startedAt: z.string().datetime(), completedAt: z.string().datetime(), outcome: z.enum(["verified", "failed"]),
  error: safeErrorSchema.optional(), verified: verifiedSchema.optional(),
}).strict();
const recordSchema = z.object({ version: z.literal(1), attempt: attemptSchema }).strict();
export type BackupAttempt = z.infer<typeof attemptSchema>;
export interface BackupAttemptStatus {
  newestVerified: { snapshotId: string; verifiedAt: string } | null;
  lastAttempt: { startedAt: string; completedAt: string; outcome: "verified" | "failed"; error?: string } | null;
  maintenance: "running" | "interrupted" | null;
}

export async function readBackupAttempt({ boxRoot }: { boxRoot: string }): Promise<BackupAttempt | null> {
  const file = attemptPath(boxRoot);
  let raw: string;
  try { raw = await fs.readFile(file, "utf8"); }
  catch (error) { if (errnoCode(error) === "ENOENT") return null; throw error; }
  const parsed = recordSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new InvalidBackupAttemptError();
  return parsed.data.attempt;
}

export async function backupAttemptStatus({ boxRoot }: { boxRoot: string }): Promise<BackupAttemptStatus> {
  let configured = true;
  try { await fs.access(backupConfigPath(boxRoot)); }
  catch (error) {
    if (errnoCode(error) !== "ENOENT") throw error;
    configured = false;
  }
  if (!configured) throw new MissingBackupConfigError(backupConfigPath(boxRoot));
  const [lastAttempt, maintenanceStatus] = await Promise.all([readBackupAttempt({ boxRoot }), boxMaintenanceStatus(boxRoot)]);
  const backupMaintenance = maintenanceStatus?.reason === "box backup" ? maintenanceStatus : null;
  const maintenance = backupMaintenance?.owner ? "running" : backupMaintenance ? "interrupted" : null;
  const newestVerified = lastAttempt?.verified ?? null;
  const displayedAttempt = lastAttempt && {
    startedAt: lastAttempt.startedAt, completedAt: lastAttempt.completedAt, outcome: lastAttempt.outcome,
    ...(lastAttempt.error === undefined ? {} : { error: lastAttempt.error }),
  };
  return { newestVerified, lastAttempt: displayedAttempt ?? null, maintenance };
}

export async function recordBackupFailure({ boxRoot, startedAt, error }: { boxRoot: string; startedAt: string; error: unknown }): Promise<void> {
  await withAttemptLock(boxRoot, async () => {
    const prior = await readBackupAttempt({ boxRoot });
    if (prior && prior.startedAt > startedAt) return;
    const message = safeBackupError(error);
    await writeAttempt(boxRoot, {
      startedAt, completedAt: new Date().toISOString(), outcome: "failed", error: message,
      ...(prior?.verified === undefined ? {} : { verified: prior.verified }),
    });
  });
}

export async function recordBackupPostVerificationFailure({ boxRoot, snapshotId, startedAt }: { boxRoot: string; snapshotId: string; startedAt: string }): Promise<void> {
  await withAttemptLock(boxRoot, async () => {
    const prior = await readBackupAttempt({ boxRoot });
    if (prior?.verified?.snapshotId !== snapshotId || prior.startedAt !== startedAt) return;
    await writeAttempt(boxRoot, {
      startedAt: prior.startedAt, completedAt: new Date().toISOString(), outcome: "failed",
      error: "Snapshot verified; retention could not be applied", verified: prior.verified,
    });
  });
}

export async function recordBackupVerified({ boxRoot, startedAt, snapshotId, verifiedAt }: { boxRoot: string; startedAt: string; snapshotId: string; verifiedAt: string }): Promise<void> {
  await withAttemptLock(boxRoot, async () => {
    const prior = await readBackupAttempt({ boxRoot });
    if (prior && prior.startedAt > startedAt) return;
    await writeAttempt(boxRoot, { startedAt, completedAt: new Date().toISOString(), outcome: "verified", verified: { snapshotId, verifiedAt } });
  });
}

function safeBackupError(error: unknown): z.infer<typeof safeErrorSchema> {
  const name = error instanceof Error ? error.name : "";
  if (name.includes("Maintenance")) return "Box is busy with unfinished maintenance";
  if (name.includes("MissingExternalState")) return "Required external state is missing";
  if (name.includes("TranscriptChanged")) return "A transcript changed during capture; retry when idle";
  if (name.includes("RepositoryIdentity")) return "Repository identity does not match this box";
  if (name.includes("Password")) return "Recovery password file is invalid or unavailable";
  if (name.includes("Restic")) return "Repository operation failed; check repository access and credentials";
  return "Backup could not be verified";
}

async function writeAttempt(boxRoot: string, attempt: BackupAttempt): Promise<void> {
  await writeFileAtomic(attemptPath(boxRoot), { content: `${JSON.stringify({ version: 1, attempt }, null, 2)}\n`, mode: 0o600 });
}

function attemptPath(boxRoot: string): string { return path.join(path.dirname(backupConfigPath(boxRoot)), `${path.basename(backupConfigPath(boxRoot), ".json")}.attempt.json`); }

function withAttemptLock<T>(boxRoot: string, fn: () => Promise<T>): Promise<T> {
  return withFileLock({ lockPath: `${attemptPath(boxRoot)}.lock`, metadata: { purpose: "box-backup-attempt" }, waitMs: 10_000 }, fn);
}

class InvalidBackupAttemptError extends Error {
  constructor() { super("Invalid local backup attempt record"); this.name = "InvalidBackupAttemptError"; }
}
