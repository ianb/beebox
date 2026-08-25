/**
 * Runs the verification the decision sheet named, and answers the one question
 * `/finish` needs: green or red.
 *
 *   bin/finish-verify                       # reads bin/finish-preflight --json itself
 *   bin/finish-verify --sheet <file>
 *   bin/finish-verify --only tests          # re-verify after a post-green commit
 *
 * Output is one line per command, then `VERDICT: green|red`. A failing test
 * file is re-run once in isolation: passing there is a flake by the ledger's
 * definition (fail-then-pass at the same content hash) and is named, not
 * hidden; failing again is real and blocks.
 *
 * See callback-box/docs/plans/change-based-test-selection.md, "Revision
 * 2026-08-25 — test economics", mechanism E2.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sheet } from "./finish-preflight.js";
import type { VerificationCommand } from "./finish-preflight-lib.js";

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
 * Failing files named by TAP output. Both suites here speak TAP (`tap`, and
 * `node --test` when its output is piped), and both name paths in the
 * description — so a description is taken only when it exists on disk, which
 * keeps test *names* out of the list.
 */
export function parseFailingFiles(output: string, exists: (path: string) => boolean): string[] {
  const files = new Set<string>();
  for (const line of output.split("\n")) {
    const match = /^\s*not ok \d+ - (\S+)/.exec(line);
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
  if (result.unattributed) lines.push(`     no failing file identified — treated as real`);
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

interface RunOutput {
  status: number;
  text: string;
}

function run(input: { argv: string[]; cwd: string }): RunOutput {
  const [command, ...args] = input.argv;
  if (command === undefined) throw new Error("empty command");
  const result = spawnSync(command, args, {
    cwd: input.cwd,
    encoding: "utf-8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error !== undefined) throw result.error;
  return { status: result.status ?? 1, text: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function readSheet(argv: string[]): Sheet {
  const index = argv.indexOf("--sheet");
  if (index !== -1) {
    const path = argv[index + 1];
    if (path === undefined) throw new Error("--sheet needs a file");
    return JSON.parse(readFileSync(path, "utf-8")) as Sheet;
  }
  const preflight = spawnSync(
    process.execPath,
    ["--import", "tsx", join(import.meta.dirname, "finish-preflight.ts"), "--json"],
    { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (preflight.status !== 0) {
    throw new Error(`finish-preflight exited ${String(preflight.status)}:\n${preflight.stderr}`);
  }
  return JSON.parse(preflight.stdout) as Sheet;
}

function runCommand(input: {
  command: VerificationCommand;
  root: string;
  outDir: string;
  index: number;
}): CommandResult {
  const { command, root, outDir } = input;
  const cwd = join(root, command.cwd);
  const started = Date.now();
  const output = run({ argv: command.argv, cwd });
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
    failing.forEach((file, position) => {
      const rerun = run({ argv: [...isolate.argv, file], cwd: isolateCwd });
      if (rerun.status === 0) {
        files.push({ file, outcome: "flake" });
        return;
      }
      const path = join(outDir, `${String(input.index)}-real-${String(position)}.log`);
      writeFileSync(path, rerun.text);
      files.push({ file, outcome: "real", outputPath: path });
    });
  } else if (command.kind === "tests") {
    unattributed = true;
  }
  return { command, ok: false, seconds, outputPath, files, unattributed };
}

/**
 * A TAP description is a file only if it resolves against the package the
 * suite ran in, or against the repo root.
 *
 * The package dir, NOT the command's cwd: `pnpm --dir callback-box …` runs
 * from the repo root, and every path callback-box's tap prints is relative to
 * `callback-box/`. Checking the cwd alone identified no failing file at all
 * there, so every flake came back `real` and blocked the merge.
 */
export function existsRelative(input: { packageDir: string; path: string; root: string }): boolean {
  return existsSync(join(input.packageDir, input.path)) || existsSync(join(input.root, input.path));
}

export function main(argv: string[]): number {
  const sheet = readSheet(argv);
  const onlyIndex = argv.indexOf("--only");
  const only = onlyIndex === -1 ? null : argv[onlyIndex + 1];
  if (only !== null && !["tests", "typecheck", "lint"].includes(only ?? "")) {
    throw new Error("--only takes tests, typecheck or lint");
  }
  const outDir = mkdtempSync(join(tmpdir(), "finish-verify-"));
  const results: CommandResult[] = [];
  let index = 0;
  for (const command of sheet.verification) {
    if (command.skip !== undefined) {
      console.log(`skip ${command.command}  (${command.skip})`);
      continue;
    }
    if (only !== null && command.kind !== only) continue;
    const result = runCommand({ command, root: sheet.repoRoot, outDir, index: index++ });
    results.push(result);
    for (const line of formatResult(result)) console.log(line);
  }
  if (results.length === 0) console.log("nothing to run");
  const { green, flakes } = verdict(results);
  console.log(
    `VERDICT: ${green ? "green" : "red"}${flakes.length > 0 ? ` (flake: ${flakes.join(", ")})` : ""}`,
  );
  return green ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`finish-verify: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}
