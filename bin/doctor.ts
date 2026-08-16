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
 * Checks (each with a pass/fail + a one-line remedy on failure):
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
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
// Workspace import of an engine module from root tooling. Verified to work
// cleanly (both `tsc --noEmit` and `node --import tsx` resolve it via the
// `.js`-extension NodeNext convention) — no awkwardness to fall back from.
import { resolveClaudeCodeBinary } from "../callback-box/src/core/sdk-binary-path.js";
import { isRecord } from "../callback-box/src/lib/is-record.js";

const execFileAsync = promisify(execFile);

/** Thrown for genuinely-impossible inputs (a hand-corrupted `engines` field). */
export class DoctorError extends Error {
  override name = "DoctorError";
}

// ─── Subprocess + filesystem injection ───────────────────────────────────────

export interface CommandResult {
  /** True iff the OS was able to spawn the command at all (found on PATH). */
  spawned: boolean;
  /** Exit code, or null if the process never spawned or was killed/timed out. */
  code: number | null;
  stdout: string;
  stderr: string;
}

export type RunCommand = (cmd: string, args: string[]) => Promise<CommandResult>;

export function createRealRun(): RunCommand {
  return async (cmd, args) => {
    try {
      const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: 10000, encoding: "utf8" });
      return { spawned: true, code: 0, stdout, stderr };
    } catch (e) {
      const err = e as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string };
      if (err.code === "ENOENT") {
        return { spawned: false, code: null, stdout: "", stderr: "" };
      }
      const numericCode = typeof err.code === "number" ? err.code : null;
      return { spawned: true, code: numericCode, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
    }
  };
}

export interface DoctorDeps {
  run: RunCommand;
  fileExists: (absPath: string) => boolean;
  nodeVersion: string;
  repoRoot: string;
  engines: string;
  packageManager: string;
  resolveSdkBinary: () => string | null;
  /**
   * Loads better-sqlite3 and opens an in-memory database, resolving to a
   * detail string. This is THE check that catches Node-ABI drift directly —
   * a native module compiled against a different Node breaks at dlopen, and
   * historically that surfaced as an opaque crash at first box boot rather
   * than anything naming the cause.
   */
  loadBetterSqlite3: () => Promise<string>;
}

// ─── Minimal version-range comparison (no `semver` dependency: it's hoisted
// but has no type declarations in this workspace — see the plan's B1 note) ──

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

/** Parses `vX`, `X`, `X.Y`, or `X.Y.Z` into a 3-tuple, defaulting missing parts to 0. */
export function parseVersion(raw: string): ParsedVersion {
  const cleaned = raw.trim().replace(/^v/, "");
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(cleaned);
  if (m === null) throw new DoctorError(`cannot parse version: ${raw}`);
  const [, majorStr, minorStr, patchStr] = m;
  if (majorStr === undefined) throw new DoctorError(`cannot parse version: ${raw}`);
  return { major: Number(majorStr), minor: Number(minorStr ?? "0"), patch: Number(patchStr ?? "0") };
}

function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

type RangeOperator = ">=" | "<=" | ">" | "<" | "=";

interface RangeComparator {
  op: RangeOperator;
  version: ParsedVersion;
}

function toRangeOperator(raw: string | undefined): RangeOperator {
  if (raw === undefined || raw === "") return "=";
  if (raw === ">=" || raw === "<=" || raw === ">" || raw === "<" || raw === "=") return raw;
  throw new DoctorError(`unknown range operator: ${raw}`);
}

const RANGE_TOKEN = /^(>=|<=|>|<|=)?(.+)$/;

function parseRange(range: string): RangeComparator[] {
  return range
    .trim()
    .split(/\s+/)
    .filter((token) => token !== "")
    .map((token) => {
      const m = RANGE_TOKEN.exec(token);
      if (m === null) throw new DoctorError(`cannot parse range comparator: ${token}`);
      const [, opRaw, versionPart] = m;
      if (versionPart === undefined) throw new DoctorError(`cannot parse range comparator: ${token}`);
      return { op: toRangeOperator(opRaw), version: parseVersion(versionPart) };
    });
}

