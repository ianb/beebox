/**
 * The box-surface audit loop: fresh generated guidance before every audit.
 *
 * `runTest` resets and cleans the box after each audit, and that removes
 * generated guidance the docs commit leaves untracked (a legacy box's root
 * `CLAUDE.md`, for example). So each audit regenerates docs first and accepts
 * only the status its own generation produced. The caller still refuses a
 * box that is dirty before the run (`assertCleanAuditBox`).
 */

import { generateDocs } from "../../../core/docs-gen/generate/core.js";
import type { AgentEngine } from "../../../core/box/config.js";
import { execSync } from "node:child_process";
import { activateAuditPlugins, assertAuditPluginsReady, resetAuditBoxCaches } from "./plugins.js";
import { assertCleanAuditBox, assertStandaloneBox, auditBoxStatus } from "../box-guard.js";
import { runTest, type AuditTest, type TestResult } from "../test-runner/runner/run-test.js";

export interface BoxAuditRunOptions {
  tests: AuditTest[];
  boxRoot: string;
  engine: AgentEngine | undefined;
  onTestStart?: (test: AuditTest) => void;
  onTestDone?: (result: TestResult) => void;
}

export async function runBoxAudits(options: BoxAuditRunOptions): Promise<TestResult[]> {
  const { tests, boxRoot, engine, onTestStart, onTestDone } = options;
  const results: TestResult[] = [];
  // Audit setup writes into the box before runTest's own guard runs.
  await assertStandaloneBox(boxRoot);
  for (const test of tests) {
    // The previous audit's cleanup must have restored a clean tree; this
    // audit's setup status may then contain only its own generation output.
    assertCleanAuditBox(boxRoot);
    onTestStart?.(test);
    const headBefore = execSync("git rev-parse HEAD", { cwd: boxRoot, encoding: "utf-8" }).trim();
    try {
      // Activation stays uncommitted: it is part of this audit's setup status.
      if (test.plugins) await activateAuditPlugins(boxRoot, test.plugins);
      // Force: the generateDocs cache keys off git commits, so uncommitted
      // engine source edits would otherwise leave stale docs in the box.
      await generateDocs(boxRoot, { force: true });
      if (test.plugins) await assertAuditPluginsReady(boxRoot, test.plugins);
      const setupStatus = auditBoxStatus(boxRoot);
      const result = await runTest({
        test,
        boxRoot,
        ...(engine !== undefined && { engine }),
        ...(setupStatus !== "" && { cliSetupStatus: setupStatus }),
      });
      results.push(result);
      onTestDone?.(result);
    } finally {
      if (test.plugins) {
        execSync(`git reset --hard ${headBefore}`, { cwd: boxRoot, encoding: "utf-8" });
        execSync("git clean -fd", { cwd: boxRoot, encoding: "utf-8" });
        resetAuditBoxCaches(boxRoot);
      }
    }
  }
  return results;
}
