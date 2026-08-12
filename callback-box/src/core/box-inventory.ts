import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import { attachDirFor, isAttachDirName, isInsideAttachScope } from "../shared/attach-path.js";
import { errorMessage } from "../lib/error-guards.js";

const EXCLUDED_DIRECTORY_NAMES = new Set([".git", ".callback-box", "node_modules"]);
const STAT_CONCURRENCY = 32;

export const BOX_INVENTORY_EXCLUSIONS = [".git/", ".callback-box/", "node_modules/"] as const;

export interface InventoryTypeSummary {
  type: string;
  count: number;
  bytes: number;
}

export interface BoxInventory {
  scannedAt: string;
  complete: boolean;
  filesystemErrors: string[];
  skippedPaths: number;
  direct: InventoryTypeSummary[];
  grouped: InventoryTypeSummary[];
  totals: {
    files: number;
    bytes: number;
    groupedItems: number;
  };
  orphanAttachmentDirectories: number;
  excludedDirectories: readonly string[];
}

interface FileRecord {
  relativePath: string;
  bytes: number;
}

interface CollectedTree {
  files: FileRecord[];
  attachmentDirectories: Set<string>;
  filesystemErrors: string[];
}

interface MutableSummary {
  count: number;
  bytes: number;
}

function cardParts(filename: string): { basename: string; type: string } | null {
  const match = /^(?<basename>.+)\.(?<type>[^.]+)\.card$/u.exec(filename);
  const basename = match?.groups?.["basename"];
  const type = match?.groups?.["type"];
  return basename === undefined || type === undefined ? null : { basename, type: `.${type}.card` };
}

function directType(relativePath: string): string {
  const filename = path.basename(relativePath);
  const card = cardParts(filename);
  if (card !== null) return card.type;
  const extension = path.extname(filename).toLowerCase();
  return extension.length === 0 ? "No extension" : extension;
}

function addSummary(input: {
  summaries: Map<string, MutableSummary>;
  type: string;
  bytes: number;
  count?: number;
}): void {
  const { summaries, type, bytes } = input;
  const count = input.count ?? 1;
  const summary = summaries.get(type) ?? { count: 0, bytes: 0 };
  summary.count += count;
  summary.bytes += bytes;
  summaries.set(type, summary);
}

function sortedSummaries(summaries: Map<string, MutableSummary>): InventoryTypeSummary[] {
  return [...summaries.entries()]
    .map(([type, summary]) => ({ type, ...summary }))
    .toSorted((a, b) => b.bytes - a.bytes || b.count - a.count || a.type.localeCompare(b.type));
}

async function collectFiles(boxRoot: string): Promise<CollectedTree> {
  const filePaths: string[] = [];
  const attachmentDirectories = new Set<string>();
  const pending = [boxRoot];
  const filesystemErrors: string[] = [];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (directory === undefined) break;
    let entries: Dirent<string>[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      filesystemErrors.push(`${path.relative(boxRoot, directory) || "."}: ${errorMessage(error)}`);
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && EXCLUDED_DIRECTORY_NAMES.has(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (isAttachDirName(entry.name)) {
          attachmentDirectories.add(path.relative(boxRoot, absolutePath));
        }
        pending.push(absolutePath);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        filePaths.push(absolutePath);
      }
    }
  }
  const files: FileRecord[] = [];
  let nextIndex = 0;
  async function statNext(): Promise<void> {
    while (nextIndex < filePaths.length) {
      const absolutePath = filePaths[nextIndex];
      nextIndex += 1;
      if (absolutePath === undefined) continue;
      try {
        let stat: Awaited<ReturnType<typeof fs.stat>>;
        try {
          stat = await fs.stat(absolutePath);
        } catch (error) {
          const linkStat = await fs.lstat(absolutePath).catch(() => null);
          if (linkStat === null || !linkStat.isSymbolicLink()) throw error;
          stat = linkStat;
        }
        files.push({ relativePath: path.relative(boxRoot, absolutePath), bytes: stat.size });
      } catch (error) {
        filesystemErrors.push(`${path.relative(boxRoot, absolutePath)}: ${errorMessage(error)}`);
      }
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(STAT_CONCURRENCY, filePaths.length) },
    statNext,
  ));
  return { files, attachmentDirectories, filesystemErrors };
}

