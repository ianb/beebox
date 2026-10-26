/** Capture one stable box tree and its selected external state into restic. */
import * as fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { isWithin } from "../../../lib/box-containment.js";
import { acquireBoxMaintenance, boxMaintenanceStatus } from "../../../lib/box-maintenance/admission.js";
import { slugOfBoxRoot } from "../../../lib/box-slug.js";
import { onUnitHost } from "../../../lib/unit-host.js";
import { errnoCode } from "../../../shared/error-guards.js";
import { exportBoxStore } from "../../secrets/export-box.js";
import { backupConfigPath, MissingBackupConfigError, readBackupConfig, writeBackupConfig, type BackupConfig, type BackupRetention } from "../config.js";
import { backupInventory } from "./inventory.js";
import { ResticCommandError, runRestic } from "../restic.js";

export interface BackupExternalStateSummary { included: number; skipped: number; secretEntries: number; includedKinds: string[]; skippedKinds: string[] }
export interface BackupRunResult { snapshotId: string; verifiedAt: string; durationMs: number; externalState: BackupExternalStateSummary }
export async function runBackup({ boxRoot }: { boxRoot: string }): Promise<BackupRunResult> {
  const config = await readBackupConfig({ boxRoot });
  const existing = await boxMaintenanceStatus(boxRoot);
  if (existing && !existing.owner) throw new BackupMaintenanceError(existing.reason);
  const started = Date.now();
  const maintenance = await acquireBoxMaintenance(boxRoot, { reason: "box backup" });
  const stagingRoot = path.join(path.dirname(backupConfigPath(config.boxRoot)), "staging", config.backupId);
  try {
    const inventory = await backupInventory({ boxRoot: config.boxRoot, backupId: config.backupId });
    await maintenance.step("Preparing backup files");
    await fs.rm(stagingRoot, { recursive: true, force: true });
    await fs.mkdir(stagingRoot, { recursive: true, mode: 0o700 });
    await fs.chmod(stagingRoot, 0o700);
    const [secret, ...externalSources] = inventory.external;
    if (!secret) throw new MissingSecretStageError();
    try { await fs.access(secret.source); }
    catch (error) {
      if (errnoCode(error) === "ENOENT" && onUnitHost()) throw new BackupMissingExternalStateError(secret.kind);
      if (errnoCode(error) !== "ENOENT") throw error;
    }
    const share = await exportBoxStore(slugOfBoxRoot(config.boxRoot));
    await fs.mkdir(path.dirname(secret.target), { recursive: true, mode: 0o700 });
    await fs.writeFile(secret.target, `${JSON.stringify(share)}\n`, { mode: 0o600 });
    const sources = [config.boxRoot, secret.target];
    const includedKinds = [secret.kind];
    const skippedKinds = inventory.skipped.map((entry) => entry.kind);
    const prior = await listSnapshots({ repository: config.repository, passwordFile: config.passwordFile });
    if (prior.some((snapshot) => !snapshot.tags.includes(`bbx-backup:${config.backupId}`) || snapshot.host !== config.backupId)) throw new BackupRepositoryIdentityError();
    const priorIds = new Set(prior.map((snapshot) => snapshot.id));
    for (const entry of externalSources) {
      try { await fs.access(entry.source); }
      catch (error) {
        if (errnoCode(error) === "ENOENT" && !entry.required) { skippedKinds.push(entry.kind); continue; }
        if (errnoCode(error) === "ENOENT") throw new BackupMissingExternalStateError(entry.kind);
        throw error;
      }
      await fs.mkdir(path.dirname(entry.target), { recursive: true, mode: 0o700 });
      const before = await fileTreeFingerprint(entry.source);
      await fs.cp(entry.source, entry.target, { recursive: true, dereference: false, force: true, preserveTimestamps: true });
      if (before !== await fileTreeFingerprint(entry.source)) throw new BackupTranscriptChangedError();
      sources.push(entry.target);
      includedKinds.push(entry.kind);
    }
    const args = ["backup", "--json", "--quiet", "--host", config.backupId, "--group-by", "host", "--tag", `bbx-backup:${config.backupId}`, ...inventory.excludes.flatMap((exclude) => ["--exclude", exclude]), ...sources];
    const backup = await runRestic({ repository: config.repository, passwordFile: config.passwordFile, args });
    const output = backup.stdout.trim().split("\n").map((line) => summaryLineSchema.safeParse(JSON.parse(line))).filter((line) => line.success).map((line) => line.data);
    const id = output.toReversed().find((entry) => entry.message_type === "summary")?.snapshot_id;
    if (!id) throw new MissingSnapshotIdError();
    await requireMaintenanceOwner(maintenance);
    await runRestic({ repository: config.repository, passwordFile: config.passwordFile, args: ["check"] });
    await requireMaintenanceOwner(maintenance);
    await runRestic({ repository: config.repository, passwordFile: config.passwordFile, args: ["tag", "--add", "verified", id] });
    const snapshots = await listSnapshots({ repository: config.repository, passwordFile: config.passwordFile, backupId: config.backupId });
    const tagged = snapshots.filter((snapshot) => snapshot.tags.includes("verified") && !priorIds.has(snapshot.id) && snapshot.tags.includes(`bbx-backup:${config.backupId}`));
    if (tagged.length !== 1) throw new TaggedSnapshotNotFoundError();
    const snapshotId = tagged[0]?.id;
    if (snapshotId === undefined) throw new TaggedSnapshotNotFoundError();
    const externalSummary = {
      included: includedKinds.length,
      skipped: skippedKinds.length,
      secretEntries: Object.keys(share.secrets).length,
      includedKinds: [...new Set(includedKinds)].toSorted(),
      skippedKinds: [...new Set(skippedKinds)].toSorted(),
    };
    return { snapshotId, verifiedAt: new Date().toISOString(), durationMs: Date.now() - started, externalState: externalSummary };
  } finally {
    try { await fs.rm(stagingRoot, { recursive: true, force: true }); }
    finally { await maintenance.complete(); }
  }
}

