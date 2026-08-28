#!/usr/bin/env node --import tsx
/**
 * Preflight doctor (`pnpm doctor`): checks that a developer's machine has
 * everything callback-box needs, with a one-line remedy for every failure.
 *
 * Why this exists: missing prerequisites fail silently (git-lfs filters:
 * `.husky/post-commit` degrades with `|| true`) or opaquely (a missing/expired
 * Claude login surfaces as an unhelpful SDK stream failure). This is the rail
 * beside the install path — read `callback-box/docs/plans/installation-story.md`
 * Track B for the design discussion, including why this is a small root
 * script rather than a shared check-framework library (health.ts, the run-path
 * preflight, and this doctor each have their own right-sized shape).
 *
 * Checks (each with a pass/fail + a one-line remedy on failure), all in
 * `bin/doctor-checks.ts`:
 *   - Node version satisfies root package.json `engines.node`.
 *   - pnpm present, major version matches `packageManager`.
 *   - Workspace installed from the root (hoisted `node_modules/.pnpm`).
 *   - better-sqlite3 loads and opens a database — the direct probe for
 *     Node-ABI drift, the failure the version pin exists to prevent.
 *   - `pandoc`, `magick`, `pdftotext` on PATH (the external-tools contract
 *     promised to agents: `callback-box/src/core/agent-guide/chat.ts`).
 *   - `git-lfs` binary present AND its filters are actually installed
 *     (`git config --get filter.lfs.clean` resolves) — the binary alone is
 *     not enough (`src/core/box/index.ts` wires LFS `.gitattributes` per box).
 *   - System `claude` on PATH and `claude auth status` reports logged in
 *     (mirrors `callback-box/src/services/claude-cli.ts`'s invocation and its
 *     tolerant non-JSON-output parsing).
 *   - The Agent SDK resolves a bundled Claude Code binary for this platform
 *     (`callback-box/src/core/sdk-binary-path.ts`, imported directly — the
 *     workspace import works cleanly from a root tsx script; see below).
 *   - The scheduler heartbeat (`<store>/state.json`) is under an hour old and
 *     the `com.callback-box.schedules` launchd job is loaded — the anti-silence
 *     check for callback-box/docs/plans/scheduled-workstreams.md.
 *   - The frontend build output exists (`callback-box/src/frontend/dist`,
 *     Vite's `build.outDir`), else "run `pnpm --dir callback-box
 *     build:frontend`".
 *
 * `--json` prints a machine-readable array of check results instead of the
 * table. Exit code is nonzero iff any check failed.
 *
 * Invocation note: pnpm 10 ships its own builtin `doctor` command, which
 * silently shadows a same-named package.json script when invoked as the
 * bare `pnpm doctor` shorthand (no output, exit 0 — verified against pnpm
 * 10.26.2). Use `pnpm run doctor` to reach this script unambiguously; any
 * docs/quickstart text that says `pnpm doctor` should say `pnpm run doctor`
 * instead, or this script needs a different name. Flagged for the plan
 * owner rather than resolved unilaterally, since the plan names the script
 * "doctor" explicitly.
 *
 * Testability: every check is `(deps: DoctorDeps) => Promise<CheckResult>` —
 * `deps.run` (subprocess execution) and `deps.fileExists` are the only
 * injected I/O, so `bin/doctor.test.ts` can fake both without touching the
 * real filesystem or spawning real processes.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import type BetterSqlite3Module from "better-sqlite3";
// Workspace import of an engine module from root tooling. Verified to work
// cleanly (both `tsc --noEmit` and `node --import tsx` resolve it via the
// `.js`-extension NodeNext convention) — no awkwardness to fall back from.
import { resolveClaudeCodeBinary } from "../callback-box/src/core/sdk-binary-path.js";
import { isRecord } from "../callback-box/src/lib/is-record.js";
import {
  createRealRun,
  MissingEnginesNodeError,
  MissingPackageManagerError,
  type CheckResult,
  type DoctorDeps,
} from "./doctor-lib.js";
import {
  checkClaudeAuth,
  checkDeployCurrency,
  checkExternalTools,
  checkFrontendBuild,
  checkGitLfs,
  checkNativeSqlite,
  checkNodeVersion,
  checkPnpm,
  checkSchedulesTick,
  checkSdkBinary,
  checkWorkspaceInstalled,
} from "./doctor-checks.js";

// ─── Runner ───────────────────────────────────────────────────────────────

export async function runChecks(deps: DoctorDeps): Promise<CheckResult[]> {
  const [pnpmResult, workspaceResult, nativeSqliteResult, externalTools, gitLfsResult, claudeResult] =
    await Promise.all([
      checkPnpm(deps),
      Promise.resolve(checkWorkspaceInstalled(deps)),
      checkNativeSqlite(deps),
      checkExternalTools(deps),
      checkGitLfs(deps),
      checkClaudeAuth(deps),
    ]);
  const deployResult = await checkDeployCurrency(deps);
  const schedulesResult = await checkSchedulesTick(deps);
  return [
    checkNodeVersion(deps),
    pnpmResult,
    workspaceResult,
    nativeSqliteResult,
    ...externalTools,
    gitLfsResult,
    claudeResult,
    checkSdkBinary(deps),
    checkFrontendBuild(deps),
    deployResult,
    schedulesResult,
  ];
}

// ─── Output ───────────────────────────────────────────────────────────────

export function formatTable(results: CheckResult[]): string {
  const lines: string[] = [];
  for (const result of results) {
    const mark = result.ok ? "✓" : "✗";
    lines.push(`${mark} ${result.name}: ${result.detail}`);
    if (!result.ok) lines.push(`    remedy: ${result.remedy}`);
  }
  return lines.join("\n");
}

export function formatJson(results: CheckResult[]): { ok: boolean; checks: CheckResult[] } {
  return { ok: results.every((r) => r.ok), checks: results };
}

async function readRootPackageJson(repoRoot: string): Promise<{ engines: string; packageManager: string }> {
  const manifestPath = path.join(repoRoot, "package.json");
  const raw = await fs.promises.readFile(manifestPath, "utf8");
  const manifest: {
    engines?: { node?: string };
    packageManager?: string;
  } = JSON.parse(raw);
  const engines = manifest.engines?.node;
  const packageManager = manifest.packageManager;
  if (engines === undefined) throw new MissingEnginesNodeError(manifestPath);
  if (packageManager === undefined) throw new MissingPackageManagerError(manifestPath);
  return { engines, packageManager };
}

async function main(): Promise<void> {
  const jsonOutput = process.argv.includes("--json");
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const { engines, packageManager } = await readRootPackageJson(repoRoot);

  const deps: DoctorDeps = {
    run: createRealRun(),
    fileExists: (p) => fs.existsSync(p),
    nodeVersion: process.version,
    repoRoot,
    engines,
    packageManager,
    resolveSdkBinary: resolveClaudeCodeBinary,
    nowMs: Date.now(),
    loadBetterSqlite3: async () => {
      // createRequire, not `import()`: tsx's dynamic-import transform runs
      // es-module-lexer over this file and chokes on it (Parse error at the
      // header comment) — and better-sqlite3 is CJS regardless.
      const require = createRequire(import.meta.url);
      const BetterSqlite3: typeof BetterSqlite3Module = require("better-sqlite3");
      const db = new BetterSqlite3(":memory:");
      try {
        const row: unknown = db.prepare("select sqlite_version() as v").get();
        const version = isRecord(row) && typeof row.v === "string" ? row.v : "unknown";
        return `loads and opens (SQLite ${version})`;
      } finally {
        db.close();
      }
    },
  };

  const results = await runChecks(deps);

  if (jsonOutput) {
    console.log(JSON.stringify(formatJson(results), null, 2));
  } else {
    console.log(formatTable(results));
  }

  if (!results.every((r) => r.ok)) process.exit(1);
}

// Run only as a script, not when imported by the test.
if (process.argv[1] !== undefined && process.argv[1].endsWith("doctor.ts")) {
  await main();
}
