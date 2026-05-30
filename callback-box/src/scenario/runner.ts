/**
 * Scenario execution engine.
 *
 * Runs a scenario step-by-step: creates an isolated branch,
 * executes commands, validates outcomes, and returns to main.
 */

import * as path from "node:path";
import { PACKAGE_ROOT } from "../lib/package-root.js";
import { runShell } from "../core/procedure/shell.js";
import { createAgent } from "../core/agent.js";
import {
  getStatus,
  createBranch,
  checkoutBranch,
  createTag,
  deleteTag,
  commit,
  stageAll,
  getCurrentBranch,
  clean,
} from "../cli/lib/git.js";
import { loadFetchStubs, clearFetchStubs, installStrictFetch, uninstallStrictFetch, type FetchStub } from "../cli/lib/fetch.js";
import { loadScenario, loadStubs, getScenarioDir, getBoxRoot } from "./loader.js";
import type { ScenarioStep, ValidationCheck } from "./types.js";

class WrongBranchError extends Error {
  constructor(currentBranch: string) {
    super(`Box must be on 'main' branch (currently on '${currentBranch}')`);
    this.name = "WrongBranchError";
  }
}

class UncommittedChangesError extends Error {
  constructor() {
    super("Box has uncommitted changes — commit or stash before running a scenario");
    this.name = "UncommittedChangesError";
  }
}

class CheckpointNotFoundError extends Error {
  constructor(checkpoint: string) {
    super(`Checkpoint '${checkpoint}' not found in scenario steps`);
    this.name = "CheckpointNotFoundError";
  }
}

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

    const agent = createAgent({ name: "scenario-validator" });
    const result = await agent.invoke({
      boxRoot,
      systemPrompt: VALIDATION_SYSTEM_PROMPT,
      prompt: check.prompt,
      maxTurns: 5,
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

  // Create checkpoint tag if specified (force-replace if it exists from a previous run)
  if (step.checkpoint) {
    const tagName = `scenario/${options.name}/${step.checkpoint}`;
    await deleteTag(boxRoot, tagName).catch(() => {});
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

  // Pre-flight: clean gitignored files from previous runs (e.g. rss-state.json)
  await clean(boxRoot, { gitignored: true, directories: true });

  // Pre-flight checks
  const currentBranch = await getCurrentBranch(boxRoot);
  if (currentBranch !== "main") {
    throw new WrongBranchError(currentBranch);
  }

  const status = await getStatus(boxRoot);
  if (!status.clean) {
    throw new UncommittedChangesError();
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

  // Load stubs — set env vars so child processes (cb wakeup, cb reactor) inherit them
  if (stubs?.time) {
    process.env.CB_TIME = stubs.time;
    process.env.CB_SCENARIO_START_TIME = stubs.time;
    log(options, `Stub time: ${stubs.time}`);
  }

  if (stubs?.http && stubs.http.length > 0) {
    const fetchStubs: FetchStub[] = stubs.http.map((h) => ({
      pattern: h.pattern,
      responseFile: h.response_file,
      ...(h.status != null && { status: h.status }),
      ...(h.content_type && { contentType: h.content_type }),
      ...(h.after && { after: h.after }),
    }));
    loadFetchStubs(scenarioDir, fetchStubs);
    // Also set env var so child processes load stubs from the file
    const stubsFilePath = path.join(scenarioDir, "stubs.yaml");
    process.env.CB_STUBS_FILE = stubsFilePath;
    log(options, `Stub HTTP: ${stubs.http.length} pattern(s)`);
  }

  // Ensure cb CLI is on PATH — use this repo's own bin/ directory
  const binDir = path.join(PACKAGE_ROOT, "bin");
  process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;

  // Install strict fetch — all fetch() calls must match a stub or throw
  process.env.CB_STRICT_FETCH = "1";
  installStrictFetch();

  // Determine starting step (--from checkpoint support)
  let startIndex = 0;
  if (options.from) {
    const idx = scenario.steps.findIndex((s) => s.checkpoint === options.from);
    if (idx === -1) {
      throw new CheckpointNotFoundError(options.from);
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

    // Update CB_TIME if the step specifies its own time
    if (step.time) {
      process.env.CB_TIME = step.time;
      log(options, `  Time: ${step.time}`);
    }

    const result = await runStep({ step, boxRoot, options });
    stepResults.push(result);

    if (result.status === "failed") {
      failed = true;
    }
  }

  // Cleanup
  clearFetchStubs();
  uninstallStrictFetch();
  delete process.env.CB_TIME;
  delete process.env.CB_STUBS_FILE;
  delete process.env.CB_STRICT_FETCH;
  delete process.env.CB_SCENARIO_START_TIME;

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
