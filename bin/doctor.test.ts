// Unit tests for doctor.ts: the version-range comparator (pure), individual
// checks driven through a fake `run`/`fileExists`, and the JSON output shape.
// No real subprocess spawning or filesystem access. Run with:
//   node --import tsx --test bin/doctor.test.ts
// (or `pnpm test` at the repo root, which runs every bin/*.test.ts this way).

import assert from "node:assert/strict";
import { test } from "node:test";
import { formatJson, formatTable, runChecks } from "./doctor.js";
import {
  checkClaudeAuth,
  checkFrontendBuild,
  checkGitLfs,
  checkNativeSqlite,
  checkNodeVersion,
  checkPnpm,
  checkProductionDisk,
  checkSchedulesTick,
  checkSdkBinary,
  checkWorkspaceInstalled,
} from "./doctor-checks.js";
import {
  parseVersion,
  satisfiesRange,
  type CommandResult,
  type DoctorDeps,
  type RunCommand,
} from "./doctor-lib.js";

// ─── Version-range comparison (pure) ───────────────────────────────────────

test("parseVersion fills missing minor/patch with 0 and strips a leading v", () => {
  assert.deepEqual(parseVersion("v22"), { major: 22, minor: 0, patch: 0 });
  assert.deepEqual(parseVersion("22.11"), { major: 22, minor: 11, patch: 0 });
  assert.deepEqual(parseVersion("22.11.0"), { major: 22, minor: 11, patch: 0 });
});

test("satisfiesRange ANDs space-separated comparators", () => {
  assert.equal(satisfiesRange("22.22.1", ">=22.11.0 <23"), true);
  assert.equal(satisfiesRange("24.0.0", ">=22.11.0 <23"), false);
  assert.equal(satisfiesRange("22.5.0", ">=22.11.0 <23"), false);
});

test("satisfiesRange handles a bare exact version and single-sided comparators", () => {
  assert.equal(satisfiesRange("10.26.2", "10.26.2"), true);
  assert.equal(satisfiesRange("10.26.3", "10.26.2"), false);
  assert.equal(satisfiesRange("10.0.0", ">=10"), true);
  assert.equal(satisfiesRange("9.9.9", ">=10"), false);
});

test("checkNodeVersion passes when in range and fails with a remedy when not", () => {
  const inRange = checkNodeVersion({ nodeVersion: "v22.22.1", engines: ">=22.11.0 <23" });
  assert.equal(inRange.ok, true);

  const outOfRange = checkNodeVersion({ nodeVersion: "v24.0.0", engines: ">=22.11.0 <23" });
  assert.equal(outOfRange.ok, false);
  assert.match(outOfRange.remedy ?? "", /install a Node version/);
});

// ─── Fake run() helper ──────────────────────────────────────────────────────

function fakeRun(responses: Record<string, CommandResult>): RunCommand {
  return async (cmd, args) => {
    const key = [cmd, ...args].join(" ");
    const response = responses[key];
    if (response !== undefined) return response;
    return { spawned: false, code: null, stdout: "", stderr: "" };
  };
}

function ok(stdout: string): CommandResult {
  return { spawned: true, code: 0, stdout, stderr: "" };
}

/** Stands in for the native-module load failure a Node major bump produces. */
class FakeAbiDriftError extends Error {
  constructor() {
    super(
      "ERR_DLOPEN_FAILED: The module was compiled against a different Node.js version\nmore detail",
    );
    this.name = "FakeAbiDriftError";
  }
}

// ─── Individual checks against a fake exec ─────────────────────────────────

test("checkPnpm passes when the installed major matches packageManager", async () => {
  const run = fakeRun({ "pnpm --version": ok("10.26.2\n") });
  const result = await checkPnpm({ run, packageManager: "pnpm@10.26.2" });
  assert.equal(result.ok, true);
});

test("checkPnpm fails with a remedy when the major differs", async () => {
  const run = fakeRun({ "pnpm --version": ok("9.1.0\n") });
  const result = await checkPnpm({ run, packageManager: "pnpm@10.26.2" });
  assert.equal(result.ok, false);
  assert.match(result.remedy ?? "", /corepack use pnpm@10\.26\.2/);
});

