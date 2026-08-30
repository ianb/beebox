/**
 * Rendering for `test-ledger report`. Separated from the recording shell so
 * neither file carries two concerns, and so the numbers can be re-shaped
 * without touching anything that writes.
 */

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  carefulCandidates,
  CAREFUL_THRESHOLD,
  CAREFUL_WINDOW,
  foldFilesets,
  isCompletedRun,
  ledgerPaths,
  summarize,
  type FlakeShare,
  type LedgerRecord,
} from "./test-ledger-lib.js";
import { readRecords } from "./test-ledger.js";
import { readCarefulList } from "./test-tiers.js";

function gitCommonDir(): string {
  return execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf-8",
  }).trim();
}

function readFilesets(path: string): Record<string, string[]> {
  if (!existsSync(path)) return {};
  try {
    return foldFilesets(readFileSync(path, "utf-8").split("\n"));
  } catch (e) {
    console.warn(`test-ledger: fileset log unreadable (${String(e)})`);
    return {};
  }
}

export function renderReport(): void {
  const paths = ledgerPaths(gitCommonDir());
  const records = readRecords(paths.ledger);
  if (records.length === 0) {
    console.log("test-ledger: no runs recorded yet");
    return;
  }
  const filesets = readFilesets(paths.filesets);
  const stats = summarize({ records, filesets });

  // Markers are bookkeeping, not runs: they are neither counted nor
  // reported as excluded, because there was never a run to exclude.
  const runs = records.filter((r) => r.marker !== true);
  const excluded = runs.filter((r) => !isCompletedRun(r)).length;
  const failing = [...stats.entries()].filter(([, s]) => s.failures > 0);
  failing.sort((a, b) => b[1].failures - a[1].failures);

  console.log(`runs recorded:   ${runs.length}${excluded > 0 ? ` (${excluded} excluded: did not complete)` : ""}`);
  console.log(`files seen:      ${stats.size}`);
  console.log(`files ever failed: ${failing.length}`);
  console.log("");

  if (failing.length > 0) {
    console.log("file                                                  runs  fail  flake  unimplicated");
    for (const [file, s] of failing.slice(0, 40)) {
      console.log(
        `${file.padEnd(52).slice(0, 52)}  ${String(s.runs).padStart(4)}  ${String(s.failures).padStart(4)}  ` +
          `${String(s.flakes).padStart(5)}  ${String(s.unimplicatedFailures).padStart(12)}`,
      );
    }
    console.log("");
  }

  renderCarefulTier(records, filesets);

  const unimplicated = failing.reduce((sum, [, s]) => sum + s.unimplicatedFailures, 0);
  console.log(`unimplicated failures: ${unimplicated}`);
  console.log(
    unimplicated === 0
      ? "  (no failure yet occurred in a test the graph did not point at)"
      : "  (failures the import graph did not point at — the number that decides selection)",
  );
}

/**
 * Who belongs in the careful tier. Membership is a judgment — this prints the
 * evidence and a human moves lines in `beebox/test/careful.txt` (plan
 * revision 2026-08-25, mechanism C).
 */
function renderCarefulTier(records: LedgerRecord[], filesets: Record<string, string[]>): void {
  let careful: string[];
  try {
    careful = readCarefulList();
  } catch (e) {
    console.log(`careful tier: list unreadable (${String(e)})`);
    console.log("");
    return;
  }
  const { candidates, members } = carefulCandidates({ records, filesets, careful });
  const pct = (s: FlakeShare): string => `${Math.round(s.share * 100)}% (${s.flakes}/${s.runs})`;
  const bar = `>${Math.round(CAREFUL_THRESHOLD * 100)}% of last ${CAREFUL_WINDOW} runs`;

  console.log(`careful-tier candidates (flake share ${bar}):`);
  if (candidates.length === 0) console.log("  none");
  for (const s of candidates.slice(0, 10)) console.log(`  ${s.file.padEnd(52)}  ${pct(s)}`);
  console.log(
    members.length === 0
      ? "careful tier: empty"
      : `careful tier now: ${members.map((s) => `${s.file} ${pct(s)}`).join(", ")}`,
  );
  console.log("");
}
