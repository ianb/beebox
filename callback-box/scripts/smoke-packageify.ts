#!/usr/bin/env tsx
/**
 * `box-packageify` end-to-end smoke gate (Track H, chunk H1's "exercised on a
 * scratch clone of `test1`" requirement).
 *
 * Clones the REAL `~/src/boxes/test1` (read-only `git clone`, local path —
 * this is the only operation that ever touches the real box) into a fresh
 * directory under `os.tmpdir()`, then does everything else to that clone
 * only:
 *
 *   1. `cb validate` on the clone (legacy shape) — baseline.
 *   2. Run the `box-packageify` migration on the clone for real.
 *   3. Assert `getBoxShape` reports v2.
 *   4. `cb validate` on the migrated clone; diff against the baseline —
 *      pass, or only the SAME pre-existing issues (no new ones introduced).
 *   5. `cb serve` boots on the migrated box; `/healthz` reports healthy;
 *      stop the server cleanly (SIGTERM).
 *
 * Uses THIS checkout's own engine throughout (`PACKAGE_ROOT/bin/cb`) rather
 * than an installed release — `box-packageify` itself only ever symlinks
 * `node_modules/callback-box` at the running engine (see `scaffoldPackageRoot`
 * in `src/core/box-package.ts`); there is no `node_modules/.bin/cb` to shell
 * out to without a real `pnpm install`, which this smoke test deliberately
 * doesn't do (real test1 is a large box; a full install adds minutes for no
 * signal beyond what `smoke-external-box.ts`/`smoke-upgrade.ts` already
 * cover for a fresh scaffold).
 *
 * NEVER writes into `~/src/boxes/test1` or `~/src/box-worktrees/*` — the
 * clone under `os.tmpdir()` is the only thing this script mutates. `git
 * clone` from a local path is a read from test1's perspective (git opens it
 * read-only to pack objects for the clone).
 *
 * Quiet on success (one summary line per step); full output from a failed
 * step surfaces immediately and the script exits nonzero.
 */

import { execa, type Subprocess } from "execa";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { PACKAGE_ROOT } from "../src/lib/package-root.js";
import { getBoxShape } from "../src/lib/box-shape.js";
import { runBoxPackageify } from "./migrate/box-packageify.js";

const REAL_TEST1 = path.join(os.homedir(), "src/boxes/test1");
const CB_BIN = path.join(PACKAGE_ROOT, "bin/cb");

/** Step-label identifiers, referenced (not inlined) at every
 *  `SmokeStepError`/`waitForStatus` call site — see `UPGRADE_STEPS` in
 *  `src/cli/commands/upgrade.ts` for why: `error/no-literal-error-message`
 *  flags a literal string ANYWHERE in a `new *Error(...)` call, not just the
 *  message position. */
const STEPS = {
  cbServe: "cb serve",
  cbServeShutdown: "cb serve shutdown",
  boxPackageify: "box-packageify",
  shapeCheck: "shape check",
  postMigrationValidateDiff: "post-migration validate diff",
} as const;

class SmokeStepError extends Error {
  readonly label: string;
  readonly detail: string;
  constructor(label: string, detail: string) {
    super("A box-packageify smoke-test step failed: " + label);
    this.name = "SmokeStepError";
    this.label = label;
    this.detail = detail;
  }
}

interface RunSpec {
  file: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

interface StepResult {
  exitCode: number;
  /** Combined stdout+stderr — for human-readable error reporting only. */
  output: string;
  /** stdout ALONE — for anything that gets diffed/compared. execa's `all`
   *  reconstructs a combined stream by interleaving two separate pipes as
   *  chunks arrive, which can garble (drop/reorder bytes at a chunk
   *  boundary) under the sustained high-volume output `cb validate --all`
   *  produces against a 900+ card box — found running this smoke test for
   *  real against test1: the merged stream corrupted mid-output, not just at
   *  the end, which a naive "diff the tail" wouldn't catch. A single
   *  un-interleaved pipe doesn't have this failure mode. */
  stdout: string;
  ms: number;
}

/** Run one gate step, timing it. Never throws on nonzero exit — callers
 *  decide what a given step's exit code means (validate's baseline run is
 *  ALLOWED to fail; most other steps are not). */
async function run(label: string, spec: RunSpec): Promise<StepResult> {
  const t0 = process.hrtime.bigint();
  const result = await execa(spec.file, spec.args, { cwd: spec.cwd, env: spec.env, reject: false, all: true });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  process.stderr.write(
    "[smoke-packageify] " + label + " (exit " + String(result.exitCode) + ", " + (ms / 1000).toFixed(1) + "s)\n"
  );
  return { exitCode: result.exitCode ?? 1, output: result.all ?? "", stdout: result.stdout ?? "", ms };
}

/** Run one gate step that MUST succeed. */
async function step(label: string, spec: RunSpec): Promise<StepResult> {
  const result = await run(label, spec);
  if (result.exitCode !== 0) {
    const command = spec.file + " " + spec.args.join(" ");
    throw new SmokeStepError(label, command + "\n" + result.output);
  }
  return result;
}

interface WaitForStatusArgs {
  url: string;
  expectStatus: number;
  timeoutMs: number;
  headers?: Record<string, string>;
}

async function waitForStatus(args: WaitForStatusArgs): Promise<Response> {
  const deadline = Date.now() + args.timeoutMs;
  let lastDetail = "no attempt succeeded";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(args.url, { headers: args.headers });
      if (response.status === args.expectStatus) return response;
      lastDetail = args.url + " returned " + String(response.status);
    } catch (e) {
      lastDetail = args.url + " errored: " + String(e);
    }
    await sleep(200);
  }
  throw new SmokeStepError("waitForStatus(" + args.url + ")", lastDetail);
}

