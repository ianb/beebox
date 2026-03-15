#!/usr/bin/env tsx
/**
 * Knowledge Audit CLI — run audits to verify agent knowledge, list them,
 * or evaluate results.
 *
 * Usage (via npm script):
 *   npm run knowledge-audit -- run [--box <path>] [--filter <tag-or-id>]
 *   npm run knowledge-audit -- list [--tests <path>]
 *   npm run knowledge-audit -- eval <report-path>
 */

import { Command } from "commander";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadTests, getTestsPath, runTest } from "./lib/test-runner.js";
import { generateReport } from "./lib/report.js";

const DEFAULT_TESTS_DIR = path.dirname(new URL(import.meta.url).pathname);
const DEFAULT_OUTPUT_DIR = path.join(DEFAULT_TESTS_DIR, "reports");

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
      const passedCards = result.checks.cardsContainChecks.every((c) => c.found);
      const passedReads = result.checks.shouldReadChecks.every((c) => c.wasRead);
      const status = passedContains && passedCards && passedReads ? "\u2713" : "\u2717";
      console.log(`\n${status} ${test.id} — ${result.behavior.filesRead.length} files read, ${result.behavior.searches.length} searches`);
    }

    // Generate and write report
    const report = generateReport({ boxRoot: resolvedBox, results });
    const timestamp = new Date().toISOString().replace(/[.:]/g, "-").substring(0, 19);
    const outputPath = options.output ?? path.join(DEFAULT_OUTPUT_DIR, `audit-report-${timestamp}.md`);

    await fs.writeFile(outputPath, report, "utf-8");
    console.log(`\nReport written to: ${outputPath}`);
  });

program
  .command("eval <report>")
  .description("Open a report for evaluation (prints to stdout)")
  .action(async (reportPath: string) => {
    const content = await fs.readFile(path.resolve(reportPath), "utf-8");
    console.log(content);
  });

program.parse();
