/**
 * What of this box actually exists somewhere other than this machine.
 *
 * A box's git history and its assets travel by different mechanisms, and the
 * difference is invisible until you need a backup. `git push` carries cards,
 * text, and — on an annexed box — the annex POINTERS. It never carries the
 * asset bytes: those live under `.git/annex/objects` and only move to a remote
 * that git-annex knows about (one with an `annex-uuid`). A box whose only
 * remote is plain GitHub therefore pushes every filename and no photo, and
 * says nothing about it.
 *
 * This module answers that in one shot, cheaply enough to compute on a page
 * load: every measurement below is a single git call or one directory walk
 * (~25ms warm even on an 11 GB box, because `count-objects` and `du` on the
 * annex tree do not read file contents).
 *
 * Read-only: nothing here fetches, pushes, or writes.
 */

import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Why a box's assets are not reachable from anywhere but this machine. */
export type AssetRiskReason =
  /** Annexed and tracked, but no remote can hold annex content — bytes are here only. */
  | "no-annex-remote"
  /** Not annexed at all: the files are gitignored, so git carries not even a pointer. */
  | "not-tracked";

export interface AssetRisk {
  reason: AssetRiskReason;
  fileCount: number;
  bytes: number;
}

export interface BackupStatus {
  /**
   * The push remote, or null when the box has none configured at all.
   * `offsite` is false for a remote that is another directory on this same
   * machine — still a second copy, but not one that survives losing the disk.
   */
  remote: { name: string; url: string; offsite: boolean } | null;
  /**
   * Commits not on the remote / not local, or null when no upstream is
   * configured. Computed from the cached remote-tracking ref — this never
   * touches the network, so it is "as of the last fetch", not live.
   */
  upstream: { ahead: number; behind: number } | null;
  /** Git object store size: loose objects plus packs. */
  repoBytes: number;
  /** Annex object store size and file count, or null when not an annex repo. */
  annex: { bytes: number; fileCount: number } | null;
  /** Assets that exist only on this machine, or null when nothing is at risk. */
  assetRisk: AssetRisk | null;
}

/**
 * Sum the byte counts out of `git count-objects -vH`.
 *
 * The `-H` output is human-readable ("size-pack: 133.62 MiB"), which is the
 * only form that reports packs, so the units come back as text and have to be
 * multiplied out. `size` and `size-pack` are the two that hold bytes; the
 * other keys are counts.
 */
export function parseCountObjects(text: string): number {
  const units: Record<string, number> = {
    bytes: 1,
    KiB: 1024,
    MiB: 1024 ** 2,
    GiB: 1024 ** 3,
    TiB: 1024 ** 4,
  };
  let total = 0;
  for (const line of text.split("\n")) {
    const match = /^(size|size-pack):\s+([\d.]+)\s+(\w+)$/.exec(line.trim());
    if (match === null) continue;
    const value = Number(match[2]);
    const unit = units[match[3] ?? ""];
    if (!Number.isFinite(value) || unit === undefined) continue;
    total += value * unit;
  }
  return Math.round(total);
}

/**
 * Is this remote somewhere other than this machine?
 *
 * git-annex is happy to treat a sibling clone at `/Users/me/boxes/thing` as a
 * content remote, and for its purposes that is correct — the bytes really are
 * reachable. For a BACKUP question it is not: a local path dies with the disk.
 * Anything that names a host (ssh, https, git://) counts; a filesystem path,
 * `file://`, or a `~` expansion does not.
 */
export function isOffsiteRemoteUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed === "") return false;
  if (trimmed.startsWith("file://")) return false;
  if (/^[a-z][\d+.a-z-]*:\/\//i.test(trimmed)) return true;
  // scp-style `user@host:path` — a colon before any slash, with a host in front.
  if (/^[^/]+@[^/:]+:/.test(trimmed)) return true;
  return false;
}

/**
 * Decide what, if anything, is stranded on this machine.
 *
 * The two cases are genuinely different and a boxholder needs to tell them
 * apart: an annexed box with no annex remote has its filenames backed up and
 * its bytes not, while an un-annexed box has assets git never sees at all —
 * the second is worse, and no amount of pushing fixes it.
 */
export function assessAssetRisk(input: {
  annex: { bytes: number; fileCount: number } | null;
  annexRemoteConfigured: boolean;
  untrackedAssets: { bytes: number; fileCount: number };
}): AssetRisk | null {
  if (input.annex !== null) {
    if (input.annexRemoteConfigured || input.annex.fileCount === 0) return null;
    return { reason: "no-annex-remote", ...input.annex };
  }
  if (input.untrackedAssets.fileCount === 0) return null;
  return { reason: "not-tracked", ...input.untrackedAssets };
}

async function git(repoRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repoRoot, ...args], {
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
}

/** Best-effort git call: a query that fails answers "unknown", never throws. */
async function gitOrNull(repoRoot: string, args: string[]): Promise<string | null> {
  try {
    return await git(repoRoot, args);
  } catch (_e) {
    // Every caller below is asking an optional question (is there an upstream?
    // a remote?), and git's way of saying "no" is a non-zero exit.
    return null;
  }
}

