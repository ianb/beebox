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
  await assertTapPlugins(dir);
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
 * `beebox`'s `pretest`, run explicitly.
 *
 * The tiers invoke the ledger wrapper directly rather than through `pnpm test`,
 * which means npm's `pretest` hook — `node scripts/build-cli.ts` — never fires.
 * A fresh detached worktree has no `dist/cli.mjs` at all, and every bisect
 * checkout leaves whatever the previous commit built, so the CLI the suite
 * exercises would be a different commit's. Running the package's own script
 * rather than restating its command keeps one definition of the build.
 */
async function buildCli(dir: string): Promise<void> {
  const result = await execa("pnpm", ["--dir", path.join(dir, "beebox"), "run", "pretest"], {
    reject: false,
    all: true,
  });
  if (result.exitCode !== 0) refuse(`beebox pretest (build-cli) failed:\n${result.all ?? ""}`);
}

/** The lockfile at a commit, so a bisect step reinstalls only when it must. */
async function lockfileHash(commit: string): Promise<string> {
  return await git(["rev-parse", `${commit}:pnpm-lock.yaml`]);
}

// ─── running tests in it ──────────────────────────────────────────────────

/** The ledger-wrapped tier command, as `beebox/package.json` spells it. */
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
  const result = await execa("pnpm", ["--dir", path.join(input.checkout.dir, "beebox"), ...tierArgs(input)], {
    reject: false,
    all: true,
    // The schedule already gated on memory pressure in `waitForQuietHost`
    // before this checkout was even created; the wrapper's own gate (mode
    // defaults to "full") would otherwise refuse with no TAP output if
    // pressure spiked again during `pnpm install`, and a refusal reads as a
    // clean, empty-failures run to `failingFiles` — a false green.
    env: { ...process.env, BBX_TEST_IGNORE_LOAD: "1" },
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
    ["--dir", path.join(input.checkout.dir, "beebox"), "exec", "tap", input.file],
    { reject: false, all: true },
  );
  return { output: result.all ?? "", exitCode: result.exitCode ?? null };
}

/**
 * The plugin set tap will actually run with, checked rather than assumed.
 *
 * The monorepo root's `postinstall` runs `tap build`, so every install in this
 * worktree leaves the `.taprc` set built. This is the assertion that it did:
 * `tap plugin list` prints the CONFIGURED set (a guard against a `.taprc`
 * regression), and `tap versions` lists the BUILT one under `plugins:` — the
 * set the 2026-08-25 baseline actually ran with, when 22 `test/frontend/*`
 * files died on `ERR_UNSUPPORTED_DIR_IMPORT` under the default
 * `@tapjs/typescript` loader and the whole batch was read as "environment".
 * See issues/closed/bugs/2026-08-25-fresh-checkout-tap-default-plugins.md.
 */
async function assertTapPlugins(dir: string): Promise<void> {
  const pkg = path.join(dir, "beebox");
  for (const args of [["plugin", "list"], ["versions"]]) {
    const result = await execa("pnpm", ["--dir", pkg, "exec", "tap", ...args], {
      reject: false,
      all: true,
    });
    if (result.exitCode !== 0 || (result.all ?? "").includes("@tapjs/typescript")) {
      refuse(`tap ${args.join(" ")} is not what .taprc configures:\n${result.all ?? ""}`);
    }
  }
}

/** Move the worktree to a commit, reinstalling only when the lockfile differs. */
export async function checkoutCommit(input: { checkout: Checkout; commit: string }): Promise<void> {
  if (checkedOut === input.commit) return;
  const before = checkedOut;
  await git(["checkout", "--detach", "--force", input.commit], input.checkout.dir);
  checkedOut = input.commit;
  if (before === null || (await lockfileHash(before)) !== (await lockfileHash(input.commit))) {
    await installDeps(input.checkout.dir);
    await assertTapPlugins(input.checkout.dir);
  }
  // Unconditional: the sources the CLI is built from change at every landing,
  // whether or not the lockfile did.
  await buildCli(input.checkout.dir);
}
