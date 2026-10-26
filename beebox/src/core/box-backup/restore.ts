/** Restore only verified restic snapshots into an empty, isolated recovery directory. */
import { execa } from "execa";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { listSnapshots, type BackupSnapshot } from "./run/backup.js";
import { runRestic } from "./restic.js";

export interface RestoreBackupOptions {
  repository: string;
  passwordFile: string;
  target: string;
  snapshot?: string;
}

export interface RestoreBackupResult {
  snapshotId: string;
  boxPath: string;
  externalPath: string;
}

export class RestoreTargetNotEmptyError extends Error {
  constructor(target: string) { super(`restore target must be empty: ${target}`); this.name = "RestoreTargetNotEmptyError"; }
}
export class RestoreSnapshotNotFoundError extends Error {
  constructor(snapshot: string) { super(`snapshot ${snapshot} was not found as a verified snapshot`); this.name = "RestoreSnapshotNotFoundError"; }
}
export class RestoreSnapshotAmbiguousError extends Error {
  constructor(snapshot: string) { super(`snapshot prefix ${snapshot} matches more than one verified snapshot`); this.name = "RestoreSnapshotAmbiguousError"; }
}
export class NoVerifiedBackupError extends Error {
  constructor() { super("no verified backup snapshots are available"); this.name = "NoVerifiedBackupError"; }
}
export class InvalidRestoreSnapshotError extends Error {
  constructor() { super("selected snapshot is missing its Bee Box backup identity"); this.name = "InvalidRestoreSnapshotError"; }
}
export class RestoreSecretShareNotFoundError extends Error {
  constructor(backupId: string) { super(`verified snapshot ${backupId} does not contain its expected external secret share`); this.name = "RestoreSecretShareNotFoundError"; }
}
export class RestoredBoxNotFoundError extends Error {
  constructor() { super("restored snapshot does not contain a recognizable Bee Box root"); this.name = "RestoredBoxNotFoundError"; }
}
export class RestoreGitValidationError extends Error {
  constructor(boxPath: string, detail: string) { super(`Git validation failed for restored box at ${boxPath}; recovered files are preserved for inspection: ${detail}`); this.name = "RestoreGitValidationError"; }
}
export class RestoreAnnexValidationError extends Error {
  constructor(boxPath: string, detail: string) { super(`annex validation failed for restored box at ${boxPath}; recovered files are preserved for inspection: ${detail}`); this.name = "RestoreAnnexValidationError"; }
}

const packageSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  beebox: z.object({ shapeVersion: z.number().optional() }).optional(),
}).passthrough();

