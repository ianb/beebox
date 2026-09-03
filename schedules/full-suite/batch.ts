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
  return { pinned, base, landings: await landingsSince(base, pinned) };
}
