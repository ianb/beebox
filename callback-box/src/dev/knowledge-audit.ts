#!/usr/bin/env tsx
/**
 * Knowledge Audit CLI — run audits to verify agent knowledge, list them,
 * or evaluate results.
 *
 * Usage (via pnpm script):
 *   pnpm knowledge-audit run [--box <path>] [--filter <tag-or-id>]
 *   pnpm knowledge-audit list [--tests <path>]
 *   pnpm knowledge-audit eval <report-path>
 */

import { Command } from "commander";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { loadTests, getTestsPath, runTest } from "./lib/test-runner.js";
import { assertStandaloneBox, UnsafeAuditBoxError, formatUnsafeAuditBox } from "./lib/box-guard.js";
import { generateReport } from "./lib/report.js";
import { recordRun, loadHistory, type RunMeasurement } from "./lib/context-history.js";
import { generateDocs } from "../core/generate-docs.js";
import { PACKAGE_ROOT } from "../lib/package-root.js";

const DEFAULT_TESTS_DIR = path.join(PACKAGE_ROOT, "src", "dev");
const DEFAULT_OUTPUT_DIR = path.join(DEFAULT_TESTS_DIR, "reports");
const HISTORY_PATH = path.join(DEFAULT_TESTS_DIR, "context-history.yaml");

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
      console.log(`  ${test.id} — ${test.expected_level}${tags}`);
      console.log(`    "${test.prompt}"`);
    }
    console.log(`\nTotal: ${suite.tests.length} audits`);
  });

program
  .command("run")
  .description("Run knowledge audits against a box")
  .option("--box <path>", "Box root directory")
  .option("--tests <path>", "Path to audits.yaml")
  .option("--filter <id-or-tag>", "Filter by audit ID or tag")
  .option("--output <path>", "Output report path")
  .action(async (options: { box?: string; tests?: string; filter?: string; output?: string }) => {
    const testsPath = options.tests ?? getTestsPath(DEFAULT_TESTS_DIR);
    const boxRoot = options.box ?? path.join(process.env.HOME ?? "~", "src/boxes/test1");

    const resolvedBox = path.resolve(boxRoot);

    // Refuse a box that isn't its own git repo BEFORE generating docs into it.
    // runTest does `git reset --hard` + `git clean -fd` in the box between
    // tests; a box nested in another repo (e.g. `--box test1` → a dir inside
    // the monorepo) would have those hit the enclosing repo and discard
    // uncommitted work. Fail with guidance instead.
    try {
      assertStandaloneBox(resolvedBox);
    } catch (e) {
      if (e instanceof UnsafeAuditBoxError) {
        console.error(formatUnsafeAuditBox(e));
        process.exit(1);
      }
      throw e;
    }

    const suite = await loadTests(testsPath);

    // Filter audits if requested
    let tests = suite.tests;
    if (options.filter) {
      const filter = options.filter;
      tests = tests.filter(
        (t) => t.id === filter || t.id.includes(filter) || t.tags?.includes(filter),
      );
      if (tests.length === 0) {
        console.error(`No audits match filter: ${filter}`);
        process.exit(1);
      }
    }

    // Capture the box's HEAD *before* regenerating docs. generateDocs makes a
    // deterministic template-sync commit, so the post-regen HEAD churns every
    // run; the pre-regen HEAD is the stable key that moves only when the box
    // itself meaningfully changes (e.g. a CLAUDE.md trim). Paired with
    // repoCommit it still pins the exact audited context.
    const boxCommit = gitHead(resolvedBox);

    // Always regenerate docs before running audits. The fast-path cache in
    // generateDocs keys off git commits, so uncommitted source edits would
    // otherwise leave stale generated docs in the box and silently invalidate
    // results — exactly the scenario where the agent answers from a doc that
    // doesn't match current source. Force is cheap; staleness is expensive.
    console.log(`Regenerating docs in ${resolvedBox}...`);
    await generateDocs(resolvedBox, { force: true });

    console.log(`Running ${tests.length} knowledge audits against ${resolvedBox}\n`);

    const results = [];
    for (const test of tests) {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`Audit: ${test.id} (${test.expected_level})`);
      console.log(`Prompt: "${test.prompt}"`);
      console.log("=".repeat(60));

      const result = await runTest({ test, boxRoot: resolvedBox });
      results.push(result);

      // Print quick summary
      const passedContains = result.checks.containsChecks.every((c) => c.found);
      const passedNotContains = result.checks.notContainsChecks.every((c) => !c.found);
      const passedAny = result.checks.containsAnyCheck ? result.checks.containsAnyCheck.found : true;
      const passedCards = result.checks.cardsContainChecks.every((c) => c.found);
      const passedReads = result.checks.shouldReadChecks.every((c) => c.wasRead);
      const passedBash = result.checks.bashContainsChecks.every((c) => c.found);
      const status = passedContains && passedNotContains && passedAny && passedCards && passedReads && passedBash ? "\u2713" : "\u2717";
      const ctx = result.behavior.context;
      const ctxNote = ctx ? `, ${Math.round(ctx.initialTokens / 1000)}k ctx` : "";
      console.log(`\n${status} ${test.id} — ${result.behavior.filesRead.length} files read, ${result.behavior.searches.length} searches${ctxNote}`);
    }

    // Generate and write report. Load the history *before* this run is
    // appended below, so the report's deltas compare against the prior run.
    const priorHistory = await loadHistory(HISTORY_PATH);
    const report = generateReport({
      boxRoot: resolvedBox,
      results,
      priorHistory: priorHistory[path.basename(resolvedBox)] ?? {},
    });
    const timestamp = new Date().toISOString().replace(/[.:]/g, "-").substring(0, 19);
    const outputPath = options.output ?? path.join(DEFAULT_OUTPUT_DIR, `audit-report-${timestamp}.md`);

    await fs.writeFile(outputPath, report, "utf-8");
    console.log(`\nReport written to: ${outputPath}`);

    // Append context-size baselines to the committed history ledger. The box
    // is reset between tests, so its HEAD is stable across the run.
    const measurements: RunMeasurement[] = [];
    for (const r of results) {
      if (r.behavior.context) measurements.push({ auditId: r.test.id, stats: r.behavior.context });
    }
    if (measurements.length > 0) {
      await recordRun({
        historyPath: HISTORY_PATH,
        box: path.basename(resolvedBox),
        date: new Date().toISOString(),
        boxCommit,
        repoCommit: gitHead(PACKAGE_ROOT),
        measurements,
      });
      console.log(`Context history updated: ${HISTORY_PATH}`);
    }
  });

program
  .command("eval <report>")
  .description("Open a report for evaluation (prints to stdout)")
  .action(async (reportPath: string) => {
    const content = await fs.readFile(path.resolve(reportPath), "utf-8");
    console.log(content);
  });

program.parse();