test("a missing binary produces a failing check with a nonzero-aggregate-worthy remedy", async () => {
  const run = fakeRun({});
  const result = await checkPnpm({ run, packageManager: "pnpm@10.26.2" });
  assert.equal(result.ok, false);
  assert.equal(result.detail, "not found on PATH");
  assert.match(result.remedy ?? "", /install pnpm/);
});

test("checkWorkspaceInstalled checks for the hoisted node_modules/.pnpm dir", () => {
  const present = checkWorkspaceInstalled({ fileExists: () => true, repoRoot: "/repo" });
  assert.equal(present.ok, true);

  const missing = checkWorkspaceInstalled({ fileExists: () => false, repoRoot: "/repo" });
  assert.equal(missing.ok, false);
  assert.match(missing.remedy ?? "", /pnpm install/);
});

test("checkGitLfs fails when the binary is missing", async () => {
  const run = fakeRun({});
  const result = await checkGitLfs({ run });
  assert.equal(result.ok, false);
  assert.match(result.remedy ?? "", /install git-lfs/);
});

test("checkGitLfs fails when the binary is present but the filter is not installed", async () => {
  const run = fakeRun({
    "git-lfs version": ok("git-lfs/3.7.1"),
    "git config --get filter.lfs.clean": { spawned: true, code: 1, stdout: "", stderr: "" },
  });
  const result = await checkGitLfs({ run });
  assert.equal(result.ok, false);
  assert.match(result.remedy ?? "", /git lfs install/);
});

test("checkGitLfs passes when the binary and the filter are both present", async () => {
  const run = fakeRun({
    "git-lfs version": ok("git-lfs/3.7.1"),
    "git config --get filter.lfs.clean": ok("git-lfs clean -- %f\n"),
  });
  const result = await checkGitLfs({ run });
  assert.equal(result.ok, true);
});

test("checkClaudeAuth fails when the CLI is missing", async () => {
  const run = fakeRun({});
  const result = await checkClaudeAuth({ run });
  assert.equal(result.ok, false);
  assert.match(result.remedy ?? "", /claude auth login/);
});

test("checkClaudeAuth fails when logged out", async () => {
  const run = fakeRun({
    "claude --version": ok("1.2.3"),
    "claude auth status": ok(JSON.stringify({ loggedIn: false })),
  });
  const result = await checkClaudeAuth({ run });
  assert.equal(result.ok, false);
});

test("checkClaudeAuth passes and surfaces the email when logged in", async () => {
  const run = fakeRun({
    "claude --version": ok("1.2.3"),
    "claude auth status": ok(JSON.stringify({ loggedIn: true, email: "dev@example.com" })),
  });
  const result = await checkClaudeAuth({ run });
  assert.equal(result.ok, true);
  assert.match(result.detail, /dev@example\.com/);
});

test("checkClaudeAuth tolerates non-JSON stdout (fails closed, doesn't throw)", async () => {
  const run = fakeRun({
    "claude --version": ok("1.2.3"),
    "claude auth status": ok("not json"),
  });
  const result = await checkClaudeAuth({ run });
  assert.equal(result.ok, false);
});

test("checkSdkBinary reports the resolved path or a remedy when null", () => {
  const resolved = checkSdkBinary({ resolveSdkBinary: () => "/path/to/claude" });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.detail, "/path/to/claude");

  const missing = checkSdkBinary({ resolveSdkBinary: () => null });
  assert.equal(missing.ok, false);
  assert.match(missing.remedy ?? "", /pnpm install/);
});

test("checkFrontendBuild fails with the build:frontend remedy when dist/index.html is absent", () => {
  const result = checkFrontendBuild({ fileExists: () => false, repoRoot: "/repo" });
  assert.equal(result.ok, false);
  assert.match(result.remedy ?? "", /build:frontend/);
});

