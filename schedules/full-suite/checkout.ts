/**
 * The detached worktree the batch runs in, and the commands run inside it.
 *
 * Nothing here decides anything — `run.ts` does that. This is the I/O: create
 * the worktree, install into it, run a tier, run one file alone, move it to
 * another commit for a bisect step, and take it away again.
 *
 * See run.ts for why the suite never runs in the main checkout.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { execa } from "execa";

import { parseTapFiles } from "../../bin/test-ledger-lib.js";
import { LEDGER_SOURCE } from "./lib.js";
import { REPO_ROOT, git, refuse } from "./repo.js";

/** A checkout of one commit, plus the temp directory it lives in. */
export interface Checkout {
  dir: string;
  parent: string;
}


/** The commit the shared worktree currently holds, so a bisect step that lands
 *  on it again is free — including the pinned commit the batch just ran. */
let checkedOut: string | null = null;

export async function createCheckout(commit: string): Promise<Checkout> {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "full-suite-"));
  const dir = path.join(parent, "checkout");
  await git(["worktree", "add", "--detach", dir, commit]);
  checkedOut = commit;
  await installDeps(dir);
  await buildCli(dir);
  return { dir, parent };
}

export async function removeCheckout(checkout: Checkout | null): Promise<void> {
  if (checkout === null) return;
  await execa("git", ["-C", REPO_ROOT, "worktree", "remove", "--force", checkout.dir], { reject: false });
  await execa("git", ["-C", REPO_ROOT, "worktree", "prune"], { reject: false });
  await fs.rm(checkout.parent, { recursive: true, force: true });
}

/**
 * One workspace-wide install, the way `bin/lib/worktree-create.sh` does it —
 * never per-subpackage, because pnpm workspaces with `node-linker=hoisted`
 * resolve from the root.
 *
 * `--prefer-offline` rather than `--offline`: the store almost always has
 * everything, but a landing that added a dependency would make a strict
 * `--offline` fail the whole batch over a cache miss.
 */
async function installDeps(dir: string): Promise<void> {
  const result = await execa("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], {
    cwd: dir,
    reject: false,
    all: true,
  });
  if (result.exitCode !== 0) refuse(`pnpm install failed in the detached worktree:\n${result.all ?? ""}`);
}

/**
 * `callback-box`'s `pretest`, run explicitly.
 *
 * The tiers invoke the ledger wrapper directly rather than through `pnpm test`,
 * which means npm's `pretest` hook — `node scripts/build-cli.ts` — never fires.
 * A fresh detached worktree has no `dist/cli.mjs` at all, and every bisect
 * checkout leaves whatever the previous commit built, so the CLI the suite
 * exercises would be a different commit's. Running the package's own script
 * rather than restating its command keeps one definition of the build.
 */
async function buildCli(dir: string): Promise<void> {
  const result = await execa("pnpm", ["--dir", path.join(dir, "callback-box"), "run", "pretest"], {
    reject: false,
    all: true,
  });
  if (result.exitCode !== 0) refuse(`callback-box pretest (build-cli) failed:\n${result.all ?? ""}`);
}

/** The lockfile at a commit, so a bisect step reinstalls only when it must. */
async function lockfileHash(commit: string): Promise<string> {
  return await git(["rev-parse", `${commit}:pnpm-lock.yaml`]);
}

// ─── running tests in it ──────────────────────────────────────────────────

/** The ledger-wrapped tier command, as `callback-box/package.json` spells it. */
function tierArgs(input: { tier: "ordinary" | "careful"; base: string }): string[] {
  return [
    "exec",
    "node",
    "--import",
    "tsx",
    "../bin/test-ledger.ts",
    "run",
    ...(input.tier === "careful" ? ["--tier", "careful"] : []),
    "--base",
    input.base,
    "--source",
    LEDGER_SOURCE,
    "--",
    "tap",
  ];
}

/** What one invocation of tap produced: its combined output and exit status. */
export interface SuiteRun {
  output: string;
  exitCode: number | null;
}

export async function runTier(input: { checkout: Checkout; tier: "ordinary" | "careful"; base: string }): Promise<SuiteRun> {
  process.stdout.write(`\n=== full suite (${input.tier}) ===\n`);
  const result = await execa("pnpm", ["--dir", path.join(input.checkout.dir, "callback-box"), ...tierArgs(input)], {
    reject: false,
    all: true,
  });
  process.stdout.write(result.all ?? "");
  return { output: result.all ?? "", exitCode: result.exitCode ?? null };
}

/** Failing test files across both tiers, in TAP's order, de-duplicated. */
export function failingFiles(runs: SuiteRun[]): string[] {
  const failing: string[] = [];
  for (const run of runs) {
    for (const result of parseTapFiles(run.output)) {
      if (!result.ok && !failing.includes(result.file)) failing.push(result.file);
    }
  }
  return failing;
}

/**
 * One file, alone, in the detached worktree — the plan's `tap <file>`.
 *
 * Deliberately NOT wrapped in the ledger: it is a diagnostic, and recording it
 * as a run would put a one-file denominator into every rate the report
 * computes.
 */
export async function runFileAlone(input: { checkout: Checkout; file: string }): Promise<SuiteRun> {
  const result = await execa(
    "pnpm",
    ["--dir", path.join(input.checkout.dir, "callback-box"), "exec", "tap", input.file],
    { reject: false, all: true },
  );
  return { output: result.all ?? "", exitCode: result.exitCode ?? null };
}

/** Move the worktree to a commit, reinstalling only when the lockfile differs. */
export async function checkoutCommit(input: { checkout: Checkout; commit: string }): Promise<void> {
  if (checkedOut === input.commit) return;
  const before = checkedOut;
  await git(["checkout", "--detach", "--force", input.commit], input.checkout.dir);
  checkedOut = input.commit;
  if (before === null || (await lockfileHash(before)) !== (await lockfileHash(input.commit))) {
    await installDeps(input.checkout.dir);
  }
  // Unconditional: the sources the CLI is built from change at every landing,
  // whether or not the lockfile did.
  await buildCli(input.checkout.dir);
}
