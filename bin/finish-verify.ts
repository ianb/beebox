/**
 * Runs the verification the decision sheet named, and answers the one question
 * `/finish` needs: green or red.
 *
 *   bin/finish-verify                       # reads bin/finish-preflight --json itself
 *   bin/finish-verify --sheet <file>
 *   bin/finish-verify --only tests          # re-verify after a post-green commit
 *   bin/finish-verify --help
 *
 * Exit: 0 green, 1 red, 2 bad arguments, 128+n when killed by signal n.
 *
 * Output is one line per command, then `VERDICT: green|red`. A failing test
 * file is re-run once in isolation: passing there is a flake by the ledger's
 * definition (fail-then-pass at the same content hash) and is named, not
 * hidden; failing again is real and blocks. The `smoke` command gets no such
 * forgiveness — it boots one real box and either it works or it does not.
 *
 * See beebox/docs/plans/change-based-test-selection.md, "Revision
 * 2026-08-25 — test economics", mechanism E2.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { killChildrenOnSignal, registerRun, run } from "./finish-verify-process.js";
import type { Sheet } from "./finish-preflight.js";
import type { VerificationCommand } from "./finish-preflight-lib.js";

class PreflightFailedError extends Error {
  constructor(readonly detail: { status: number | null; stderr: string }) {
    super(`finish-preflight exited ${String(detail.status)}:\n${detail.stderr}`);
    this.name = "PreflightFailedError";
  }
}

const KINDS: VerificationCommand["kind"][] = ["tests", "typecheck", "lint", "smoke", "site"];

/** A usage mistake: exit 2 with the usage text, and run nothing. */
class UsageError extends Error {
  constructor(readonly detail: string) {
    super(`bad arguments: ${detail}`);
    this.name = "UsageError";
  }
}

class BadOnlyKindError extends UsageError {
  constructor(readonly kind: string) {
    super(`--only takes ${KINDS.join(", ")}; got '${kind}'`);
    this.name = "BadOnlyKindError";
  }
}

const USAGE = `usage: bin/finish-verify [--sheet <file>] [--only ${KINDS.join("|")}]

Runs the checks bin/finish-preflight's sheet names and prints VERDICT: green|red.
Without --sheet it runs bin/finish-preflight --json first, which merges main.

  --sheet <file>  read the decision sheet from a file instead
  --only <kind>   run only that kind of check
  -h, --help      print this and exit

Exit: 0 green, 1 red, 2 bad arguments, 128+n when killed by signal n.`;

/** Strict: an unknown flag or stray argument is a usage error, never a full run. */
export function parseOptions(argv: string[]): {
  help: boolean;
  sheet: string | undefined;
  only: VerificationCommand["kind"] | undefined;
} {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        help: { type: "boolean", short: "h" },
        sheet: { type: "string" },
        only: { type: "string" },
      },
    }));
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e));
  }
  const only = KINDS.find((kind) => kind === values.only);
  if (values.only !== undefined && only === undefined) throw new BadOnlyKindError(values.only);
  return { help: values.help === true, sheet: values.sheet, only };
}

export interface FileOutcome {
  file: string;
  outcome: "flake" | "real";
  outputPath?: string;
}

export interface CommandResult {
  command: VerificationCommand;
  ok: boolean;
  seconds: number;
  outputPath: string;
  files: FileOutcome[];
  /** A red command whose failing files could not be identified. */
  unattributed: boolean;
}

/**
 * Failing files named by a test run's output, in either of the two shapes the
 * suites here produce.
 *
 * `tap` speaks TAP: the path is the `not ok` description. `node --test` speaks
 * its SPEC reporter — piping does not switch it to TAP (it did on Node 20;
 * verified on Node 24 that piped output is still spec), so the root
 * `bin/*.test.ts` suite was invisible to a TAP-only matcher. Every failure from
 * it came back unattributed, which finish-verify treats as real and so never
 * reran in isolation: a named flake in that suite blocked a finish with no way
 * for the verifier to say which file to retry.
 *
 * Spec names the file in a `test at <path>:<line>:<col>` header per failing
 * test. That header is matched anchored and whole, so the `at … (file:///…)`
 * frames of the stack trace below it cannot contribute a path.
 *
 * Both shapes put test NAMES in the same position as paths, so a candidate
 * counts only when it exists on disk.
 */
export function parseFailingFiles(output: string, exists: (path: string) => boolean): string[] {
  const files = new Set<string>();
  for (const line of output.split("\n")) {
    const match = /^\s*not ok \d+ - (\S+)/.exec(line) ?? /^\s*test at (\S+?):\d+:\d+\s*$/.exec(line);
    const candidate = match?.[1];
    if (candidate === undefined) continue;
    if (exists(candidate)) files.add(candidate);
  }
  return [...files];
}

export function formatResult(result: CommandResult): string[] {
  const seconds = result.seconds.toFixed(1);
  if (result.ok) return [`ok   ${result.command.command} (${seconds}s)`];
  const lines = [`FAIL ${result.command.command} (${seconds}s) → ${result.outputPath}`];
  for (const file of result.files) {
    lines.push(
      file.outcome === "flake"
        ? `     flake ${file.file}`
        : `     real  ${file.file} → ${file.outputPath ?? result.outputPath}`,
    );
  }
  if (result.unattributed) lines.push("     no failing file identified — treated as real");
  return lines;
}