export async function scanBoxInventory(
  boxRoot: string,
  options?: { now?: Date },
): Promise<BoxInventory> {
  const { files, attachmentDirectories, filesystemErrors } = await collectFiles(boxRoot);
  const direct = new Map<string, MutableSummary>();
  const grouped = new Map<string, MutableSummary>();
  const cardsByOwner = new Map<string, { cards: Array<{ type: string; bytes: number }>; attachmentBytes: number }>();

  for (const file of files) {
    addSummary({ summaries: direct, type: directType(file.relativePath), bytes: file.bytes });
    const parts = cardParts(path.basename(file.relativePath));
    const insideAttachmentScope = isInsideAttachScope(file.relativePath);
    if (parts !== null && !insideAttachmentScope) {
      const ownerPath = attachDirFor(file.relativePath);
      const owner = cardsByOwner.get(ownerPath) ?? { cards: [], attachmentBytes: 0 };
      owner.cards.push({ type: parts.type, bytes: file.bytes });
      cardsByOwner.set(ownerPath, owner);
    }
  }

  const ownedAttachmentFiles = new Set<string>();
  const orphanDirectories = new Map<string, { bytes: number; count: number }>();
  for (const directory of attachmentDirectories) {
    if (!isInsideAttachScope(path.dirname(directory)) && !cardsByOwner.has(directory)) {
      orphanDirectories.set(directory, { bytes: 0, count: 0 });
    }
  }
  for (const file of files) {
    const segments = file.relativePath.split(path.sep);
    const attachIndex = segments.findIndex(isAttachDirName);
    if (attachIndex === -1) continue;
    const attachDirectory = segments.slice(0, attachIndex + 1).join(path.sep);
    const owner = cardsByOwner.get(attachDirectory);
    if (owner !== undefined) {
      owner.attachmentBytes += file.bytes;
      ownedAttachmentFiles.add(file.relativePath);
    } else {
      const orphan = orphanDirectories.get(attachDirectory) ?? { bytes: 0, count: 0 };
      orphan.bytes += file.bytes;
      orphan.count += 1;
      orphanDirectories.set(attachDirectory, orphan);
    }
  }

  for (const owner of cardsByOwner.values()) {
    const cardBytes = owner.cards.reduce((total, card) => total + card.bytes, 0);
    const type = owner.cards.length === 1 ? owner.cards[0]?.type ?? "Unknown card" : "Ambiguous card basename";
    addSummary({ summaries: grouped, type, bytes: cardBytes + owner.attachmentBytes });
  }
  for (const file of files) {
    const isTopLevelCard = cardParts(path.basename(file.relativePath)) !== null &&
      !isInsideAttachScope(file.relativePath);
    if (isTopLevelCard || ownedAttachmentFiles.has(file.relativePath)) continue;
    if (isInsideAttachScope(file.relativePath)) continue;
    addSummary({ summaries: grouped, type: directType(file.relativePath), bytes: file.bytes });
  }
  for (const orphan of orphanDirectories.values()) {
    addSummary({ summaries: grouped, type: "Orphaned .attach/", bytes: orphan.bytes });
  }

  return {
    scannedAt: (options?.now ?? new Date()).toISOString(),
    complete: filesystemErrors.length === 0,
    filesystemErrors: filesystemErrors.slice(0, 5),
    skippedPaths: filesystemErrors.length,
    direct: sortedSummaries(direct),
    grouped: sortedSummaries(grouped),
    totals: {
      files: files.length,
      bytes: files.reduce((total, file) => total + file.bytes, 0),
      groupedItems: [...grouped.values()].reduce((total, summary) => total + summary.count, 0),
    },
    orphanAttachmentDirectories: orphanDirectories.size,
    excludedDirectories: BOX_INVENTORY_EXCLUSIONS,
  };
}