function comparatorHolds(cmp: number, op: RangeOperator): boolean {
  switch (op) {
    case ">=":
      return cmp >= 0;
    case "<=":
      return cmp <= 0;
    case ">":
      return cmp > 0;
    case "<":
      return cmp < 0;
    case "=":
      return cmp === 0;
    default: {
      const exhaustive: never = op;
      throw new DoctorError(`unhandled range operator: ${String(exhaustive)}`);
    }
  }
}

/** Space-separated comparators are ANDed (npm/pnpm `engines` range syntax). */
export function satisfiesRange(version: string, range: string): boolean {
  const v = parseVersion(version);
  const comparators = parseRange(range);
  return comparators.every(({ op, version: cv }) => comparatorHolds(compareVersions(v, cv), op));
}

// ─── Check result shape ──────────────────────────────────────────────────────

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  remedy: string | null;
}

function pass(name: string, detail: string): CheckResult {
  return { name, ok: true, detail, remedy: null };
}

function fail(name: string, detail: string, remedy: string): CheckResult {
  return { name, ok: false, detail, remedy };
}

// ─── Checks ───────────────────────────────────────────────────────────────

export function checkNodeVersion(deps: Pick<DoctorDeps, "nodeVersion" | "engines">): CheckResult {
  const name = "Node version";
  try {
    const ok = satisfiesRange(deps.nodeVersion, deps.engines);
    if (ok) return pass(name, `${deps.nodeVersion} satisfies "${deps.engines}"`);
    return fail(
      name,
      `${deps.nodeVersion} does not satisfy "${deps.engines}"`,
      `install a Node version matching "${deps.engines}" (see root .nvmrc)`,
    );
  } catch (e) {
    return fail(name, `could not parse Node version/engines range: ${(e as Error).message}`, "check root package.json's engines.node field");
  }
}

export async function checkPnpm(deps: Pick<DoctorDeps, "run" | "packageManager">): Promise<CheckResult> {
  const name = "pnpm";
  const result = await deps.run("pnpm", ["--version"]);
  if (!result.spawned) {
    return fail(name, "not found on PATH", "install pnpm (https://pnpm.io/installation) or enable it via `corepack enable`");
  }
  const installedVersion = result.stdout.trim();
  const expectedVersion = deps.packageManager.split("@")[1];
  const expectedMajor = expectedVersion?.split(".")[0];
  const installedMajor = installedVersion.split(".")[0];
  if (expectedMajor === undefined) {
    return fail(name, `root packageManager field is malformed: "${deps.packageManager}"`, "fix packageManager in root package.json");
  }
  if (installedMajor === expectedMajor) {
    return pass(name, `${installedVersion} (matches packageManager major ${expectedMajor})`);
  }
  return fail(
    name,
    `${installedVersion} does not match packageManager major ${expectedMajor} ("${deps.packageManager}")`,
    `run \`corepack use pnpm@${expectedVersion}\` (or install pnpm ${expectedMajor}.x directly)`,
  );
}

export function checkWorkspaceInstalled(deps: Pick<DoctorDeps, "fileExists" | "repoRoot">): CheckResult {
  const name = "Workspace installed";
  const hoistedDir = path.join(deps.repoRoot, "node_modules", ".pnpm");
  if (deps.fileExists(hoistedDir)) {
    return pass(name, `${hoistedDir} exists`);
  }
  return fail(name, `${hoistedDir} is missing`, "run `pnpm install` at the repo root");
}

interface BinaryCheckSpec {
  displayName: string;
  binary: string;
  versionArgs: string[];
  remedy: string;
}