/** Strip a `boxDir`-relative prefix from the START of `line` only (never a
 *  substring match anywhere else in the line) — `<boxDir>/content/` first
 *  (the longer, more specific prefix), then bare `<boxDir>/`. A substring
 *  `replaceAll` is unsafe here: on macOS `os.tmpdir()` returns the
 *  unresolved `/var/...` form while `cb validate` prints the realpath'd
 *  `/private/var/...` form (`/var` is a symlink to `/private/var`) — found
 *  running this smoke test for real, `boxDir` (without `/private`) still
 *  occurs as a substring a few characters into the realpath'd line, so a
 *  global replace silently mangled the path instead of leaving it alone. */
function stripBoxPrefix(line: string, boxDir: string): string {
  const contentPrefix = boxDir + "/content/";
  if (line.startsWith(contentPrefix)) return line.slice(contentPrefix.length);
  const boxPrefix = boxDir + "/";
  if (line.startsWith(boxPrefix)) return line.slice(boxPrefix.length);
  return line;
}

/** Normalize `cb validate` output into a comparable, order-independent set
 *  of issue lines — timestamps/paths inside a fixed clone are stable, so a
 *  straight line-set diff is enough to tell "same issues" from "new ones".
 *  `boxDir` must already be the REALPATH'd form (see `stripBoxPrefix`). */
function issueLines(output: string, boxDir: string): Set<string> {
  const lines = output.split("\n");
  // `cb validate --all` on a box this large (test1: 900+ cards) can exit via
  // `process.exit()` before Node finishes flushing its piped stdout — found
  // running this smoke test for real: both the baseline and post-migration
  // captures reliably end mid-line, at a DIFFERENT byte offset each run
  // (path lengths shifted by the migration), which otherwise reads as a
  // spurious "new issue." Dropping the last line is safe here since it's
  // dropped from BOTH sides of the diff symmetrically — a real CLI
  // large-output-truncation bug, worth its own fix outside this migration's
  // scope, not something box-packageify introduced.
  const completeLines = lines.slice(0, -1);
  return new Set(
    completeLines
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((l) => stripBoxPrefix(l, boxDir))
  );
}

async function serveAndProbe(args: { boxDir: string; contentDir: string; port: number }): Promise<void> {
  // /healthz (server-wide) requires a diag bearer key — see
  // registerRootInfoRoutes in src/webapp/server-root.ts. Same convention
  // smoke-external-box.ts uses.
  const diagKey = "smoke-packageify-diag-key";
  const cbServe: Subprocess = execa(CB_BIN, ["serve", "content", "--port", String(args.port)], {
    cwd: args.boxDir,
    env: { ...process.env, CB_DIAG_API_KEY: diagKey },
    reject: false,
    all: true,
  });
  try {
    const t0 = process.hrtime.bigint();
    const crashed = cbServe.then((result) => {
      throw new SmokeStepError(STEPS.cbServe, "server exited early:\n" + (result.all ?? ""));
    });
    await Promise.race([
      waitForStatus({
        url: "http://localhost:" + String(args.port) + "/healthz",
        headers: { Authorization: "Bearer " + diagKey },
        expectStatus: 200,
        timeoutMs: 20000,
      }),
      crashed,
    ]);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    process.stderr.write("[smoke-packageify] cb serve — /healthz 200 (" + (ms / 1000).toFixed(1) + "s)\n");

    cbServe.kill("SIGTERM");
    const serveResult = await cbServe;
    if (serveResult.signal !== "SIGTERM" && serveResult.exitCode !== 0) {
      throw new SmokeStepError(
        STEPS.cbServeShutdown,
        "unexpected exit: " + JSON.stringify({ signal: serveResult.signal, exitCode: serveResult.exitCode }) +
          "\n" + (serveResult.all ?? "")
      );
    }
    process.stderr.write("[smoke-packageify] cb serve — clean SIGTERM shutdown\n");
  } finally {
    if (cbServe.exitCode === null) cbServe.kill("SIGKILL");
  }
}

