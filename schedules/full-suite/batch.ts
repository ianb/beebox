/** Reading the batch: what landed on first-parent `main` since the last test. */
import { gitCommonDir } from "../../bin/test-git.js";
import { readRecords } from "../../bin/test-ledger.js";
import { ledgerPaths } from "../../bin/test-ledger-lib.js";
import type { Batch } from "./attribution.js";
import {
  LANDING_FIELD_SEPARATOR,
  LANDING_RECORD_SEPARATOR,
  lastTestedCommit,
  parseLandings,
  type Landing,
} from "./lib.js";
import { REPO_ROOT, git } from "./repo.js";

export async function landingsSince(base: string, pinned: string): Promise<Landing[]> {
  const format = `%H${LANDING_FIELD_SEPARATOR}%s${LANDING_RECORD_SEPARATOR}`;
  const raw = await git(["log", "--first-parent", "--reverse", `--format=${format}`, `${base}..${pinned}`]);
  return parseLandings(raw);
}

export async function readBatch(): Promise<Batch> {
  const pinned = await git(["rev-parse", "main"]);
  const base = lastTestedCommit(readRecords(ledgerPaths(gitCommonDir(REPO_ROOT)).ledger));
  if (base === null) return { pinned, base: null, landings: [] };
  // A ledger commit that no longer resolves (history rewritten under it, a
  // clone from before a force-push) is not a base: start over from `main`
  // rather than fail every hourly run until someone edits the ledger.
  if (!(await commitExists(base))) {
    console.warn(`full-suite: last tested commit ${base} does not resolve; testing main without a baseline`);
    return { pinned, base: null, landings: [] };
  }
  return { pinned, base, landings: await landingsSince(base, pinned) };
}

async function commitExists(sha: string): Promise<boolean> {
  try {
    await git(["cat-file", "-e", `${sha}^{commit}`]);
    return true;
  } catch (_error) {
    return false;
  }
}
