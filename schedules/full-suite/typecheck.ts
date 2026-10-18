/**
 * The repo's full typecheck, run in the detached checkout after the suite.
 * A commit's hook typechecks only the packages it touches, so a change that
 * breaks another package's code or tests (a test is typechecked with its
 * package's program) lands here within the hour.
 *
 * It is a separate condition from the suite's: a test that runs green can
 * still fail to typecheck (tap strips types), and its alert is neither raised
 * nor cleared by a test verdict. The typecheck is deterministic, so a loaded
 * host does not withhold it.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execa } from "execa";
import { packageOwnerDirs } from "../../bin/workspace-packages.js";
import type { Landing } from "./lib.js";

export interface Typecheck {
  ok: boolean;
  /** Each failing package's output, under its name. */
  output: string;
}

/** Lines of checker output an alert carries; the rest is a command away. */
const ALERT_OUTPUT_LINES = 60;

/** The root and every workspace package (`pnpm-workspace.yaml`) whose package.json has a `typecheck` script. */
async function packagesWithScript(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const pkg of [".", ...packageOwnerDirs(dir)]) {
    const manifest: unknown = JSON.parse(await fs.readFile(path.join(dir, pkg, "package.json"), "utf8"));
    if (typeof manifest !== "object" || manifest === null || !("scripts" in manifest)) continue;
    const { scripts } = manifest;
    if (typeof scripts === "object" && scripts !== null && "typecheck" in scripts) found.push(pkg);
  }
  return found;
}

export async function typecheckAll(dir: string): Promise<Typecheck> {
  // Each package's script prepares what its program needs (beebox builds its
  // export declarations first), so a failure here is the code's, not the
  // checkout's: it stays open until a landing fixes it.
  const failures: string[] = [];
  for (const pkg of await packagesWithScript(dir)) {
    const result = await execa("pnpm", ["--silent", "typecheck"], { cwd: path.join(dir, pkg), reject: false, all: true });
    if (result.exitCode !== 0) failures.push(`## ${pkg === "." ? "(root)" : pkg}\n${result.all ?? ""}`);
  }
  return { ok: failures.length === 0, output: failures.join("\n\n") };
}

export function renderTypecheckAlert(input: { testedCommit: string; output: string; landings: readonly Landing[] }): string {
  const lines = input.output.trimEnd().split("\n");
  const shown = lines.length > ALERT_OUTPUT_LINES
    ? [...lines.slice(0, ALERT_OUTPUT_LINES), `… ${String(lines.length - ALERT_OUTPUT_LINES)} more lines`]
    : lines;
  const landings = input.landings.length === 0
    ? ["(no landings in this batch; the error predates it)"]
    : input.landings.map((landing) => `- \`${landing.commit.slice(0, 8)}\` ${landing.subject}`);
  return [
    `\`${input.testedCommit.slice(0, 8)}\` does not typecheck. Reproduce with ` +
      "`pnpm typecheck` in the package named below (`(root)` is the repo root).",
    "",
    "```",
    ...shown,
    "```",
    "",
    "Landings in this batch:",
    ...landings,
  ].join("\n");
}