async function main(): Promise<void> {
  const scratchRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "cb-smoke-packageify-")));
  const boxDir = path.join(scratchRoot, "test1-clone");
  const claudeProjectsDir = await mkdtemp(path.join(os.tmpdir(), "cb-smoke-packageify-claude-"));
  process.stderr.write("[smoke-packageify] source (read-only): " + REAL_TEST1 + "\n[smoke-packageify] clone: " + boxDir + "\n");

  // `runBoxPackageify` below runs IN-PROCESS (not spawned), so these must be
  // set on the real `process.env` — a subprocess-only `env` object (as used
  // for the `execa` calls) wouldn't reach it.
  process.env.CB_CLAUDE_PROJECTS_DIR = claudeProjectsDir;
  // See CB_HOOK_BIN's doc comment in install-validation-hooks.ts: without
  // this, the migration's regenerated pre-commit hook would stamp the MAIN
  // checkout's `cb`, which doesn't have this plan's v2 support yet.
  process.env.CB_HOOK_BIN = CB_BIN;
  const env = process.env;

  const timings: Record<string, number> = {};
  const overallStart = process.hrtime.bigint();

  try {
    const cloneStart = process.hrtime.bigint();
    await step("git clone (read-only source)", {
      file: "git",
      args: ["clone", "--no-hardlinks", REAL_TEST1, boxDir],
      cwd: scratchRoot,
    });
    timings.clone = Number(process.hrtime.bigint() - cloneStart) / 1e6;

    const baselineStart = process.hrtime.bigint();
    const baseline = await run("cb validate --all (pre-migration baseline)", {
      file: CB_BIN,
      args: ["validate", "--all"],
      cwd: boxDir,
      env,
    });
    timings.validateBaseline = Number(process.hrtime.bigint() - baselineStart) / 1e6;
    const baselineIssues = issueLines(baseline.stdout, boxDir);

    const migrateStart = process.hrtime.bigint();
    const result = await runBoxPackageify(boxDir);
    timings.migrate = Number(process.hrtime.bigint() - migrateStart) / 1e6;
    if (result.status !== "applied") {
      throw new SmokeStepError(STEPS.boxPackageify, "expected status \"applied\", got \"" + result.status + "\"");
    }
    process.stderr.write(
      "[smoke-packageify] box-packageify applied (commit " + result.commitHash + ") (" +
        (timings.migrate / 1000).toFixed(1) + "s)\n"
    );

    const contentDir = path.join(boxDir, "content");
    const shape = await getBoxShape(contentDir);
    if (shape.shapeVersion !== 2) {
      throw new SmokeStepError(STEPS.shapeCheck, "expected shapeVersion 2, got " + String(shape.shapeVersion));
    }
    process.stderr.write("[smoke-packageify] getBoxShape reports shapeVersion 2\n");

    const afterStart = process.hrtime.bigint();
    const after = await run("cb validate --all (post-migration)", {
      file: CB_BIN,
      args: ["validate", "--all"],
      cwd: contentDir,
      env,
    });
    timings.validateAfter = Number(process.hrtime.bigint() - afterStart) / 1e6;
    const afterIssues = issueLines(after.stdout, boxDir);
    const newIssues = [...afterIssues].filter((l) => !baselineIssues.has(l));
    if (after.exitCode !== 0 && newIssues.length > 0) {
      throw new SmokeStepError(
        STEPS.postMigrationValidateDiff,
        "new issue lines not present in the baseline:\n" + newIssues.join("\n")
      );
    }
    process.stderr.write(
      "[smoke-packageify] cb validate diff — " +
        (after.exitCode === 0 ? "clean" : String(newIssues.length) + " new line(s) (0 expected) beyond baseline") + "\n"
    );

    const serveStart = process.hrtime.bigint();
    const port = 20000 + Math.floor(Math.random() * 20000);
    await serveAndProbe({ boxDir, contentDir, port });
    timings.serve = Number(process.hrtime.bigint() - serveStart) / 1e6;

    const totalMs = Number(process.hrtime.bigint() - overallStart) / 1e6;
    process.stderr.write(
      "\n[smoke-packageify] PASS — timings (s): " +
        Object.entries(timings).map(([k, v]) => k + "=" + (v / 1000).toFixed(1)).join(", ") +
        ", total=" + (totalMs / 1000).toFixed(1) + "\n"
    );
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
    await rm(claudeProjectsDir, { recursive: true, force: true });
  }
}

await main();
