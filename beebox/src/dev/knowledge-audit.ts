#!/usr/bin/env tsx
/**
 * Knowledge Audit CLI — run audits to verify agent knowledge, list them,
 * or evaluate results.
 *
 * Usage (via pnpm script):
 *   pnpm knowledge-audit run [--box <path>] [--filter <tag-or-id>]
 *   pnpm knowledge-audit run --dev [--model <id>] [--filter <tag-or-id>]
 *   pnpm knowledge-audit list [--tests <path>]
 *   pnpm knowledge-audit eval <report-path>
 */

import { Command, InvalidArgumentError } from "commander";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { loadTests, getTestsPath, runTest } from "./lib/test-runner/runner/run-test.js";
import { assertStandaloneBox, assertCleanAuditBox, auditBoxStatus, UnsafeAuditBoxError, formatUnsafeAuditBox } from "./lib/box-guard.js";
import { resolveAuditBox } from "./lib/audit-box.js";
import { generateReport } from "./lib/report.js";
import { automatedChecksPassed } from "./lib/audit-checks.js";
import { recordRun, loadHistory, type RunMeasurement } from "./lib/context-history.js";
import { generateDocs } from "../core/docs-gen/generate/core.js";
import { DEFAULT_DEV_AUDIT_MODEL, devRepoRoot, runDevTest } from "./lib/test-runner/dev-session.js";
import { PACKAGE_ROOT } from "../lib/package-root.js";
import type { AgentEngine } from "../core/box/config.js";
import type { AuditTest, TestResult } from "./lib/test-runner/runner/run-test.js";

const DEFAULT_TESTS_DIR = path.join(PACKAGE_ROOT, "src", "dev");
const DEFAULT_OUTPUT_DIR = path.join(DEFAULT_TESTS_DIR, "reports");
const HISTORY_PATH = path.join(DEFAULT_TESTS_DIR, "context-history.yaml");

class InvalidAuditEngineError extends InvalidArgumentError {
  constructor() {
    super("Expected claude or codex");
    this.name = "InvalidAuditEngineError";
  }
}

function parseEngine(value: string): AgentEngine {
  if (value === "claude" || value === "codex") return value;
  throw new InvalidAuditEngineError();
}

function describeRunTarget(boxRoot: string, engine: AgentEngine | undefined): string {
  return engine === undefined
    ? `${boxRoot} using its configured engine`
    : `${boxRoot} with ${engine}`;
}

function auditRunOptions(options: {
  test: AuditTest;
  boxRoot: string;
  engine: AgentEngine | undefined;
  cliSetupStatus?: string;
}) {
  const { test, boxRoot, engine, cliSetupStatus } = options;
  return {
    test,
    boxRoot,
    ...(engine !== undefined && { engine }),
    ...(cliSetupStatus !== undefined && { cliSetupStatus }),
  };
}

function reportEngine(results: Array<{ engine: AgentEngine }>, override: AgentEngine | undefined): string {
  return results[0]?.engine ?? override ?? "configured";
}

/** Context-history ledger key for dev-guidance audits (box runs key on the box name). */
const DEV_HISTORY_KEY = "dev-checkout";

function selectTests(tests: AuditTest[], options: { dev: boolean; filter: string | undefined }): AuditTest[] {
  const { dev, filter } = options;
  const onSurface = tests.filter((t) => (t.surface === "dev") === dev);
  if (filter === undefined) return onSurface;
  const matched = onSurface.filter((t) => t.id === filter || t.id.includes(filter) || t.tags?.includes(filter));
  if (matched.length === 0) {
    console.error(`No ${dev ? "dev" : "box"} audits match filter: ${filter}`);
    process.exit(1);
  }
  return matched;
}

