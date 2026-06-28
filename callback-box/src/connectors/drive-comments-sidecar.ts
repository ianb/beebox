/**
 * Comments sidecar shared by the Docs and Sheets drive handlers.
 *
 * Google Drive comments (collaborative feedback — the often most valuable part
 * of a shared doc) are fetched via the Drive comments API but don't live in the
 * exported body. This writes them as a raw JSON sidecar next to the exported
 * content inside the card's attach scope (`<basename>.comments.json`), so box
 * agents can read the full thread: content, author, timestamps, resolved
 * status, the anchored text, and replies.
 *
 * The sidecar is a derived, read-only artifact — it is regenerated from
 * upstream on every pull and is never pushed back. So it is deliberately NOT
 * tracked in `state.contentHashes` (the Sheets push loop pushes every tracked
 * `.json`; keeping the sidecar out of state keeps it from being mistaken for
 * sheet data). The card references it via a `comments: { ref }` field.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { DriveComment } from "../services/google-drive.js";

/** Bare filename of the comments sidecar within an attach scope. */
function commentsFilename(basename: string): string {
  return `${basename}.comments.json`;
}

export interface CommentsSidecarResult {
  /** Bare in-scope filename when comments exist, else undefined. */
  commentsFile?: string;
  /** Box-relative paths written (for the sync's `written` list). */
  written: string[];
  changed: boolean;
}

/**
 * Reconcile the comments sidecar for one card.
 *
 * Writes `<basename>.comments.json` (a JSON array of the raw comment objects)
 * when there are comments and the content differs from what's on disk; deletes
 * a stale sidecar when comments have dropped to zero. Returns the bare filename
 * to reference from the card, plus what changed.
 */
export async function reconcileCommentsSidecar(opts: {
  localDir: string;
  basename: string;
  comments: DriveComment[];
  boxRoot: string;
}): Promise<CommentsSidecarResult> {
  const { localDir, basename, comments, boxRoot } = opts;
  const filename = commentsFilename(basename);
  const filePath = path.join(localDir, filename);
  const result: CommentsSidecarResult = { written: [], changed: false };

  if (comments.length === 0) {
    // No comments upstream — remove any stale sidecar from a previous sync.
    // Report the path in `written` so the connector stages the deletion
    // (`git add <path>` stages a removed file); otherwise the commit would
    // leave the deletion behind in the working tree.
    try {
      await fs.unlink(filePath);
      result.written.push(path.relative(boxRoot, filePath));
      result.changed = true;
    } catch (e) {
      // Absent is the normal case; anything else is worth noting.
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        console.debug(`drive-comments-sidecar: could not remove ${filePath}:`, e);
      }
    }
    return result;
  }

  const content = JSON.stringify(comments, null, 2) + "\n";

  let existing = "";
  try {
    existing = await fs.readFile(filePath, "utf-8");
  } catch (e) {
    // Missing file — write it below; note anything other than absence.
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.debug(`drive-comments-sidecar: could not read ${filePath}, rewriting:`, e);
    }
  }

  result.commentsFile = filename;
  if (existing !== content) {
    await fs.mkdir(localDir, { recursive: true });
    await fs.writeFile(filePath, content);
    result.written.push(path.relative(boxRoot, filePath));
    result.changed = true;
  }
  return result;
}