/** Flake-only failures are green, and named. Anything else is red. */
export function verdict(results: CommandResult[]): { green: boolean; flakes: string[] } {
  const flakes: string[] = [];
  let green = true;
  for (const result of results) {
    if (result.ok) continue;
    if (result.command.kind !== "tests" || result.unattributed || result.files.length === 0) {
      green = false;
      continue;
    }
    for (const file of result.files) {
      if (file.outcome === "flake") flakes.push(file.file);
      else green = false;
    }
  }
  return { green, flakes: [...new Set(flakes)] };
}

function readSheet(path: string | undefined): Sheet {
  if (path !== undefined) {
    const parsed: Sheet = JSON.parse(readFileSync(path, "utf-8"));
    return parsed;
  }
  const preflight = spawnSync(
    process.execPath,
    ["--import", "tsx", join(import.meta.dirname, "finish-preflight.ts"), "--json"],
    { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (preflight.status !== 0) {
    throw new PreflightFailedError({ status: preflight.status, stderr: preflight.stderr });
  }
  const parsed: Sheet = JSON.parse(preflight.stdout);
  return parsed;
}

async function runCommand(input: {
  command: VerificationCommand;
  root: string;
  outDir: string;
  index: number;
}): Promise<CommandResult> {
  const { command, root, outDir } = input;
  const cwd = join(root, command.cwd);
  const started = Date.now();
  const output = await run({ argv: command.argv, cwd });
  const seconds = (Date.now() - started) / 1000;
  const outputPath = join(outDir, `${String(input.index)}-${command.kind}.log`);
  writeFileSync(outputPath, output.text);
  if (output.status === 0) {
    return { command, ok: true, seconds, outputPath, files: [], unattributed: false };
  }

  const files: FileOutcome[] = [];
  let unattributed = false;
  if (command.kind === "tests" && command.isolate !== undefined) {
    const isolate = command.isolate;
    const isolateCwd = join(root, isolate.cwd);
    const failing = parseFailingFiles(output.text, (path) =>
      existsRelative({ packageDir: join(root, isolate.packageDir), path, root }),
    );
    if (failing.length === 0) unattributed = true;
    for (const [position, file] of failing.entries()) {
      const rerun = await run({ argv: [...isolate.argv, file], cwd: isolateCwd });
      if (rerun.status === 0) {
        files.push({ file, outcome: "flake" });
        continue;
      }
      const path = join(outDir, `${String(input.index)}-real-${String(position)}.log`);
      writeFileSync(path, rerun.text);
      files.push({ file, outcome: "real", outputPath: path });
    }
  } else if (command.kind === "tests") {
    unattributed = true;
  }
  return { command, ok: false, seconds, outputPath, files, unattributed };
}

/**
 * A TAP description is a file only if it resolves against the package the
 * suite ran in, or against the repo root.
 *
 * The package dir, NOT the command's cwd: `pnpm --dir beebox …` runs
 * from the repo root, and every path beebox's tap prints is relative to
 * `beebox/`. Checking the cwd alone identified no failing file at all
 * there, so every flake came back `real` and blocked the merge.
 */
export function existsRelative(input: { packageDir: string; path: string; root: string }): boolean {
  return existsSync(join(input.packageDir, input.path)) || existsSync(join(input.root, input.path));
}

export async function main(argv: string[]): Promise<number> {
  const options = parseOptions(argv);
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  const sheet = readSheet(options.sheet);
  const outDir = mkdtempSync(join(tmpdir(), "finish-verify-"));
  const registration = registerRun(sheet.repoRoot);
  killChildrenOnSignal(registration.release);
  if (registration.others.length > 0) {
    console.log(
      `note: finish-verify also running in ${registration.others.join(", ")} — the shared dev router is loaded; a slow smoke may be load`,
    );
  }
  const results: CommandResult[] = [];
  let index = 0;
  try {
    for (const command of sheet.verification) {
      if (command.skip !== undefined) {
        console.log(`skip ${command.command}  (${command.skip})`);
        continue;
      }
      if (options.only !== undefined && command.kind !== options.only) continue;
      const result = await runCommand({ command, root: sheet.repoRoot, outDir, index: index++ });
      results.push(result);
      for (const line of formatResult(result)) console.log(line);
    }
  } finally {
    registration.release();
  }
  if (results.length === 0) console.log("nothing to run");
  const { green, flakes } = verdict(results);
  console.log(
    `VERDICT: ${green ? "green" : "red"}${flakes.length > 0 ? ` (flake: ${flakes.join(", ")})` : ""}`,
  );
  return green ? 0 : 1;
}

if (process.argv[1] === import.meta.filename) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (e) {
    console.error(`finish-verify: ${e instanceof Error ? e.message : String(e)}`);
    if (e instanceof UsageError) console.error(USAGE);
    process.exitCode = e instanceof UsageError ? 2 : 1;
  }
}