async function requireMaintenanceOwner(maintenance: Awaited<ReturnType<typeof acquireBoxMaintenance>>): Promise<void> {
  if (!(await maintenance.held())) throw new BackupMaintenanceOwnerExpiredError();
}

export async function configureBackup({ boxRoot, repository, passwordFile, retention, backupId: requestedBackupId }: { boxRoot: string; repository: string; passwordFile: string; retention?: BackupRetention; backupId?: string }): Promise<BackupConfig> {
  const realRoot = await fs.realpath(boxRoot);
  if (requestedBackupId && !z.string().uuid().safeParse(requestedBackupId).success) throw new InvalidBackupIdError();
  await validateBackupPaths({ realRoot, repository, passwordFile });
  let priorConfig: BackupConfig | undefined;
  try { priorConfig = await readBackupConfig({ boxRoot: realRoot }); }
  catch (error) { if (!(error instanceof MissingBackupConfigError)) throw error; }
  if (priorConfig && requestedBackupId && priorConfig.backupId !== requestedBackupId) throw new BackupRepositoryIdentityError();
  const backupId = priorConfig?.backupId ?? requestedBackupId ?? randomUUID();
  await ensureRepositoryIdentity({ repository, passwordFile, backupId, explicitIdentity: Boolean(priorConfig || requestedBackupId) });
  const nextRetention = retention ?? priorConfig?.retention;
  const config = await writeBackupConfig({ boxRoot: realRoot, repository, passwordFile, backupId, ...(nextRetention === undefined ? {} : { retention: nextRetention }) });
  return config;
}

async function validateBackupPaths({ realRoot, repository, passwordFile }: { realRoot: string; repository: string; passwordFile: string }): Promise<void> {
  if (onUnitHost() && isLocalRepository(repository)) throw new UnitHostNetworkRepositoryError();
  if (onUnitHost() && !isWithin(await fs.realpath(os.homedir()), await realPathCandidate(passwordFile))) throw new UnitHostPasswordLocationError();
  if (isLocalRepository(repository) && isWithin(realRoot, await realPathCandidate(localRepositoryPath(repository)))) throw new BackupRepositoryInsideBoxError(repository);
  if (isWithin(realRoot, await realPathCandidate(passwordFile))) throw new BackupRepositoryInsideBoxError(passwordFile);
  if (isWithin(realRoot, await realPathCandidate(path.dirname(backupConfigPath(realRoot))))) throw new BackupRepositoryInsideBoxError(backupConfigPath(realRoot));
  await fs.access(passwordFile);
  const passwordStat = await fs.lstat(passwordFile);
  if (!passwordStat.isFile() || passwordStat.isSymbolicLink() || (passwordStat.mode & 0o077) !== 0) throw new BackupPasswordPermissionsError();
}

async function ensureRepositoryIdentity({ repository, passwordFile, backupId, explicitIdentity }: { repository: string; passwordFile: string; backupId: string; explicitIdentity: boolean }): Promise<void> {
  try {
    const snapshots = await listSnapshots({ repository, passwordFile });
    if (snapshots.length > 0 && (!explicitIdentity || snapshots.some((snapshot) => !snapshot.tags.includes(`bbx-backup:${backupId}`) || snapshot.host !== backupId))) throw new BackupRepositoryIdentityError();
  } catch (error) {
    if (error instanceof BackupRepositoryIdentityError) throw error;
    if (!(error instanceof ResticCommandError) || !isRepositoryMissing(error.detail)) throw error;
    await runRestic({ repository, passwordFile, args: ["init"] });
  }
}