/** Recursive size + count of one directory, or zeroes when it does not exist. */
async function measureDir(dir: string): Promise<{ bytes: number; fileCount: number }> {
  let bytes = 0;
  let fileCount = 0;
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (_e) {
    // Absent (no annex, no attachments) is a legitimate answer, not an error.
    return { bytes: 0, fileCount: 0 };
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await measureDir(full);
      bytes += sub.bytes;
      fileCount += sub.fileCount;
    } else if (entry.isFile()) {
      try {
        bytes += (await fs.stat(full)).size;
        fileCount += 1;
      } catch (_e) {
        // Raced with a delete mid-walk; a backup summary can lose one file.
      }
    }
  }
  return { bytes, fileCount };
}

/**
 * Walk the box for `*.attach/` payloads — the un-annexed case.
 *
 * Only reached when the box has no annex, where these files are gitignored and
 * therefore invisible to git. Skips `.git` and `node_modules`, which are not
 * box content and would dominate the walk.
 */
async function measureUntrackedAssets(dir: string): Promise<{ bytes: number; fileCount: number }> {
  let bytes = 0;
  let fileCount = 0;
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (_e) {
    return { bytes: 0, fileCount: 0 };
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    const sub = entry.name.endsWith(".attach")
      ? await measureDir(full)
      : await measureUntrackedAssets(full);
    bytes += sub.bytes;
    fileCount += sub.fileCount;
  }
  return { bytes, fileCount };
}

/**
 * Is any remote both able to hold annex content and actually elsewhere?
 *
 * A remote that can hold annex content has an annex-uuid recorded for it;
 * plain GitHub never does, which is the case worth surfacing. Only an OFFSITE
 * one counts: a sibling clone on this disk satisfies git-annex and answers the
 * wrong question for a backup.
 */
async function hasOffsiteAnnexRemote(topLevel: string): Promise<boolean> {
  const configured = (await gitOrNull(topLevel, ["config", "--get-regexp", "remote\\..*\\.annex-uuid"])) ?? "";
  for (const line of configured.split("\n")) {
    const name = /^remote\.(.+)\.annex-uuid\s/.exec(line.trim())?.[1];
    if (name === undefined) continue;
    const url = (await gitOrNull(topLevel, ["remote", "get-url", name]))?.trim() ?? "";
    if (isOffsiteRemoteUrl(url)) return true;
  }
  return false;
}

/**
 * Gather the backup posture of the box containing `boxRoot`.
 *
 * `boxRoot` may be the operational box (`content/`) or the package root — git
 * resolves the repository either way, and a v2 box keeps its `.git` at the
 * package root while callers usually hold the content path.
 */
export async function getBackupStatus(boxRoot: string): Promise<BackupStatus> {
  const topLevel = (await gitOrNull(boxRoot, ["rev-parse", "--show-toplevel"]))?.trim();
  if (topLevel === undefined || topLevel === "") {
    throw new NotAGitBoxError(boxRoot);
  }

  const remoteName = (await gitOrNull(topLevel, ["remote"]))?.trim().split("\n")[0] ?? "";
  const remoteUrl =
    remoteName === ""
      ? null
      : (await gitOrNull(topLevel, ["remote", "get-url", remoteName]))?.trim() ?? null;

  const counts = (await gitOrNull(topLevel, ["rev-list", "--left-right", "--count", "@{u}...HEAD"]))?.trim();
  const [behindText, aheadText] = counts?.split(/\s+/) ?? [];
  const behind = Number(behindText);
  const ahead = Number(aheadText);
  const upstream =
    Number.isFinite(behind) && Number.isFinite(ahead) ? { ahead, behind } : null;

  const repoBytes = parseCountObjects((await gitOrNull(topLevel, ["count-objects", "-vH"])) ?? "");

  const annexDir = path.join(topLevel, ".git", "annex", "objects");
  const annexMeasured = await measureDir(annexDir);
  const isAnnex = await fs
    .stat(path.join(topLevel, ".git", "annex"))
    .then(() => true)
    .catch(() => false);
  const annex = isAnnex ? annexMeasured : null;

  const annexRemoteConfigured = await hasOffsiteAnnexRemote(topLevel);

  const untrackedAssets = isAnnex ? { bytes: 0, fileCount: 0 } : await measureUntrackedAssets(topLevel);

  return {
    remote:
      remoteName === "" || remoteUrl === null
        ? null
        : { name: remoteName, url: remoteUrl, offsite: isOffsiteRemoteUrl(remoteUrl) },
    upstream,
    repoBytes,
    annex,
    assetRisk: assessAssetRisk({ annex, annexRemoteConfigured, untrackedAssets }),
  };
}

/** The box is not a git repository, so there is no backup posture to report. */
export class NotAGitBoxError extends Error {
  constructor(boxRoot: string) {
    super(`${boxRoot} is not inside a git repository`);
    this.name = "NotAGitBoxError";
  }
}
