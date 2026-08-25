import * as path from "node:path";
import * as fs from "node:fs/promises";
import { simpleGit } from "simple-git";
import { gitBoxPrefix, unstageFiles } from "../../lib/git.js";
import { attachDirFor } from "../../shared/attach-path.js";
import type { TrashMove, TrashReceipt } from "./trash.js";

class TrashReceiptRecoveryError extends Error {
  constructor(destPath: string) {
    super(`Could not recover the pending git rename for ${destPath}`);
    this.name = "TrashReceiptRecoveryError";
  }
}

/** Undo an uncommitted trash receipt, including attachment scopes and index entries. */
export async function rollbackTrashReceipt(boxRoot: string, receipt: TrashReceipt): Promise<void> {
  await unstageFiles(boxRoot, receipt.gitPaths);
  for (const move of receipt.moves.toReversed()) {
    for (const fileMove of move.fileMoves.toReversed()) {
      const source = path.join(boxRoot, fileMove.sourcePath);
      const dest = path.join(boxRoot, fileMove.destPath);
      await fs.mkdir(path.dirname(source), { recursive: true });
      await fs.rename(dest, source);
    }
  }
}

function withoutBoxPrefix(filePath: string, prefix: string): string {
  return prefix !== "" && filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
}

/** Reconstruct an uncommitted trash receipt from git's rename status after restart. */
export async function recoverTrashReceipt(boxRoot: string, destPaths: string[]): Promise<TrashReceipt> {
  const [status, prefix] = await Promise.all([simpleGit(boxRoot).status(), gitBoxPrefix(boxRoot)]);
  const renamed = status.renamed.map((entry) => ({
    from: withoutBoxPrefix(entry.from, prefix),
    to: withoutBoxPrefix(entry.to, prefix),
  }));
  const moves: TrashMove[] = [];
  const gitPaths: string[] = [];
  for (const destPath of destPaths) {
    let cardRename = renamed.find((entry) => entry.to === destPath);
    if (cardRename === undefined) {
      const changed = [...status.staged, ...status.created, ...status.modified, ...status.deleted, ...status.not_added].map((entry) => withoutBoxPrefix(entry, prefix));
      if (!changed.includes(destPath)) continue;
      const deleted = status.deleted.map((entry) => withoutBoxPrefix(entry, prefix)).filter((entry) => entry.endsWith(".chat.card"));
      const sameName = deleted.filter((entry) => path.basename(entry) === path.basename(destPath));
      const sourcePath = sameName.length === 1 ? sameName[0] : deleted.length === 1 ? deleted[0] : undefined;
      if (sourcePath === undefined) throw new TrashReceiptRecoveryError(destPath);
      cardRename = { from: sourcePath, to: destPath };
    }
    moves.push({
      sourcePath: cardRename.from,
      destPath,
      relatedFiles: [],
      fileMoves: [{ sourcePath: cardRename.from, destPath }],
    });
    gitPaths.push(cardRename.from, destPath);
    const sourceAttach = path.relative(boxRoot, attachDirFor(path.join(boxRoot, cardRename.from)));
    const destAttach = path.relative(boxRoot, attachDirFor(path.join(boxRoot, destPath)));
    for (const entry of renamed) {
      if (entry.from.startsWith(`${sourceAttach}${path.sep}`) || entry.to.startsWith(`${destAttach}${path.sep}`)) gitPaths.push(entry.from, entry.to);
    }
  }
  return { moves, gitPaths: [...new Set(gitPaths)] };
}
