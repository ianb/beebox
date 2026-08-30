import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import { attachDirFor, isAttachDirName, isInsideAttachScope } from "../shared/attach-path.js";
import { errorMessage } from "../lib/error-guards.js";
import { findLinkedCardPaths } from "./find-inbound-card-refs.js";
import { scanBoxRepositoryStats, type BoxRepositoryStats } from "./box-repository-stats.js";

const EXCLUDED_DIRECTORY_NAMES = new Set([".git", ".beebox", "node_modules"]);
const STAT_CONCURRENCY = 32;

const BOX_INVENTORY_EXCLUSIONS = [".git/", ".beebox/", "node_modules/"] as const;

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
  linkStatusComplete: boolean;
  direct: InventoryTypeSummary[];
  grouped: InventoryTypeSummary[];
  byLinkStatus: {
    linked: { direct: InventoryTypeSummary[]; grouped: InventoryTypeSummary[] };
    unlinked: { direct: InventoryTypeSummary[]; grouped: InventoryTypeSummary[] };
  };
  repository: BoxRepositoryStats;
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
  linkStatus?: "linked" | "unlinked";
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

interface CardOwner {
  cards: Array<{ path: string; type: string; bytes: number }>;
  attachmentBytes: number;
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

function summarizeCardOwners(input: {
  cardsByOwner: Map<string, CardOwner>;
  linkedCardPaths: Set<string>;
  grouped: Map<string, MutableSummary>;
  linkedGrouped: Map<string, MutableSummary>;
  unlinkedGrouped: Map<string, MutableSummary>;
}): void {
  for (const owner of input.cardsByOwner.values()) {
    const cardBytes = owner.cards.reduce((total, card) => total + card.bytes, 0);
    const type = owner.cards.length === 1 ? owner.cards[0]?.type ?? "Unknown card" : "Ambiguous card basename";
    const bytes = cardBytes + owner.attachmentBytes;
    addSummary({ summaries: input.grouped, type, bytes });
    const filtered = owner.cards.some((card) => input.linkedCardPaths.has(card.path))
      ? input.linkedGrouped
      : input.unlinkedGrouped;
    addSummary({ summaries: filtered, type, bytes });
  }
}

function summarizeDirectCards(input: {
  files: FileRecord[];
  cardsByOwner: Map<string, CardOwner>;
  linkedCardPaths: Set<string>;
  linkedDirect: Map<string, MutableSummary>;
  unlinkedDirect: Map<string, MutableSummary>;
}): void {
  for (const file of input.files) {
    const parts = cardParts(path.basename(file.relativePath));
    if (parts !== null && !isInsideAttachScope(file.relativePath)) {
      file.linkStatus = input.linkedCardPaths.has(file.relativePath) ? "linked" : "unlinked";
      addSummary({
        summaries: file.linkStatus === "linked" ? input.linkedDirect : input.unlinkedDirect,
        type: directType(file.relativePath),
        bytes: file.bytes,
      });
      continue;
    }
    const segments = file.relativePath.split(path.sep);
    const attachIndex = segments.findIndex(isAttachDirName);
    if (attachIndex === -1) continue;
    const owner = input.cardsByOwner.get(segments.slice(0, attachIndex + 1).join(path.sep));
    if (owner === undefined) continue;
    file.linkStatus = owner.cards.some((card) => input.linkedCardPaths.has(card.path)) ? "linked" : "unlinked";
    addSummary({
      summaries: file.linkStatus === "linked" ? input.linkedDirect : input.unlinkedDirect,
      type: directType(file.relativePath),
      bytes: file.bytes,
    });
  }
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
  const linkedDirect = new Map<string, MutableSummary>();
  const unlinkedDirect = new Map<string, MutableSummary>();
  const linkedGrouped = new Map<string, MutableSummary>();
  const unlinkedGrouped = new Map<string, MutableSummary>();
  const cardsByOwner = new Map<string, CardOwner>();

  for (const file of files) {
    addSummary({ summaries: direct, type: directType(file.relativePath), bytes: file.bytes });
    const parts = cardParts(path.basename(file.relativePath));
    const insideAttachmentScope = isInsideAttachScope(file.relativePath);
    if (parts !== null && !insideAttachmentScope) {
      const ownerPath = attachDirFor(file.relativePath);
      const owner = cardsByOwner.get(ownerPath) ?? { cards: [], attachmentBytes: 0 };
      owner.cards.push({ path: file.relativePath, type: parts.type, bytes: file.bytes });
      cardsByOwner.set(ownerPath, owner);
    }
  }
  let linkedCardPaths = new Set<string>();
  let linkStatusComplete = true;
  try {
    const result = await findLinkedCardPaths({
      boxRoot,
      cardPaths: [...cardsByOwner.values()].flatMap((owner) => owner.cards.map((card) => card.path)),
    });
    linkedCardPaths = result.linked;
    if (result.errors.length > 0) {
      linkStatusComplete = false;
      filesystemErrors.push(...result.errors.map((error) => `Reference scan: ${error}`));
    }
  } catch (error) {
    linkStatusComplete = false;
    filesystemErrors.push(`Reference scan: ${errorMessage(error)}`);
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

  summarizeCardOwners({ cardsByOwner, linkedCardPaths, grouped, linkedGrouped, unlinkedGrouped });
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
  summarizeDirectCards({ files, cardsByOwner, linkedCardPaths, linkedDirect, unlinkedDirect });
  const repository = await scanBoxRepositoryStats(boxRoot, files);

  return {
    scannedAt: (options?.now ?? new Date()).toISOString(),
    complete: filesystemErrors.length === 0,
    filesystemErrors: filesystemErrors.slice(0, 5),
    skippedPaths: filesystemErrors.length,
    linkStatusComplete,
    direct: sortedSummaries(direct),
    grouped: sortedSummaries(grouped),
    byLinkStatus: {
      linked: { direct: sortedSummaries(linkedDirect), grouped: sortedSummaries(linkedGrouped) },
      unlinked: { direct: sortedSummaries(unlinkedDirect), grouped: sortedSummaries(unlinkedGrouped) },
    },
    repository,
    totals: {
      files: files.length,
      bytes: files.reduce((total, file) => total + file.bytes, 0),
      groupedItems: [...grouped.values()].reduce((total, summary) => total + summary.count, 0),
    },
    orphanAttachmentDirectories: orphanDirectories.size,
    excludedDirectories: BOX_INVENTORY_EXCLUSIONS,
  };
}
