/**
 * Undo for a scan-import session whose commit never landed.
 *
 * The upload ledger records a file's hash only after its import succeeds, so a
 * failed import that leaves its session behind is imported again, in full, by
 * every retry. On 2026-09-28 a commit that failed on every promote pass turned
 * 24 PDFs into 159 staged-but-uncommitted sessions. Discarding the uncommitted
 * session makes a retry start from nothing. Once the session card is in HEAD
 * the import belongs to the box, and a later failure leaves it alone.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { simpleGit } from "simple-git";
import { hasCommits, unstageFiles } from "../../../lib/git/core.js";
import type { CommandResult } from "../../command-types.js";
import type { SessionLayout } from "./session.js";

/**
 * Run one import into a fresh session, removing everything it wrote when it
 * fails before its commit lands. `run` pushes each box-relative path it writes
 * outside the session (question cards) onto `written`; the session card and
 * attach scope are always covered.
 */
export async function importSessionOrDiscard(
  boxRoot: string,
  { layout, run }: { layout: SessionLayout; run: (written: string[]) => Promise<CommandResult> },
): Promise<CommandResult> {
  const written: string[] = [];
  let result: CommandResult;
  try {
    result = await run(written);
  } catch (error) {
    await discardOrReport(boxRoot, { layout, written });
    throw error;
  }
  if (!result.success) await discardOrReport(boxRoot, { layout, written });
  return result;
}

/** A discard that fails must not replace the import's own error. */
async function discardOrReport(boxRoot: string, opts: { layout: SessionLayout; written: string[] }): Promise<void> {
  try {
    await discardUncommittedSession(boxRoot, opts);
  } catch (error) {
    console.error(`[scan-import] Could not discard failed session ${opts.layout.sessionCardRelPath}; a retry may import it again:`, error);
  }
}

async function discardUncommittedSession(
  boxRoot: string,
  { layout, written }: { layout: SessionLayout; written: string[] },
): Promise<void> {
  if (await pathInHead(boxRoot, layout.sessionCardRelPath)) return;
  const inSession = (p: string): boolean => p.startsWith(`${layout.sessionAttachRelDir}/`);
  const paths = [layout.sessionCardRelPath, layout.sessionAttachRelDir, ...written.filter((p) => !inSession(p))];
  // Unstage before deleting: a staged entry whose file is gone would still be
  // swept into the box's next commit.
  if (await hasCommits(boxRoot)) await unstageFiles(boxRoot, paths);
  for (const p of paths) await fs.rm(path.join(boxRoot, p), { recursive: true, force: true });
}

async function pathInHead(boxRoot: string, relPath: string): Promise<boolean> {
  if (!(await hasCommits(boxRoot))) return false;
  const listed = await simpleGit(boxRoot).raw(["ls-tree", "--name-only", "HEAD", "--", relPath]);
  return listed.trim() !== "";
}
