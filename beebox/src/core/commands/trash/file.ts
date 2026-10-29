/** Trash one bare (non-card) file with the same destination naming as a card trash. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getBoxDir, isCardFile } from "../../../lib/paths/core.js";
import { resolveCliTargetPath } from "../../../cli/lib/cli-target-path.js";
import { NotFoundError } from "../../../lib/errors.js";
import { invariant } from "../../../shared/invariant.js";
import { pathExistsStrict } from "../../../lib/file-exists.js";
import { getBoxTime } from "../../../lib/time.js";
import { assertSafeTrashDestination } from "./namespace-guard.js";
import { withCollisionStamp, type TrashReceipt } from "./command.js";

/** Move a bare file into `_bookkeeping/trash/`; a taken name gets `_<stamp>` before its extension. */
export async function moveFileToTrash(boxRoot: string, ref: string): Promise<TrashReceipt> {
  const sourcePath = resolveCliTargetPath({ boxRoot, raw: ref, relativeTo: boxRoot });
  invariant(!isCardFile(sourcePath), `moveFileToTrash takes a bare file, not a card: ${ref}`);
  if (!await pathExistsStrict(sourcePath, { followLinks: false })) throw new NotFoundError(ref, "File");
  const trashDir = getBoxDir(boxRoot, "trash");
  const basename = path.basename(sourcePath);
  let destPath = path.join(trashDir, basename);
  if (await pathExistsStrict(destPath, { followLinks: false })) {
    const stamp = getBoxTime(boxRoot).toISOString().replace(/[.:]/g, "-");
    const ext = path.extname(basename);
    destPath = path.join(trashDir, `${withCollisionStamp(basename.slice(0, basename.length - ext.length), stamp)}${ext}`);
  }
  await fs.mkdir(trashDir, { recursive: true });
  await assertSafeTrashDestination(boxRoot, destPath);
  await fs.rename(sourcePath, destPath);
  const move = { sourcePath: path.relative(boxRoot, sourcePath), destPath: path.relative(boxRoot, destPath) };
  return { moves: [{ ...move, relatedFiles: [], fileMoves: [move] }], gitPaths: [move.sourcePath, move.destPath] };
}