const EXTERNAL_TOOL_CHECKS: BinaryCheckSpec[] = [
  { displayName: "pandoc", binary: "pandoc", versionArgs: ["--version"], remedy: "install pandoc (brew install pandoc / apt-get install pandoc)" },
  { displayName: "magick", binary: "magick", versionArgs: ["-version"], remedy: "install ImageMagick (brew install imagemagick / apt-get install imagemagick)" },
  { displayName: "pdftotext", binary: "pdftotext", versionArgs: ["-v"], remedy: "install poppler-utils (brew install poppler / apt-get install poppler-utils)" },
];

async function checkBinaryOnPath(deps: Pick<DoctorDeps, "run">, spec: BinaryCheckSpec): Promise<CheckResult> {
  const result = await deps.run(spec.binary, spec.versionArgs);
  if (!result.spawned) return fail(spec.displayName, "not found on PATH", spec.remedy);
  const firstLine = (result.stdout || result.stderr).split("\n")[0]?.trim() ?? "";
  return pass(spec.displayName, firstLine !== "" ? firstLine : "found on PATH");
}

export async function checkExternalTools(deps: Pick<DoctorDeps, "run">): Promise<CheckResult[]> {
  return Promise.all(EXTERNAL_TOOL_CHECKS.map((spec) => checkBinaryOnPath(deps, spec)));
}

export async function checkGitLfs(deps: Pick<DoctorDeps, "run">): Promise<CheckResult> {
  const name = "git-lfs";
  const binaryResult = await deps.run("git-lfs", ["version"]);
  if (!binaryResult.spawned) {
    return fail(name, "not found on PATH", "install git-lfs (brew install git-lfs / apt-get install git-lfs)");
  }
  const filterResult = await deps.run("git", ["config", "--get", "filter.lfs.clean"]);
  const filterInstalled = filterResult.spawned && filterResult.code === 0 && filterResult.stdout.trim() !== "";
  if (filterInstalled) {
    return pass(name, `binary present; filter.lfs.clean = "${filterResult.stdout.trim()}"`);
  }
  return fail(name, "binary present but LFS filters are not installed", "run `git lfs install`");
}

export async function checkClaudeAuth(deps: Pick<DoctorDeps, "run">): Promise<CheckResult> {
  const name = "Claude auth";
  const which = await deps.run("claude", ["--version"]);
  if (!which.spawned) {
    return fail(name, "the `claude` CLI is not on PATH", "install the Claude Code CLI (https://code.claude.com) then run `claude auth login`");
  }
  const status = await deps.run("claude", ["auth", "status"]);
  // Tolerant parse, mirroring callback-box/src/services/claude-cli.ts's
  // authStatus(): stdout should be JSON, but fall back gracefully if not.
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(status.stdout || "") as Record<string, unknown>;
  } catch {
    parsed = null;
  }
  const loggedIn = parsed?.["loggedIn"] === true;
  if (loggedIn) {
    const email = typeof parsed?.["email"] === "string" ? parsed["email"] : undefined;
    return pass(name, email !== undefined ? `logged in as ${email}` : "logged in");
  }
  return fail(name, "not logged in", "run `claude auth login`");
}