function printAuditHeader(test: AuditTest): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Audit: ${test.id} (${test.expected_level})`);
  console.log(`Prompt: "${test.prompt}"`);
  console.log("=".repeat(60));
}

function printAuditSummary(result: TestResult): void {
  const status = automatedChecksPassed(result.checks) ? "\u2713" : "\u2717";
  const ctx = result.behavior.context;
  const ctxNote = ctx ? `, ${Math.round(ctx.initialTokens / 1000)}k ctx` : "";
  console.log(`\n${status} ${result.test.id} — ${result.behavior.filesRead.length} files read, ${result.behavior.searches.length} searches${ctxNote}`);
}

/**
 * Write the Markdown report and append context baselines to the ledger.
 * History is loaded before this run is appended so report deltas compare
 * against the prior run.
 */
async function writeRunOutputs(options: {
  target: string; historyKey: string; results: TestResult[]; output: string | undefined; label: string; targetCommit: string;
}): Promise<void> {
  const { target, historyKey, results, output, label, targetCommit } = options;
  const priorHistory = await loadHistory(HISTORY_PATH);
  const report = generateReport({ boxRoot: target, results, priorHistory: priorHistory[historyKey] ?? {} });
  const timestamp = new Date().toISOString().replace(/[.:]/g, "-").substring(0, 19);
  const outputPath = output ?? path.join(DEFAULT_OUTPUT_DIR, `audit-report-${label}-${timestamp}.md`);
  // reports/ is gitignored, so a fresh worktree checkout doesn't have it.
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, report, "utf-8");
  console.log(`\nReport written to: ${outputPath}`);
  const measurements: RunMeasurement[] = [];
  for (const r of results) {
    if (r.behavior.context) measurements.push({ auditId: r.test.id, stats: r.behavior.context });
  }
  if (measurements.length === 0) return;
  await recordRun({
    historyPath: HISTORY_PATH,
    box: historyKey,
    date: new Date().toISOString(),
    boxCommit: targetCommit,
    repoCommit: gitHead(PACKAGE_ROOT),
    measurements,
  });
  console.log(`Context history updated: ${HISTORY_PATH}`);
}

/** `run --dev`: audit what a headless Claude Code session in this checkout knows. */
async function runDevAudits(options: { tests: AuditTest[]; model: string; output: string | undefined }): Promise<void> {
  const repoRoot = devRepoRoot(PACKAGE_ROOT);
  console.log(`Running ${options.tests.length} dev-guidance audits in ${repoRoot} with ${options.model}\n`);
  const results: TestResult[] = [];
  for (const test of options.tests) {
    printAuditHeader(test);
    const result = await runDevTest({ test, repoRoot, model: options.model });
    results.push(result);
    printAuditSummary(result);
  }
  await writeRunOutputs({
    target: `dev checkout ${repoRoot}`,
    historyKey: DEV_HISTORY_KEY,
    results,
    output: options.output,
    label: "dev",
    targetCommit: gitHead(repoRoot),
  });
}

/** Short-circuiting git HEAD lookup; "unknown" if the dir isn't a repo. */
function gitHead(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf-8" }).trim();
  } catch (e) {
    console.debug(`git rev-parse HEAD failed in ${cwd}:`, e);
    return "unknown";
  }
}

const program = new Command()
  .name("audit")
  .description("Knowledge Audit — verify agent knowledge");

program
  .command("list")
  .description("List available audits")
  .option("--tests <path>", "Path to audits.yaml")
  .action(async (options: { tests?: string }) => {
    const testsPath = options.tests ?? getTestsPath(DEFAULT_TESTS_DIR);
    const suite = await loadTests(testsPath);

    console.log(`Audits in ${testsPath}:\n`);
    for (const test of suite.tests) {
      const tags = test.tags ? ` [${test.tags.join(", ")}]` : "";
      const surface = test.surface === "dev" ? " (dev)" : "";
      console.log(`  ${test.id}${surface} — ${test.expected_level}${tags}`);
      console.log(`    "${test.prompt}"`);
    }
    console.log(`\nTotal: ${suite.tests.length} audits`);
  });

program
  .command("run")
  .description("Run knowledge audits against a box, or with --dev in this checkout")
  .option("--box <path>", "Box root directory")
  .option("--dev", "Run the surface: dev audits as headless Claude Code sessions in this checkout")
  .option("--model <id>", `Model for --dev sessions (default ${DEFAULT_DEV_AUDIT_MODEL})`)
  .option("--tests <path>", "Path to audits.yaml")
  .option("--filter <id-or-tag>", "Filter by audit ID or tag")
  .option("--engine <engine>", "Override the box engine: claude or codex", parseEngine)
  .option("--output <path>", "Output report path")
  .action(async (options: {
    box?: string; tests?: string; filter?: string; output?: string; engine?: AgentEngine; dev?: boolean; model?: string;
  }) => {
    const testsPath = options.tests ?? getTestsPath(DEFAULT_TESTS_DIR);
    const dev = options.dev === true;
    if (dev && (options.box !== undefined || options.engine !== undefined)) {
      console.error("--dev runs in this checkout with Claude; it takes no --box or --engine");
      process.exit(1);
    }
    if (!dev && options.model !== undefined) {
      console.error("--model applies only to --dev; a box run uses the box's engine and model");
      process.exit(1);
    }
    if (dev) {
      const suite = await loadTests(testsPath);
      const tests = selectTests(suite.tests, { dev, filter: options.filter });
      await runDevAudits({ tests, model: options.model ?? DEFAULT_DEV_AUDIT_MODEL, output: options.output });
      return;
    }
    const boxRoot = options.box ?? path.join(process.env.HOME ?? "~", "src/boxes/test1");
    const engine = options.engine;

    // `--box` names a path at or below the box's one root; resolve to that
    // root (where `.beebox/box.json`, cards, and AGENTS.md live) so
    // generateDocs/runTest target the box itself, and derive a stable ledger
    // identity. See resolveAuditBox. assertStandaloneBox verifies the git
    // repo is that same root.
    const { operationalRoot: resolvedBox, boxName } = await resolveAuditBox(boxRoot);

    // Refuse a box that isn't its own git repo BEFORE generating docs into it.
    // runTest does `git reset --hard` + `git clean -fd` in the box between
    // tests; a box nested in another repo (e.g. `--box test1` → a dir inside
    // the monorepo) would have those hit the enclosing repo and discard
    // uncommitted work. Fail with guidance instead.
    try {
      await assertStandaloneBox(resolvedBox);
      assertCleanAuditBox(resolvedBox);
    } catch (e) {
      if (e instanceof UnsafeAuditBoxError) {
        console.error(formatUnsafeAuditBox(e));
        process.exit(1);
      }
      throw e;
    }

    const suite = await loadTests(testsPath);
    const tests = selectTests(suite.tests, { dev, filter: options.filter });

    // Capture the box's HEAD *before* regenerating docs. generateDocs makes a
    // deterministic template-sync commit, so the post-regen HEAD churns every
    // run; the pre-regen HEAD is the stable key that moves only when the box
    // itself meaningfully changes (e.g. an AGENTS.md trim). Paired with
    // repoCommit it still pins the exact audited context.
    const boxCommit = gitHead(resolvedBox);

    // Always regenerate docs before running audits. The fast-path cache in
    // generateDocs keys off git commits, so uncommitted source edits would
    // otherwise leave stale generated docs in the box and silently invalidate
    // results — exactly the scenario where the agent answers from a doc that
    // doesn't match current source. Force is cheap; staleness is expensive.
    console.log(`Regenerating docs in ${resolvedBox}...`);
    await generateDocs(resolvedBox, { force: true });
    // generateDocs may leave generated guidance as untracked output. Only the
    // first runTest may accept this exact setup status; later tests must see
    // the clean state restored by the runner's finalizer.
    const cliSetupStatus = auditBoxStatus(resolvedBox);

    console.log(`Running ${tests.length} knowledge audits against ${describeRunTarget(resolvedBox, engine)}\n`);

    const results: TestResult[] = [];
    for (const test of tests) {
      printAuditHeader(test);
      const result = await runTest(auditRunOptions({
        test,
        boxRoot: resolvedBox,
        engine,
        ...(results.length === 0 && cliSetupStatus && { cliSetupStatus }),
      }));
      results.push(result);
      printAuditSummary(result);
    }

    // The box is reset between tests, so its HEAD is stable across the run.
    await writeRunOutputs({
      target: resolvedBox,
      historyKey: boxName,
      results,
      output: options.output,
      label: reportEngine(results, engine),
      targetCommit: boxCommit,
    });
  });

program
  .command("eval <report>")
  .description("Open a report for evaluation (prints to stdout)")
  .action(async (reportPath: string) => {
    const content = await fs.readFile(path.resolve(reportPath), "utf-8");
    console.log(content);
  });

program.parse();
