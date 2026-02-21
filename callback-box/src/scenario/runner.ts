/**
 * Scenario execution engine.
 *
 * Runs a scenario step-by-step: creates an isolated branch,
 * executes commands, validates outcomes, and returns to main.
 */

import { runShell } from "../core/workflow/shell.js";
import { runAgent } from "../core/agent.js";
import {
  getStatus,
  createBranch,
  checkoutBranch,
  createTag,
  commit,
  stageAll,
  getCurrentBranch,
} from "../cli/lib/git.js";
import { loadFetchStubs, clearFetchStubs, type FetchStub } from "../cli/lib/fetch.js";
import { loadScenario, loadStubs, getScenarioDir, getBoxRoot } from "./loader.js";
import type { ScenarioStep, ValidationCheck } from "./types.js";

export interface RunScenarioOptions {
  name: string;
  from?: string | undefined;
  dryRun?: boolean | undefined;
  onLog?: ((text: string) => void) | undefined;
}

export interface ValidationResult {
  type: "committed" | "script" | "prompt";
  passed: boolean;
  output?: string;
}

export interface StepResult {
  name: string;
  status: "passed" | "failed" | "skipped";
  validations: ValidationResult[];
}

export interface ScenarioResult {
  scenario: string;
  branch: string;
  steps: StepResult[];
  passed: boolean;
}

const VALIDATION_SYSTEM_PROMPT = `You are a test validator. You will be given a description of what to check and the current state of a box (a file-based workspace).

Examine the box contents and determine whether the described condition is met.

Your response MUST start with either PASS or FAIL on the first line, followed by a brief explanation.`;

function log(options: RunScenarioOptions, text: string): void {
  options.onLog?.(text);
}

interface RunValidationParams {
  check: ValidationCheck;
  boxRoot: string;
  options: RunScenarioOptions;
}

async function runValidation(params: RunValidationParams): Promise<ValidationResult> {
  const { check, boxRoot, options } = params;

  if ("committed" in check) {
    const status = await getStatus(boxRoot);
    return {
      type: "committed",
      passed: status.clean,
      output: status.clean
        ? "Working tree is clean"
        : `Dirty files: ${[...status.staged, ...status.modified, ...status.untracked].join(", ")}`,
    };
  }

  if ("script" in check) {
    const result = await runShell(boxRoot, check.script);
    return {
      type: "script",
      passed: result.exitCode === 0,
      output: result.stdout || result.stderr || `Exit code: ${result.exitCode}`,
    };
  }

  if ("prompt" in check) {
    if (options.dryRun) {
      return {
        type: "prompt",
        passed: true,
        output: "[dry-run] Would run agent validation",
      };
    }

    const result = await runAgent({
      boxRoot,
      systemPrompt: VALIDATION_SYSTEM_PROMPT,
      prompt: check.prompt,
      maxTurns: 5,
      maxCost: 0.5,
    });

    const firstLine = result.output.split("\n")[0]?.trim().toUpperCase() ?? "";
    const passed = firstLine.startsWith("PASS");
    return {
      type: "prompt",
      passed,
      output: result.output,
    };
  }

  return { type: "script", passed: false, output: "Unknown validation type" };
}

interface RunStepParams {
  step: ScenarioStep;
  boxRoot: string;
  options: RunScenarioOptions;
}

async function runStep(params: RunStepParams): Promise<StepResult> {
  const { step, boxRoot, options } = params;

  log(options, `\n--- Step: ${step.name} ---`);
  log(options, `  Run: ${step.run}`);

  if (options.dryRun) {
    log(options, "  [dry-run] Skipping execution");
    const validations: ValidationResult[] = (step.validate ?? []).map((v) => {
      if ("committed" in v) return { type: "committed" as const, passed: true, output: "[dry-run]" };
      if ("script" in v) return { type: "script" as const, passed: true, output: "[dry-run]" };
      return { type: "prompt" as const, passed: true, output: "[dry-run]" };
    });
    return { name: step.name, status: "passed", validations };
  }

  // Execute the step command
  const shellResult = await runShell(boxRoot, step.run);
  if (shellResult.stdout) log(options, `  stdout: ${shellResult.stdout}`);
  if (shellResult.stderr) log(options, `  stderr: ${shellResult.stderr}`);

  if (shellResult.exitCode !== 0) {
    log(options, `  FAILED (exit code ${shellResult.exitCode})`);
    return {
      name: step.name,
      status: "failed",
      validations: [{
        type: "script",
        passed: false,
        output: `Command failed with exit code ${shellResult.exitCode}: ${shellResult.stderr || shellResult.stdout}`,
      }],
    };
  }

  // Run validations
  const validations: ValidationResult[] = [];
  for (const check of step.validate ?? []) {
    const result = await runValidation({ check, boxRoot, options });
    validations.push(result);
    const label = result.type === "committed" ? "committed" : result.type === "script" ? "script" : "prompt";
    log(options, `  Validate (${label}): ${result.passed ? "PASS" : "FAIL"}`);
    if (!result.passed) {
      log(options, `    ${result.output}`);
      return { name: step.name, status: "failed", validations };
    }
  }

  // Create checkpoint tag if specified
  if (step.checkpoint) {
    const tagName = `scenario/${options.name}/${step.checkpoint}`;
    await createTag(boxRoot, tagName);
    log(options, `  Checkpoint: ${tagName}`);
  }

  return { name: step.name, status: "passed", validations };
}

