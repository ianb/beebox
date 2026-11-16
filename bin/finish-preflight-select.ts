/**
 * finish-preflight's test selection: `bin/test-select.ts --json`, with each
 * reason reduced to its count. The sheet keeps every selected file; the text
 * form shows only the count, the first few files, and the largest reasons.
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { binTsArgs } from "./lib/bin-ts.js";

export interface SelectedTests {
  files: string[];
  /** Why the files were selected, largest group first (see test-select-lib.ts). */
  reasons: { reason: string; count: number }[];
  note: string;
  /** Distinguishes a selector that errored from one that selected nothing. */
  failed?: true;
}

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/** `bin/test-select.ts --json`: `{ files, reasons: [{ reason, tests }] }`. */
function isSelectorJson(value: unknown): value is { files: string[]; reasons: { reason: string; tests: string[] }[] } {
  if (typeof value !== "object" || value === null || !("files" in value) || !("reasons" in value)) return false;
  const { files, reasons } = value;
  return (
    isStrings(files) &&
    Array.isArray(reasons) &&
    reasons.every(
      (group: unknown) =>
        typeof group === "object" &&
        group !== null &&
        "reason" in group &&
        typeof group.reason === "string" &&
        "tests" in group &&
        isStrings(group.tests),
    )
  );
}

const failed = (why: string): SelectedTests => ({
  files: [],
  reasons: [],
  failed: true,
  note: `selector failed (${why}) — run pnpm test`,
});

/**
 * The selected test set against `base` (main, or a tested revision). Callers
 * ask only when beebox is in the diff — the selector's esbuild pass costs
 * seconds and selects nothing otherwise.
 */
export function selection(input: { root: string; base: string }): SelectedTests {
  const { root, base } = input;
  const result = spawnSync(process.execPath, binTsArgs(join(root, "bin/test-select.ts"), ["--json", "--base", base]), {
    cwd: root,
    encoding: "utf-8",
    // A broad selection's JSON (every test under every reason) runs to megabytes;
    // the 1 MB default cut it off and read as a selector failure.
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error !== undefined) return failed(result.error.message);
  if (result.status !== 0) return failed(result.stderr.trim());
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (e) {
    return failed(`unparseable output: ${String(e)}`);
  }
  if (!isSelectorJson(parsed)) return failed("unexpected JSON shape");
  const { files } = parsed;
  const reasons = parsed.reasons.map((group) => ({ reason: group.reason, count: group.tests.length }));
  return files.length === 0
    ? { files: [], reasons, note: "no test imports the changed paths" }
    : { files, reasons, note: `${String(files.length)} selected` };
}
