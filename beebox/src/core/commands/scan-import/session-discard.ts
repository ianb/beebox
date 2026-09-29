/**
 * Failure handling on either side of a scan-import session's commit.
 *
 * The upload ledger records a file's hash only after its import succeeds, so a
 * failed import that leaves its session behind is imported again, in full, by
 * every retry. On 2026-09-28 a commit that failed on every promote pass turned
 * 24 PDFs into 159 staged-but-uncommitted sessions. Discarding the uncommitted
 * session makes a retry start from nothing. Once any of the session is in HEAD
 * it belongs to the box: a later failure leaves it alone, and a failure to
 * queue it for triage does not fail the import.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { simpleGit } from "simple-git";
import { hasCommits, unstageFiles } from "../../../lib/git/core.js";
import type { CommandResult } from "../../command-types.js";
import { createOrAppendIntakeJob } from "../../../job-cards/intake-utils.js";
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
  const inSession = (p: string): boolean => p.startsWith(`${layout.sessionAttachRelDir}/`);
  const paths = [layout.sessionCardRelPath, layout.sessionAttachRelDir, ...written.filter((p) => !inSession(p))];
  // A whole-tree commit (a wakeup sweep) can land part of a session while the
  // import is still running. Committed content is the box's; deleting it
  // would stage a deletion, so a partly committed session stays as it is.
  const committed = await committedPaths(boxRoot, paths);
  if (committed.length > 0) {
    if (!committed.includes(layout.sessionCardRelPath)) {
      console.warn(`[scan-import] Failed session ${layout.sessionCardRelPath} was partly committed by another writer; leaving it in place.`);
    }
    return;
  }
  // Unstage before deleting: a staged entry whose file is gone would still be
  // swept into the box's next commit.
  if (await hasCommits(boxRoot)) await unstageFiles(boxRoot, paths);
  for (const p of paths) await fs.rm(path.join(boxRoot, p), { recursive: true, force: true });
}

/** The files under `relPaths` that HEAD tracks; empty before the first commit. */
async function committedPaths(boxRoot: string, relPaths: string[]): Promise<string[]> {
  if (!(await hasCommits(boxRoot))) return [];
  const listed = await simpleGit(boxRoot).raw(["ls-tree", "-r", "--name-only", "HEAD", "--", ...relPaths]);
  return listed.split("\n").filter((line) => line !== "");
}

/**
 * Queue a committed session for triage. The import has already landed, so a
 * failure here must not fail it: the ledger would never record the hash, and a
 * retry would import a second copy. Wakeup jobs any inbox card that no job
 * references, so the session is still triaged. Returns null when queuing failed.
 */
export async function queueCommittedSessionIntake(
  boxRoot: string,
  { items, description }: { items: string[]; description: string },
): Promise<string | null> {
  try {
    return await createOrAppendIntakeJob({ boxRoot, source: "scan", items, description });
  } catch (error) {
    console.warn(`[scan-import] Intake job for ${items[0] ?? "a scan session"} was not created; the next wakeup queues it:`, error);
    return null;
  }
}
