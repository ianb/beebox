import * as path from "node:path";
import * as fs from "node:fs/promises";
import { unstageFiles } from "../../../../lib/git/core/operations.js";
import type { TrashReceipt } from "../../../commands/trash/command.js";

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