export async function runScenario(options: RunScenarioOptions): Promise<ScenarioResult> {
  const { name } = options;
  const scenarioDir = getScenarioDir(name);
  const boxRoot = getBoxRoot(name);

  log(options, `Scenario: ${name}`);
  log(options, `Box: ${boxRoot}`);

  // Load scenario and stubs
  const scenario = await loadScenario(name);
  const stubs = await loadStubs(name);

  // Pre-flight checks
  const currentBranch = await getCurrentBranch(boxRoot);
  if (currentBranch !== "main") {
    throw new Error(`Box must be on 'main' branch (currently on '${currentBranch}')`);
  }

  const status = await getStatus(boxRoot);
  if (!status.clean) {
    throw new Error("Box has uncommitted changes — commit or stash before running a scenario");
  }

  // Create test branch
  const timestamp = new Date().toISOString().replace(/[.:]/g, "-").slice(0, 19);
  const branchName = `test/${name}/${timestamp}`;
  log(options, `Branch: ${branchName}`);

  if (!options.dryRun) {
    await createBranch(boxRoot, branchName);

    // Initial marker commit
    await stageAll(boxRoot);
    await commit(boxRoot, {
      message: `Scenario start: ${name}`,
      trailers: { "Scenario": name },
    }).catch(() => {
      // OK if nothing to commit
    });
  }

  // Load stubs
  if (stubs?.time) {
    process.env.CB_TIME = stubs.time;
    log(options, `Stub time: ${stubs.time}`);
  }

  if (stubs?.http && stubs.http.length > 0) {
    const fetchStubs: FetchStub[] = stubs.http.map((h) => ({
      pattern: h.pattern,
      responseFile: h.response_file,
      status: h.status,
      contentType: h.content_type,
    }));
    loadFetchStubs(scenarioDir, fetchStubs);
    log(options, `Stub HTTP: ${stubs.http.length} pattern(s)`);
  }

  // Determine starting step (--from checkpoint support)
  let startIndex = 0;
  if (options.from) {
    const idx = scenario.steps.findIndex((s) => s.checkpoint === options.from);
    if (idx === -1) {
      throw new Error(`Checkpoint '${options.from}' not found in scenario steps`);
    }
    startIndex = idx + 1; // Start after the checkpoint step
    log(options, `Starting from checkpoint: ${options.from} (step ${startIndex + 1})`);
  }

  // Run steps
  const stepResults: StepResult[] = [];
  let failed = false;

  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i]!;

    if (i < startIndex) {
      stepResults.push({ name: step.name, status: "skipped", validations: [] });
      continue;
    }

    if (failed) {
      stepResults.push({ name: step.name, status: "skipped", validations: [] });
      continue;
    }

    const result = await runStep({ step, boxRoot, options });
    stepResults.push(result);

    if (result.status === "failed") {
      failed = true;
    }
  }

  // Cleanup
  clearFetchStubs();
  delete process.env.CB_TIME;

  if (!options.dryRun) {
    await checkoutBranch(boxRoot, "main");
  }

  const passed = stepResults.every((s) => s.status !== "failed");

  // Summary
  log(options, `\n=== ${passed ? "PASSED" : "FAILED"} ===`);
  for (const step of stepResults) {
    const icon = step.status === "passed" ? "+" : step.status === "failed" ? "x" : "-";
    log(options, `  [${icon}] ${step.name}`);
  }

  return {
    scenario: name,
    branch: options.dryRun ? "(dry-run)" : branchName,
    steps: stepResults,
    passed,
  };
}