// ─── Schedules heartbeat + launchd job ─────────────────────────────────────

const NOW_MS = Date.parse("2026-08-24T12:00:00Z");
const GIT_COMMON = "git rev-parse --path-format=absolute --git-common-dir";

function schedulesRun(state: string, launchctlCode: number): RunCommand {
  return fakeRun({
    [GIT_COMMON]: ok("/checkouts/callback-box/.git\n"),
    "cat /checkouts/schedule-runs/state.json": ok(state),
    "id -u": ok("501\n"),
    "launchctl print gui/501/com.callback-box.schedules": { spawned: true, code: launchctlCode, stdout: "", stderr: "" },
  });
}

test("checkProductionDisk reports free space and fails below the shared threshold", async () => {
  const marker = "/checkouts/callback-box/callback-box/deploy/server-ip";
  const base = {
    [GIT_COMMON]: ok("/checkouts/callback-box/.git\n"),
    [`cat ${marker}`]: ok("203.0.113.10\n"),
  };
  const check = async (availableKib: number) => checkProductionDisk({
    run: fakeRun({
      ...base,
      "ssh -o BatchMode=yes -o ConnectTimeout=5 root@203.0.113.10 df -Pk /": ok(`Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/vda1 78643200 0 ${String(availableKib)} 0% /\n`),
    }),
    fileExists: (candidate) => candidate === marker,
  });

  const healthy = await check(65 * 1024 * 1024);
  assert.equal(healthy.ok, true);
  assert.match(healthy.detail, /65\.0 GiB free.*7\.5 GiB/);
  const low = await check(5 * 1024 * 1024);
  assert.equal(low.ok, false);
  assert.match(low.detail, /5\.0 GiB free.*7\.5 GiB/);
});

test("checkSchedulesTick skips a machine with no schedule store", async () => {
  const run = fakeRun({ [GIT_COMMON]: ok("/checkouts/callback-box/.git\n") });
  const result = await checkSchedulesTick({ run, fileExists: () => false, nowMs: NOW_MS });
  assert.equal(result.ok, true);
  assert.match(result.detail, /no schedules installed/);
});

test("checkSchedulesTick passes on a fresh heartbeat with the plist loaded", async () => {
  const run = schedulesRun(JSON.stringify({ lastTickAt: "2026-08-24T11:50:00Z", lastTickExit: 0 }), 0);
  const result = await checkSchedulesTick({ run, fileExists: () => true, nowMs: NOW_MS });
  assert.equal(result.ok, true);
  assert.match(result.detail, /10 min ago/);
});

test("checkSchedulesTick fails on a heartbeat older than an hour", async () => {
  const run = schedulesRun(JSON.stringify({ lastTickAt: "2026-08-24T08:00:00Z", lastTickExit: 0 }), 0);
  const result = await checkSchedulesTick({ run, fileExists: () => true, nowMs: NOW_MS });
  assert.equal(result.ok, false);
  assert.match(result.remedy ?? "", /bin\/schedules install/);
});

test("checkSchedulesTick fails when the tick job is not loaded, and tolerates a missing launchctl", async () => {
  const notLoaded = schedulesRun(JSON.stringify({ lastTickAt: "2026-08-24T11:55:00Z", lastTickExit: 0 }), 113);
  const failed = await checkSchedulesTick({ run: notLoaded, fileExists: () => true, nowMs: NOW_MS });
  assert.equal(failed.ok, false);
  assert.match(failed.detail, /not loaded in launchd/);

  const noLaunchctl = fakeRun({
    [GIT_COMMON]: ok("/checkouts/callback-box/.git\n"),
    "cat /checkouts/schedule-runs/state.json": ok(JSON.stringify({ lastTickAt: "2026-08-24T11:55:00Z", lastTickExit: 0 })),
    "id -u": ok("501\n"),
  });
  const tolerated = await checkSchedulesTick({ run: noLaunchctl, fileExists: () => true, nowMs: NOW_MS });
  assert.equal(tolerated.ok, true);
  assert.match(tolerated.detail, /launchctl unavailable/);
});