export async function restoreBoxBackup(options: RestoreBackupOptions): Promise<RestoreBackupResult> {
  const target = path.resolve(options.target);
  await assertEmptyTarget(target);
  const snapshots = await listSnapshots({ repository: options.repository, passwordFile: options.passwordFile });
  const selected = selectSnapshot(snapshots, options.snapshot);
  await fs.mkdir(target, { recursive: true });
  const staging = await fs.mkdtemp(path.join(target, ".bbx-restore-"));
  let boxOutput: string | null = null;
  let externalOutput: string | null = null;
  try {
    await runRestic({
      repository: options.repository,
      passwordFile: options.passwordFile,
      args: ["restore", selected.id, "--target", staging],
    });
    const recoveredRoot = await findBoxRoot(staging, selected.paths);
    const backupId = selected.tags.find((tag) => tag.startsWith("bbx-backup:"))?.slice("bbx-backup:".length);
    if (!backupId || selected.host !== backupId) throw new InvalidRestoreSnapshotError();
    const external = await findExternalRoot({ staging, snapshotPaths: selected.paths, backupId });
    const boxPath = path.join(target, "box");
    const externalPath = path.join(target, "external");
    boxOutput = boxPath;
    externalOutput = externalPath;
    await fs.rename(recoveredRoot, boxPath);
    await fs.rename(external, externalPath);
    await validateRecoveredBox(boxPath);
    return { snapshotId: selected.id, boxPath, externalPath };
  } catch (error) {
    // Validation failures preserve the complete recovered tree so an operator can inspect it.
    if (!(error instanceof RestoreGitValidationError || error instanceof RestoreAnnexValidationError)) {
      if (boxOutput) await fs.rm(boxOutput, { recursive: true, force: true });
      if (externalOutput) await fs.rm(externalOutput, { recursive: true, force: true });
    }
    throw error;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

function selectSnapshot(snapshots: BackupSnapshot[], requested?: string): BackupSnapshot {
  const verified = snapshots.filter((snapshot) => snapshot.tags.includes("verified") && snapshot.tags.some((tag) => tag.startsWith("bbx-backup:")) && snapshot.host === snapshot.tags.find((tag) => tag.startsWith("bbx-backup:"))?.slice("bbx-backup:".length));
  if (requested) {
    const exact = verified.find(({ id }) => id === requested);
    if (exact) return exact;
    const matches = verified.filter(({ id }) => id.startsWith(requested));
    if (matches.length > 1) throw new RestoreSnapshotAmbiguousError(requested);
    const match = matches.at(0);
    if (!match) throw new RestoreSnapshotNotFoundError(requested);
    return match;
  }
  const newest = verified.toSorted((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
  if (!newest) throw new NoVerifiedBackupError();
  return newest;
}

async function assertEmptyTarget(target: string): Promise<void> {
  const targetStat = await fs.lstat(target).catch((error) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  });
  if (targetStat?.isSymbolicLink() || (targetStat && !targetStat.isDirectory())) throw new RestoreTargetNotEmptyError(target);
  if (!targetStat) return;
  try {
    const entries = await fs.readdir(target);
    if (entries.length > 0) throw new RestoreTargetNotEmptyError(target);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
}

async function findBoxRoot(staging: string, snapshotPaths: string[]): Promise<string> {
  for (const source of snapshotPaths) {
    const candidate = path.join(staging, source.replace(/^[/\\]+/, ""));
    if (await isBoxRoot(candidate)) return candidate;
  }
  const found = await findBoxRootRecursively(staging, 5);
  if (!found) throw new RestoredBoxNotFoundError();
  return found;
}

async function findExternalRoot({ staging, snapshotPaths, backupId }: { staging: string; snapshotPaths: string[]; backupId: string }): Promise<string> {
  for (const source of snapshotPaths) {
    const parts = source.split(/[\\/]+/u).filter(Boolean);
    const stagingIndex = parts.findIndex((part, index) => part === "staging" && parts[index + 1] === backupId);
    if (stagingIndex === -1 || parts[stagingIndex + 2] !== "secrets" || !parts[stagingIndex + 3]?.endsWith(".json")) continue;
    const root = path.join(staging, ...parts.slice(0, stagingIndex + 2));
    const secret = path.join(root, ...parts.slice(stagingIndex + 2));
    if (await exists(secret)) return root;
  }
  throw new RestoreSecretShareNotFoundError(backupId);
}

async function findBoxRootRecursively(directory: string, depth: number): Promise<string | null> {
  if (await isBoxRoot(directory)) return directory;
  if (depth === 0) return null;
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => null);
  if (!entries) return null;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === ".git") continue;
    const found = await findBoxRootRecursively(path.join(directory, entry.name), depth - 1);
    if (found) return found;
  }
  return null;
}

async function isBoxRoot(directory: string): Promise<boolean> {
  try {
    const pkg = packageSchema.parse(JSON.parse(await fs.readFile(path.join(directory, "package.json"), "utf8")));
    return Boolean(pkg.dependencies?.beebox && pkg.beebox?.shapeVersion === 3 && (await fs.stat(path.join(directory, "_config")).catch(() => null))?.isDirectory());
  } catch (_error) { return false; }
}

async function validateRecoveredBox(boxPath: string): Promise<void> {
  const safeDirectory = `safe.directory=${boxPath}`;
  const git = await execa("git", ["-c", safeDirectory, "fsck", "--no-reflogs", "--connectivity-only"], { cwd: boxPath, reject: false }).catch((error) => {
    throw new RestoreGitValidationError(boxPath, String(error));
  });
  if (git.exitCode !== 0) throw new RestoreGitValidationError(boxPath, git.stderr.trim());
  if (await exists(path.join(boxPath, ".git", "annex"))) {
    const annex = await execa("git", ["-c", safeDirectory, "annex", "fsck"], { cwd: boxPath, reject: false }).catch((error) => {
      throw new RestoreAnnexValidationError(boxPath, String(error));
    });
    if (annex.exitCode !== 0) throw new RestoreAnnexValidationError(boxPath, annex.stderr.trim());
  }
}

async function exists(file: string): Promise<boolean> {
  try { await fs.access(file); return true; } catch (_error) { return false; }
}
