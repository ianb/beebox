/**
 * Rendering for `test-ledger report`. Separated from the recording shell so
 * neither file carries two concerns, and so the numbers can be re-shaped
 * without touching anything that writes.
 */

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { foldFilesets, isCompletedRun, ledgerPaths, summarize } from "./test-ledger-lib.js";
import { readRecords } from "./test-ledger.js";

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

  const excluded = records.filter((r) => !isCompletedRun(r)).length;
  const failing = [...stats.entries()].filter(([, s]) => s.failures > 0);
  failing.sort((a, b) => b[1].failures - a[1].failures);

  console.log(`runs recorded:   ${records.length}${excluded > 0 ? ` (${excluded} excluded: did not complete)` : ""}`);
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

  const unimplicated = failing.reduce((sum, [, s]) => sum + s.unimplicatedFailures, 0);
  console.log(`unimplicated failures: ${unimplicated}`);
  console.log(
    unimplicated === 0
      ? "  (no failure yet occurred in a test the graph did not point at)"
      : "  (failures the import graph did not point at — the number that decides selection)",
  );
}