function isLocalRepository(repository: string): boolean { return repository.startsWith("local:") || !/^[a-z][\d+.a-z-]*:/i.test(repository) || repository.startsWith("/") || repository.startsWith("."); }
function localRepositoryPath(repository: string): string { return repository.startsWith("local:") ? repository.slice("local:".length) : repository; }
async function realPathCandidate(file: string): Promise<string> {
  const absolute = path.resolve(file);
  try { return await fs.realpath(absolute); }
  catch (error) {
    if (errnoCode(error) !== "ENOENT") throw error;
    const parent = path.dirname(absolute);
    if (parent === absolute) return absolute;
    return path.join(await realPathCandidate(parent), path.basename(absolute));
  }
}
function isRepositoryMissing(detail: string): boolean { return /repository does not exist|unable to open config file|no such file or directory/i.test(detail); }
async function fileTreeFingerprint(source: string): Promise<string> {
  const stat = await fs.stat(source);
  if (!stat.isDirectory()) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(source)) hash.update(chunk);
    return hash.digest("hex");
  }
  const rows: string[] = [];
  for (const entry of (await fs.readdir(source, { withFileTypes: true })).toSorted((a, b) => a.name.localeCompare(b.name))) {
    const child = path.join(source, entry.name);
    rows.push(`${entry.name}:${await fileTreeFingerprint(child)}`);
  }
  return rows.join("\n");
}

export interface BackupSnapshot { id: string; time: string; host: string; paths: string[]; tags: string[] }
export async function listSnapshots({ repository, passwordFile, backupId }: { repository: string; passwordFile: string; backupId?: string }): Promise<BackupSnapshot[]> {
  const result = await runRestic({ repository, passwordFile, args: ["snapshots", "--json"] });
  const parsed: unknown = JSON.parse(result.stdout);
  if (!Array.isArray(parsed)) throw new InvalidSnapshotListError();
  return parsed.map((entry): BackupSnapshot => {
    const parsedRow = snapshotLineSchema.safeParse(entry);
    if (!parsedRow.success) throw new InvalidSnapshotListError();
    const row = parsedRow.data;
    const snapshot = { id: row.id, time: row.time, host: row.hostname, paths: row.paths, tags: row.tags ?? [] };
    return snapshot;
  }).filter((snapshot) => backupId === undefined || snapshot.tags.includes(`bbx-backup:${backupId}`));
}

export class BackupMaintenanceError extends Error { constructor(reason: string) { super(`Backup cannot start: unfinished box maintenance (${reason})`); this.name = "BackupMaintenanceError"; } }
export class BackupRepositoryInsideBoxError extends Error { constructor(repository: string) { super(`Backup repository is inside the box being captured: ${repository}`); this.name = "BackupRepositoryInsideBoxError"; } }
class MissingSecretStageError extends Error { constructor() { super("Backup inventory has no secret staging target"); this.name = "MissingSecretStageError"; } }
class MissingSnapshotIdError extends Error { constructor() { super("restic backup did not return a snapshot id"); this.name = "MissingSnapshotIdError"; } }
class InvalidSnapshotListError extends Error { constructor() { super("restic snapshots returned invalid JSON"); this.name = "InvalidSnapshotListError"; } }
export class BackupRepositoryIdentityError extends Error { constructor() { super("Restic repository is not bound to this box identity; after a reinstall, inspect its snapshots and pass --backup-id <uuid> to adopt it"); this.name = "BackupRepositoryIdentityError"; } }
class InvalidBackupIdError extends Error { constructor() { super("Backup identity must be a UUID from this box's restic snapshots"); this.name = "InvalidBackupIdError"; } }
class UnitHostNetworkRepositoryError extends Error { constructor() { super("A unit-host backup requires a network repository reachable from its sandbox"); this.name = "UnitHostNetworkRepositoryError"; } }
class UnitHostPasswordLocationError extends Error { constructor() { super("The password file must be under this box user's home on the unit host"); this.name = "UnitHostPasswordLocationError"; } }
class BackupPasswordPermissionsError extends Error { constructor() { super("Restic password file must be a regular file with permissions limited to its owner"); this.name = "BackupPasswordPermissionsError"; } }
class BackupTranscriptChangedError extends Error { constructor() { super("A per-box transcript changed while it was being staged; retry after the transcript writer is idle"); this.name = "BackupTranscriptChangedError"; } }
class TaggedSnapshotNotFoundError extends Error { constructor() { super("The verified snapshot could not be identified after tagging"); this.name = "TaggedSnapshotNotFoundError"; } }
class BackupMaintenanceOwnerExpiredError extends Error { constructor() { super("Backup lost its box maintenance lease; snapshot remains unverified"); this.name = "BackupMaintenanceOwnerExpiredError"; } }
class BackupMissingExternalStateError extends Error { constructor(kind: string) { super(`Backup expected ${kind} state, but it is missing`); this.name = "BackupMissingExternalStateError"; } }

const summaryLineSchema = z.object({ message_type: z.string().optional(), snapshot_id: z.string().optional() }).passthrough();
const snapshotLineSchema = z.object({ id: z.string(), time: z.string(), hostname: z.string(), paths: z.array(z.string()), tags: z.array(z.string()).nullable().optional() }).passthrough();