export async function checkNativeSqlite(deps: Pick<DoctorDeps, "loadBetterSqlite3">): Promise<CheckResult> {
  const name = "Native modules (better-sqlite3)";
  try {
    const detail = await deps.loadBetterSqlite3();
    return pass(name, detail);
  } catch (e) {
    const firstLine = (e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "";
    return fail(
      name,
      `better-sqlite3 failed to load: ${firstLine}`,
      "the compiled binary doesn't match this Node (ABI drift) — run `pnpm install` (or `pnpm rebuild better-sqlite3`) under the pinned Node version",
    );
  }
}

export function checkSdkBinary(deps: Pick<DoctorDeps, "resolveSdkBinary">): CheckResult {
  const name = "Agent SDK binary";
  const resolved = deps.resolveSdkBinary();
  if (resolved !== null) return pass(name, resolved);
  return fail(
    name,
    "no bundled Claude Code binary resolves for this platform",
    "reinstall dependencies (`pnpm install`) so the matching @anthropic-ai/claude-agent-sdk-* subpackage is present",
  );
}

export function checkFrontendBuild(deps: Pick<DoctorDeps, "fileExists" | "repoRoot">): CheckResult {
  const name = "Frontend build";
  const indexHtml = path.join(deps.repoRoot, "callback-box", "src", "frontend", "dist", "index.html");
  if (deps.fileExists(indexHtml)) return pass(name, `${indexHtml} exists`);
  return fail(name, `${indexHtml} is missing`, "run `pnpm --dir callback-box build:frontend`");
}

/**
 * Is main's HEAD actually live on the server?
 *
 * A deploy killed outright — OOM, closed terminal — never runs deploy.sh's EXIT
 * trap, so it emits no "Deploy failed" line and no notification. Main then sits
 * undeployed with nothing anywhere saying so (observed 2026-08-10; the run died
 * during dependency reconciliation under memory pressure and was found only
 * because someone thought to ask).
 *
 * `deploy/.last-deployed-sha` is written by deploy.sh only past the healthcheck,
 * so it means "this shipped and answered", not "we started shipping it". The
 * marker lives in the MAIN checkout — worktrees each have their own gitignored
 * (absent) copy — so resolve it through the shared git dir rather than
 * `repoRoot`, which is whatever tree doctor was invoked from.
 *
 * Reports only on drift from `main`. A checkout sitting on a feature branch is
 * the normal case and says nothing about what's deployed.
 */
export async function checkDeployCurrency(deps: Pick<DoctorDeps, "run" | "fileExists">): Promise<CheckResult> {
  const name = "Deploy currency";
  const common = await deps.run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!common.spawned || common.stdout.trim() === "") return pass(name, "not a git checkout — skipped");
  const mainRoot = path.dirname(common.stdout.trim());
  const marker = path.join(mainRoot, "callback-box", "deploy", "server-ip");
  // No server-ip means this machine doesn't deploy at all (a fresh clone, a
  // contributor's checkout). Nothing to be stale about.
  if (!deps.fileExists(marker)) return pass(name, "this checkout does not deploy — skipped");

  const shaFile = path.join(mainRoot, "callback-box", "deploy", ".last-deployed-sha");
  if (!deps.fileExists(shaFile)) {
    return pass(name, "no completed deploy recorded yet (marker added 2026-08-10)");
  }
  const [deployed, head] = await Promise.all([
    deps.run("cat", [shaFile]),
    deps.run("git", ["rev-parse", "main"]),
  ]);
  const deployedSha = deployed.stdout.trim();
  const headSha = head.stdout.trim();
  if (deployedSha === "" || headSha === "") return pass(name, "could not resolve both shas — skipped");
  if (deployedSha === headSha) return pass(name, `main ${headSha.slice(0, 8)} is live`);

  const behind = await deps.run("git", ["rev-list", "--count", `${deployedSha}..main`]);
  const count = behind.stdout.trim();
  return fail(
    name,
    `main is ${count === "" ? "ahead" : `${count} commit(s) ahead`} of the last completed deploy (${deployedSha.slice(0, 8)})`,
    "re-run `callback-box/deploy/deploy.sh --ref $(git rev-parse main)` from the main checkout, then check deploy/.last-deploy.log",
  );
}

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
  const manifest = JSON.parse(raw) as {
    engines?: { node?: string };
    packageManager?: string;
  };
  const engines = manifest.engines?.node;
  const packageManager = manifest.packageManager;
  if (engines === undefined) throw new DoctorError(`${manifestPath} is missing engines.node`);
  if (packageManager === undefined) throw new DoctorError(`${manifestPath} is missing packageManager`);
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
    loadBetterSqlite3: async () => {
      // createRequire, not `import()`: tsx's dynamic-import transform runs
      // es-module-lexer over this file and chokes on it (Parse error at the
      // header comment) — and better-sqlite3 is CJS regardless.
      const require = createRequire(import.meta.url);
      const BetterSqlite3 = require("better-sqlite3") as typeof import("better-sqlite3");
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