test("checkSchedulesTick fails when the store exists but was never ticked", async () => {
  const run = fakeRun({ [GIT_COMMON]: ok("/checkouts/callback-box/.git\n") });
  const result = await checkSchedulesTick({ run, fileExists: () => true, nowMs: NOW_MS });
  assert.equal(result.ok, false);
  assert.match(result.detail, /never ticked/);
});

// ─── Aggregate runner + output shapes ──────────────────────────────────────

function passingDeps(overrides: Partial<DoctorDeps>): DoctorDeps {
  const run = fakeRun({
    "pnpm --version": ok("10.26.2\n"),
    "pandoc --version": ok("pandoc 3.8.2.1"),
    "magick -version": ok("Version: ImageMagick 7.1.1"),
    "pdftotext -v": ok("pdftotext version 26.04.0"),
    "git-lfs version": ok("git-lfs/3.7.1"),
    "git config --get filter.lfs.clean": ok("git-lfs clean -- %f\n"),
    "claude --version": ok("1.2.3"),
    "claude auth status": ok(JSON.stringify({ loggedIn: true, email: "dev@example.com" })),
  });
  return {
    run,
    fileExists: () => true,
    nodeVersion: "v22.22.1",
    repoRoot: "/repo",
    engines: ">=22.11.0 <23",
    packageManager: "pnpm@10.26.2",
    resolveSdkBinary: () => "/repo/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude",
    loadBetterSqlite3: async () => "loads and opens (SQLite 3.50.0)",
    nowMs: Date.parse("2026-08-24T12:00:00Z"),
    ...overrides,
  };
}

test("runChecks aggregates every check; all passing means an all-ok JSON shape", async () => {
  const results = await runChecks(passingDeps({}));
  assert.equal(results.every((r) => r.ok), true);
  const json = formatJson(results);
  assert.equal(json.ok, true);
  assert.equal(json.checks.length, results.length);
  // Shape: every check is { name, ok, detail, remedy }.
  for (const check of json.checks) {
    assert.equal(typeof check.name, "string");
    assert.equal(typeof check.ok, "boolean");
    assert.equal(typeof check.detail, "string");
    assert.ok(check.remedy === null || typeof check.remedy === "string");
  }
});

test("one failing check flips the aggregate JSON ok to false without hiding the rest", async () => {
  const deps = passingDeps({ fileExists: () => false }); // fails workspace-installed + frontend-build
  const results = await runChecks(deps);
  const json = formatJson(results);
  assert.equal(json.ok, false);
  assert.equal(results.length, json.checks.length);
  assert.ok(results.some((r) => r.name === "Workspace installed" && !r.ok));
  assert.ok(results.some((r) => r.name === "Frontend build" && !r.ok));
});

test("checkNativeSqlite passes with the loader's detail and fails on a load error naming ABI drift", async () => {
  const passResult = await checkNativeSqlite({ loadBetterSqlite3: async () => "loads and opens (SQLite 3.50.0)" });
  assert.equal(passResult.ok, true);
  assert.match(passResult.detail, /SQLite 3\.50\.0/);

  const failResult = await checkNativeSqlite({
    loadBetterSqlite3: async () => {
      throw new FakeAbiDriftError();
    },
  });
  assert.equal(failResult.ok, false);
  assert.match(failResult.detail, /ERR_DLOPEN_FAILED/);
  assert.equal(failResult.detail.includes("more detail"), false);
  assert.match(failResult.remedy ?? "", /pnpm rebuild better-sqlite3/);
});

test("formatTable marks failures with a remedy line and passes with just a detail line", () => {
  const table = formatTable([
    { name: "A", ok: true, detail: "fine", remedy: null },
    { name: "B", ok: false, detail: "broken", remedy: "fix it" },
  ]);
  assert.match(table, /✓ A: fine/);
  assert.match(table, /✗ B: broken/);
  assert.match(table, /remedy: fix it/);
  assert.equal(table.includes("remedy: fine"), false);
});
