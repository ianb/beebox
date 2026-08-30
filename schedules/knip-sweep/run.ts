/**
 * The weekly dead-code sweep: what knip reports THIS week that it did not
 * report last week.
 *
 * Knip's report is long and mostly stable — a couple of dozen findings that
 * have been there for months, each one a judgment call somebody already made.
 * Handing that list to an agent every week would be the fabricated-"nothing
 * new" failure the plan names: a report nobody can act on, indistinguishable
 * from the week something real appeared. So the run keeps last week's report in
 * `$SCHEDULE_STATE_DIR/last-report.txt` and hands off only the lines that are
 * new against it.
 *
 * The first run has nothing to compare with, so it records the baseline and
 * says so with an `fyi` alert rather than pretending every pre-existing finding
 * appeared this week.
 *
 * The baseline is rewritten on every real run, including runs that hand off.
 * A finding is therefore news exactly once: if the session decides a finding
 * should stay (a deliberate entry point, work in progress), it stays without
 * being re-reported forever.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execa } from "execa";

const SCHEDULE_DIR = import.meta.dirname;
const REPO_ROOT = path.resolve(SCHEDULE_DIR, "..", "..");

function refuse(message: string): never {
  process.stderr.write(`knip-sweep: ${message}\n`);
  process.exit(2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Where knip is run from. It moved from `beebox` to the monorepo root
 * (one run so the workspaces can see each other, and so hoisted node_modules
 * stop reading as unlisted binaries), and this schedule has to work on both
 * sides of that landing — so it asks the checkout rather than assuming.
 */
async function knipCommand(): Promise<string[]> {
  const manifest: unknown = JSON.parse(await fs.readFile(path.join(REPO_ROOT, "package.json"), "utf8"));
  const scripts = isRecord(manifest) ? manifest["scripts"] : undefined;
  const rootHasKnip = isRecord(scripts) && "lint:knip" in scripts;
  return rootHasKnip ? ["lint:knip"] : ["--dir", "beebox", "lint:knip"];
}

/**
 * The report, as comparable lines. pnpm's own banner carries the checkout path
 * and the package version, and knip pads its columns; a section header carries
 * its own count, which would read as a new finding every time a count changed.
 * Stripping the count keeps the header as context while leaving the ENTRIES as
 * the only thing a diff can be about.
 */
function reportLines(output: string): string[] {
  const lines: string[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.trimEnd();
    if (line === "") continue;
    if (line.startsWith(">")) continue;
    if (line.trim().startsWith("ELIFECYCLE")) continue;
    lines.push(line.replace(/^(.*?) \([0-9]+\)$/u, "$1"));
  }
  return lines;
}

const stateDir = process.env["SCHEDULE_STATE_DIR"];
if (stateDir === undefined || stateDir === "") refuse("SCHEDULE_STATE_DIR is not set");
const baselineFile = path.join(stateDir, "last-report.txt");

const knip = await execa("pnpm", await knipCommand(), { cwd: REPO_ROOT, reject: false, all: true });
const output = knip.all ?? "";
console.log(output);

const current = reportLines(output);
// Knip exits 1 whenever it has findings, so a non-zero exit is not news — an
// empty report with a non-zero exit is: that is knip failing to run at all.
if (current.length === 0 && knip.exitCode !== 0) refuse(`knip produced no report and exited ${String(knip.exitCode)}`);

const previous = await fs.readFile(baselineFile, "utf8").then(
  (text) => reportLines(text),
  (e: NodeJS.ErrnoException) => (e.code === "ENOENT" ? null : refuse(`cannot read ${baselineFile}: ${e.message}`)),
);

const dryRun = process.env["SCHEDULE_DRY_RUN"] === "1";
const schedulesCli = path.join(REPO_ROOT, "bin", "schedules");

async function recordBaseline(): Promise<void> {
  // A dry run writes nothing anywhere — including the baseline, which would
  // otherwise make the next real run report nothing new.
  if (dryRun) {
    console.log(`[knip-sweep] dry run: would record ${String(current.length)} lines as the baseline.`);
    return;
  }
  await fs.writeFile(baselineFile, `${current.join("\n")}\n`, "utf8");
}

if (previous === null) {
  await recordBaseline();
  await execa(
    schedulesCli,
    [
      "alert",
      "--priority",
      "fyi",
      "--title",
      `knip baseline recorded, ${String(current.length)} findings`,
      "--message",
      "First run of this schedule: knip's current report is now the baseline, and later runs hand off only what is new against it. Nothing was changed.",
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  process.exit(0);
}

const known = new Set(previous);
const added = current.filter((line) => !known.has(line));
await recordBaseline();
if (added.length === 0) process.exit(0);

const body = [
  `knip reports ${String(added.length)} finding${added.length === 1 ? "" : "s"} that were not in last week's report:`,
  "",
  "```",
  ...added,
  "```",
  "",
  "The full report is above in the run log; everything else in it was already there last week.",
  "",
].join("\n");

if (dryRun) {
  console.log("[knip-sweep] dry run: the handoff below is printed, not recorded.");
}
await execa(
  schedulesCli,
  ["handoff", "--title", `${String(added.length)} new knip finding${added.length === 1 ? "" : "s"}`, "--body", "-"],
  { input: body, stdout: "inherit", stderr: "inherit" },
);
