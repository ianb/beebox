/**
 * The repo's full doctest typecheck, run in the detached checkout after the
 * suite (agent-doctest/README.md, "Typechecking"). A commit's hook checks only
 * its staged doctests and `test:changed` only the doctests its change
 * selects, so a type error that slips past both lands here within the hour.
 *
 * It is a separate condition from the suite's: a doctest that runs green can
 * still fail to typecheck, and its alert is neither raised nor cleared by a
 * test verdict. The typecheck is deterministic, so a loaded host does not
 * withhold it.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execa } from "execa";
import type { Landing } from "./lib.js";

export interface DoctestTypecheck {
  ok: boolean;
  /** Each failing package's output, under its name. */
  output: string;
}

/** Lines of checker output an alert carries; the rest is a command away. */
const ALERT_OUTPUT_LINES = 60;

/** Top-level workspace directories whose package.json has a `typecheck:doctest` script. */
async function packagesWithScript(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let text: string;
    try {
      text = await fs.readFile(path.join(dir, entry.name, "package.json"), "utf8");
    } catch (_e) {
      // No package.json: not a package.
      continue;
    }
    const manifest: unknown = JSON.parse(text);
    if (typeof manifest !== "object" || manifest === null || !("scripts" in manifest)) continue;
    const { scripts } = manifest;
    if (typeof scripts === "object" && scripts !== null && "typecheck:doctest" in scripts) found.push(entry.name);
  }
  return found.toSorted();
}

export async function typecheckDoctests(dir: string): Promise<DoctestTypecheck> {
  // beebox's test/exports.doctest.md typechecks the built package surface,
  // whose declarations only build:cli writes; the checkout's pretest builds
  // the CLI bundle alone.
  const build = await execa("pnpm", ["--dir", path.join(dir, "beebox"), "run", "build:cli"], { reject: false, all: true });
  if (build.exitCode !== 0) return { ok: false, output: `## beebox build:cli failed\n${build.all ?? ""}` };
  const failures: string[] = [];
  for (const pkg of await packagesWithScript(dir)) {
    const result = await execa("pnpm", ["--silent", "typecheck:doctest"], { cwd: path.join(dir, pkg), reject: false, all: true });
    if (result.exitCode !== 0) failures.push(`## ${pkg}\n${result.all ?? ""}`);
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
    `Doctests at \`${input.testedCommit.slice(0, 8)}\` do not typecheck. Reproduce with ` +
      "`pnpm --dir <package> typecheck:doctest` (agent-doctest/README.md, Typechecking).",
    "",
    "```",
    ...shown,
    "```",
    "",
    "Landings in this batch:",
    ...landings,
  ].join("\n");
}
