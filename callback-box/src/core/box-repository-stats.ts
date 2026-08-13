/** Repository-level disk and Git-annex accounting for the box inventory. */

import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { getBoxShape } from "../lib/box-shape.js";
import { isAnnexInitialized } from "./annex/is-annex-box.js";

const execFileAsync = promisify(execFile);
const annexFindLine = z.object({ file: z.string(), bytesize: z.string().optional() });

export interface StorageBreakdown {
  annexed: { files: number; bytes: number };
  regular: { files: number; bytes: number };
}

export interface BoxRepositoryStats {
  checkoutDiskBytes: number;
  gitDiskBytes: number;
  annexed: boolean;
  complete: boolean;
  annexQueryAvailable: boolean;
  storage: {
    all: StorageBreakdown;
    linked: StorageBreakdown;
    unlinked: StorageBreakdown;
  };
}

export interface RepositoryFile {
  relativePath: string;
  bytes: number;
  linkStatus?: "linked" | "unlinked";
}

async function allocatedDiskBytes(root: string): Promise<{ bytes: number; complete: boolean }> {
  const pending = [root];
  const seen = new Set<string>();
  let total = 0;
  let complete = true;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    const stat = await fs.lstat(current).catch(() => {
      complete = false;
      return null;
    });
    if (stat === null) continue;
    const identity = `${String(stat.dev)}:${String(stat.ino)}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    total += stat.blocks * 512;
    if (!stat.isDirectory()) continue;
    const entries = await fs.readdir(current).catch(() => {
      complete = false;
      return [];
    });
    for (const entry of entries) pending.push(path.join(current, entry));
  }
  return { bytes: total, complete };
}

interface AnnexedFile {
  bytes?: number;
}

async function annexedFiles(packageRoot: string, boxRoot: string): Promise<{
  available: boolean;
  files: Map<string, AnnexedFile>;
}> {
  try {
    const { stdout } = await execFileAsync("git", ["annex", "find", "--anything", "--json"], {
      cwd: packageRoot,
      maxBuffer: 64 * 1024 * 1024,
    });
    const result = new Map<string, AnnexedFile>();
    for (const line of stdout.split("\n")) {
      if (line === "") continue;
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch (_error) {
        continue;
      }
      const parsed = annexFindLine.safeParse(json);
      if (!parsed.success) continue;
      const relativePath = path.relative(boxRoot, path.resolve(packageRoot, parsed.data.file));
      if (!relativePath.startsWith(`..${path.sep}`) && relativePath !== "..") {
        const bytes = parsed.data.bytesize === undefined ? undefined : Number(parsed.data.bytesize);
        result.set(relativePath, bytes !== undefined && Number.isFinite(bytes) ? { bytes } : {});
      }
    }
    return { available: true, files: result };
  } catch (_error) {
    return { available: false, files: new Map() };
  }
}

function emptyStorageBreakdown(): StorageBreakdown {
  return { annexed: { files: 0, bytes: 0 }, regular: { files: 0, bytes: 0 } };
}

function addStorage(input: {
  breakdown: StorageBreakdown;
  file: RepositoryFile;
  annexed: AnnexedFile | undefined;
}): void {
  const { breakdown, file, annexed } = input;
  const target = annexed === undefined ? breakdown.regular : breakdown.annexed;
  target.files += 1;
  target.bytes += annexed?.bytes ?? file.bytes;
}

export async function scanBoxRepositoryStats(boxRoot: string, files: RepositoryFile[]): Promise<BoxRepositoryStats> {
  const shape = await getBoxShape(boxRoot);
  const [annexed, annexInitialized, checkoutDisk, gitDisk] = await Promise.all([
    annexedFiles(shape.packageRoot, shape.boxRoot),
    isAnnexInitialized(shape.packageRoot),
    allocatedDiskBytes(shape.packageRoot),
    allocatedDiskBytes(path.join(shape.packageRoot, ".git")),
  ]);
  const storage = {
    all: emptyStorageBreakdown(),
    linked: emptyStorageBreakdown(),
    unlinked: emptyStorageBreakdown(),
  };
  for (const file of files) {
    const annexedFile = annexed.files.get(file.relativePath);
    addStorage({ breakdown: storage.all, file, annexed: annexedFile });
    if (file.linkStatus !== undefined) {
      addStorage({ breakdown: storage[file.linkStatus], file, annexed: annexedFile });
    }
  }
  return {
    checkoutDiskBytes: checkoutDisk.bytes,
    gitDiskBytes: gitDisk.bytes,
    annexed: annexInitialized,
    complete: checkoutDisk.complete && gitDisk.complete,
    annexQueryAvailable: annexed.available,
    storage,
  };
}
