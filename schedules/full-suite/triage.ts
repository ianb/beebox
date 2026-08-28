/** Isolated re-runs and ledger-backed flake classification. */
import { readFileSync, existsSync } from "node:fs";
import { gitCommonDir } from "../../bin/test-git.js";
import { readRecords } from "../../bin/test-ledger.js";
import { flakeShare, foldFilesets, ledgerPaths } from "../../bin/test-ledger-lib.js";
import { runFileAlone, type Checkout } from "./checkout.js";
import { classifyFailure, failureExcerpt, FLAKE_WINDOW, type Culprit, type Landing } from "./lib.js";
import { REPO_ROOT } from "./repo.js";

export interface Triage {
  flakes: string[];
  real: string[];
}

/** One issue per blamed landing, with every file that landing broke. */
export function groupCulprits(input: { blamed: Array<{ file: string; landing: Landing }>; output: string }): Culprit[] {
  const byCommit = new Map<string, Culprit>();
  for (const { file, landing } of input.blamed) {
    const existing = byCommit.get(landing.commit);
    if (existing === undefined) {
      byCommit.set(landing.commit, {
        landing,
        files: [file],
        excerpt: failureExcerpt({ raw: input.output, file }),
      });
    } else {
      existing.files.push(file);
      existing.excerpt = `${existing.excerpt}\n\n${failureExcerpt({ raw: input.output, file })}`;
    }
  }
  return [...byCommit.values()];
}

export async function triage(input: { checkout: Checkout; failures: string[] }): Promise<Triage> {
  const paths = ledgerPaths(gitCommonDir(REPO_ROOT));
  const records = readRecords(paths.ledger);
  const filesets = existsSync(paths.filesets)
    ? foldFilesets(readFileSync(paths.filesets, "utf-8").split("\n"))
    : {};
  const triaged: Triage = { flakes: [], real: [] };
  for (const file of input.failures) {
    process.stdout.write(`\n--- isolated re-run: ${file} ---\n`);
    const rerun = await runFileAlone({ checkout: input.checkout, file });
    process.stdout.write(rerun.output);
    const share = flakeShare({ records, filesets, file, window: FLAKE_WINDOW }).share;
    const verdict = classifyFailure({ isolatedPass: rerun.exitCode === 0, flakeShare: share });
    (verdict === "flake" ? triaged.flakes : triaged.real).push(file);
  }
  return triaged;
}
