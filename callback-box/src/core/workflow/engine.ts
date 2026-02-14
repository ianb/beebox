/**
 * Workflow engine — executes workflow definitions step by step.
 *
 * Loads a workflow definition card, creates a run directory with a run card,
 * executes steps sequentially, records results, and maintains git-clean state
 * between steps.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createElement, serialize, parseXml, type ElementNode } from "cardworks";
import { runAgent, type AgentOptions } from "../agent.js";
import {
  getStatus,
  stageAll,
  commit,
} from "../../cli/lib/git.js";
import { fmt } from "../../cli/lib/format.js";
import { dedent } from "./dedent.js";
import { runShell, CHECK_SKIP_CODE } from "./shell.js";
import type { CommandContext, CommandResult } from "../command-runner.js";

/** Maps friendly model names to full model IDs */
const MODEL_MAP: Record<string, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-5-20250929",
  opus: "claude-opus-4-6",
};

export interface WorkflowOptions {
  dryRun?: boolean;
  force?: boolean;
  /** Run only this step (by id), skip all others */
  step?: string;
}

// ─── Types for parsed workflow definitions ───────────────────────────

interface ParsedPhase {
  shells: string[];
  agents: Array<{ prompt: string; model?: string; maxTurns?: number }>;
  instructions: string[];
  whys: string[];
}

interface ParsedStep {
  id: string;
  description: string;
  precheck?: ParsedPhase & { passOutput?: boolean };
  run?: ParsedPhase;
  validate?: { phase: ParsedPhase; severity: string };
}

interface ParsedWorkflow {
  name: string;
  description: string;
  steps: ParsedStep[];
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Parameters for startWorkflow
 */
export interface StartWorkflowParams {
  ctx: CommandContext;
  workflowNameOrPath: string;
  options?: WorkflowOptions;
}

/**
 * Start a new workflow run.
 */
export async function startWorkflow(
  params: StartWorkflowParams
): Promise<CommandResult> {
  const { ctx, workflowNameOrPath, options = {} } = params;
  const { boxRoot } = ctx;

  // Resolve workflow definition: accept a path or a bare name
  let workflowCardPath: string;
  if (
    workflowNameOrPath.endsWith(".workflow.card") ||
    workflowNameOrPath.includes("/")
  ) {
    // Treat as a path (absolute or relative to boxRoot)
    workflowCardPath = path.isAbsolute(workflowNameOrPath)
      ? workflowNameOrPath
      : path.join(boxRoot, workflowNameOrPath);
  } else {
    // Bare name → config/workflows/<name>.workflow.card
    workflowCardPath = path.join(
      boxRoot,
      "config/workflows",
      `${workflowNameOrPath}.workflow.card`
    );
  }

  try {
    await fs.access(workflowCardPath);
  } catch {
    return {
      success: false,
      error: `Workflow definition not found: ${workflowCardPath}`,
    };
  }

  // Parse workflow definition
  const workflow = await loadWorkflowDefinition(workflowCardPath);
  const workflowName = workflow.name;

  if (options.dryRun) {
    ctx.writeLine(fmt.header(`Workflow: ${workflow.name}`));
    ctx.writeLine(fmt.dim(workflow.description));
    ctx.writeLine("");
    for (const step of workflow.steps) {
      const hasPrecheck = step.precheck !== undefined;
      const hasValidate = step.validate !== undefined;
      const runType = step.run?.agents.length
        ? "agent"
        : step.run?.shells.length
          ? "shell"
          : "none";
      ctx.writeLine(
        `  ${fmt.strong(step.id)}: ${step.description} ${fmt.dim(`[${runType}${hasPrecheck ? ", precheck" : ""}${hasValidate ? ", validate" : ""}]`)}`
      );
    }
    return { success: true };
  }

  // Validate --step if provided
  if (options.step) {
    const found = workflow.steps.find((s) => s.id === options.step);
    if (!found) {
      const validIds = workflow.steps.map((s) => s.id).join(", ");
      return {
        success: false,
        error: `Unknown step "${options.step}". Available steps: ${validIds}`,
      };
    }
  }

  // Create run directory
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "")
    .replace("T", "T")
    .slice(0, 15);
  const runDirName = `${workflowName}_${timestamp}`;
  const runDir = path.join(boxRoot, "workflow/runs", runDirName);
  await fs.mkdir(runDir, { recursive: true });

  const runCardPath = path.join(runDir, "run.workflow-run.card");

  // Generate initial run card
  const now = new Date().toISOString();
  const relWorkflowPath = path.relative(boxRoot, workflowCardPath);
  const initialRunCard = buildInitialRunCard({ workflow, workflowPath: relWorkflowPath, startedAt: now });
  await fs.writeFile(runCardPath, initialRunCard);

  // Commit start
  await stageAll(boxRoot);
  await commit(boxRoot, {
    message: `Start workflow: ${workflowName}`,
    trailers: { Workflow: workflowName },
  });

  ctx.writeLine(fmt.header(`Starting workflow: ${workflow.name}`));
  ctx.writeLine(fmt.dim(`Run: ${path.relative(boxRoot, runDir)}`));
  ctx.writeLine("");

  // Execute steps (optionally filtered to a single step)
  const stepsToRun = options.step
    ? workflow.steps.filter((s) => s.id === options.step)
    : workflow.steps;
  let allSucceeded = true;
  for (const step of stepsToRun) {
    const result = await executeStep({
      ctx,
      boxRoot,
      step,
      workflow,
      workflowCardPath,
      runCardPath,
      relWorkflowPath,
    });

    if (result === "failed") {
      allSucceeded = false;
      break;
    }
  }

  // Final run card update
  const completedAt = new Date().toISOString();
  await updateRunCardStatus({
    runCardPath,
    status: allSucceeded ? "completed" : "failed",
    completedAt,
  });
  await stageAll(boxRoot);
  await commit(boxRoot, {
    message: `${allSucceeded ? "Complete" : "Failed"} workflow: ${workflowName}`,
    trailers: { Workflow: workflowName },
  });

  if (allSucceeded) {
    ctx.writeLine(fmt.ok(`Workflow completed: ${workflowName}`));
  } else {
    ctx.writeLine(fmt.fail(`Workflow failed: ${workflowName}`));
  }

  return { success: allSucceeded };
}

/**
 * List available workflow definitions.
 */
export async function listWorkflows(
  ctx: CommandContext
): Promise<CommandResult> {
  const workflowDir = path.join(ctx.boxRoot, "config/workflows");

  try {
    const files = await fs.readdir(workflowDir);
    const cards = files.filter((f) => f.endsWith(".workflow.card"));

    if (cards.length === 0) {
      ctx.writeLine(fmt.dim("No workflow definitions found."));
      return { success: true, data: [] };
    }

    for (const card of cards) {
      const name = card.replace(".workflow.card", "");
      ctx.writeLine(`  ${fmt.strong(name)} ${fmt.dim(card)}`);
    }

    return { success: true, data: cards };
  } catch {
    ctx.writeLine(fmt.dim("No config/workflows/ directory."));
    return { success: true, data: [] };
  }
}

/**
 * Show status of a workflow run.
 */
export async function workflowStatus(
  ctx: CommandContext,
  runDir?: string
): Promise<CommandResult> {
  const { boxRoot } = ctx;

  // If no run dir specified, find the latest
  if (!runDir) {
    const runsDir = path.join(boxRoot, "workflow/runs");
    try {
      const dirs = await fs.readdir(runsDir);
      const sorted = dirs.sort().reverse();
      if (sorted.length === 0) {
        ctx.writeLine(fmt.dim("No workflow runs found."));
        return { success: true };
      }
      runDir = path.join(runsDir, sorted[0]!);
    } catch {
      ctx.writeLine(fmt.dim("No workflow/runs/ directory."));
      return { success: true };
    }
  }

  const runCardPath = path.join(
    runDir.startsWith("/") ? runDir : path.join(boxRoot, runDir),
    "run.workflow-run.card"
  );

  try {
    const content = await fs.readFile(runCardPath, "utf-8");
    const element = await parseXml(content, runCardPath);

    ctx.writeLine(
      fmt.header(`Workflow Run: ${element.attrs["workflow"]}`)
    );
    ctx.writeLine(fmt.kv("Status", fmt.status(element.attrs["status"] ?? "unknown")));
    ctx.writeLine(fmt.kv("Started", element.attrs["started-at"] ?? "unknown"));
    if (element.attrs["completed-at"]) {
      ctx.writeLine(fmt.kv("Completed", element.attrs["completed-at"]));
    }
    ctx.writeLine("");

    for (const child of element.children as ElementNode[]) {
      if (child.tagName === "step") {
        const status = child.attrs["status"] ?? "unknown";
        const icon =
          status === "completed"
            ? fmt.success("✓")
            : status === "skipped"
              ? fmt.dim("○")
              : status === "failed"
                ? fmt.error("✗")
                : status === "running"
                  ? fmt.warn("▸")
                  : fmt.dim("·");
        ctx.writeLine(`  ${icon} ${fmt.strong(child.attrs["id"] ?? "?")} ${fmt.dim(`(${status})`)}`);
      }
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Could not read run card: ${(error as Error).message}`,
    };
  }
}

// ─── Internal helpers ────────────────────────────────────────────────

/**
 * Parse a workflow definition card into a structured object.
 */
async function loadWorkflowDefinition(
  cardPath: string
): Promise<ParsedWorkflow> {
  const content = await fs.readFile(cardPath, "utf-8");
  const root = await parseXml(content, cardPath);

  const name = root.attrs["name"] ?? "unknown";

  let description = "";
  const steps: ParsedStep[] = [];

  for (const child of root.children as ElementNode[]) {
    if (child.tagName === "description") {
      description = dedent(child.text ?? "");
    } else if (child.tagName === "step") {
      steps.push(parseStepDef(child));
    }
  }

  return { name, description, steps };
}

/**
 * Parse a step definition element.
 */
function parseStepDef(stepEl: ElementNode): ParsedStep {
  const id = stepEl.attrs["id"] ?? "unknown";
  let description = "";

  const result: ParsedStep = { id, description };

  for (const child of stepEl.children as ElementNode[]) {
    switch (child.tagName) {
      case "description":
        description = dedent(child.text ?? "");
        result.description = description;
        break;
      case "precheck":
        result.precheck = {
          ...parsePhaseDef(child),
          passOutput: child.attrs["pass-output"] === "true",
        };
        break;
      case "run":
        result.run = parsePhaseDef(child);
        break;
      case "validate":
        result.validate = {
          phase: parsePhaseDef(child),
          severity: child.attrs["severity"] ?? "warn",
        };
        break;
    }
  }

  return result;
}

/**
 * Parse a phase (precheck/run/validate) element into structured data.
 */
function parsePhaseDef(phaseEl: ElementNode): ParsedPhase {
  const shells: string[] = [];
  const agents: ParsedPhase["agents"] = [];
  const instructions: string[] = [];
  const whys: string[] = [];

  for (const child of phaseEl.children as ElementNode[]) {
    switch (child.tagName) {
      case "shell":
        shells.push(dedent(child.text ?? ""));
        break;
      case "agent": {
        const agentDef: ParsedPhase["agents"][number] = {
          prompt: dedent(child.text ?? ""),
        };
        if (child.attrs["model"]) {
          agentDef.model = child.attrs["model"];
        }
        if (child.attrs["max-turns"]) {
          agentDef.maxTurns = Number(child.attrs["max-turns"]);
        }
        agents.push(agentDef);
        break;
      }
      case "instruction":
        instructions.push(dedent(child.text ?? ""));
        break;
      case "why":
        whys.push(dedent(child.text ?? ""));
        break;
    }
  }

  return { shells, agents, instructions, whys };
}

/**
 * Parameters for buildInitialRunCard
 */
interface BuildInitialRunCardParams {
  workflow: ParsedWorkflow;
  workflowPath: string;
  startedAt: string;
}

/**
 * Build the initial run card XML.
 */
function buildInitialRunCard(params: BuildInitialRunCardParams): string {
  const { workflow, workflowPath, startedAt } = params;
  const stepElements = workflow.steps.map((step) =>
    createElement("step", {
      id: step.id,
      status: "pending",
    })
  );

  const root = createElement("workflow-run", {
    workflow: workflowPath,
    status: "running",
    "started-at": startedAt,
    children: stepElements,
  });

  return serialize(root, { indent: "  " }) + "\n";
}

/**
 * Parameters for executeStep
 */
interface ExecuteStepParams {
  ctx: CommandContext;
  boxRoot: string;
  step: ParsedStep;
  workflow: ParsedWorkflow;
  workflowCardPath: string;
  runCardPath: string;
  relWorkflowPath: string;
}

/**
 * Execute a single workflow step.
 *
 * Returns "completed", "skipped", or "failed".
 */
async function executeStep(params: ExecuteStepParams): Promise<"completed" | "skipped" | "failed"> {
  const { ctx, boxRoot, step, workflow, workflowCardPath, runCardPath, relWorkflowPath } = params;
  const relRunCardPath = path.relative(boxRoot, runCardPath);

  ctx.writeLine(fmt.phase(`Step: ${step.id}`));
  ctx.writeLine(fmt.dim(step.description));
  ctx.writeLine("");

  // Update run card: step is now running (uncommitted signal)
  await updateStepInRunCard({
    runCardPath,
    stepId: step.id,
    update: {
      status: "running",
      startedAt: new Date().toISOString(),
    },
  });

  // ── Precheck ──
  let precheckResult: { exitCode: number; stdout: string; stderr: string; skipped: boolean } | undefined;
  if (step.precheck) {
    ctx.writeLine(fmt.dim("  Precheck..."));
    precheckResult = await executePhaseShells(boxRoot, step.precheck);

    if (precheckResult.skipped) {
      ctx.writeLine(fmt.dim(`  Skipped: ${precheckResult.stdout || "precheck exit $CHECK_SKIP"}`));
      await updateStepInRunCard({
        runCardPath,
        stepId: step.id,
        update: {
          status: "skipped",
          precheck: { status: "skip", stdout: precheckResult.stdout },
        },
      });
      await stageAll(boxRoot);
      await commit(boxRoot, {
        message: `[workflow] Skip step: ${step.id}`,
        trailers: { Workflow: workflow.name, Step: step.id },
      });
      ctx.writeLine("");
      return "skipped";
    }

    if (precheckResult.exitCode !== 0) {
      ctx.writeLine(fmt.fail(`Precheck failed (exit ${precheckResult.exitCode})`));
      if (precheckResult.stderr) {
        ctx.writeLine(fmt.dim(`  ${precheckResult.stderr}`));
      }
      await updateStepInRunCard({
        runCardPath,
        stepId: step.id,
        update: {
          status: "failed",
          precheck: { status: "fail", stdout: precheckResult.stdout },
          completedAt: new Date().toISOString(),
        },
      });
      await stageAll(boxRoot);
      await commit(boxRoot, {
        message: `[workflow] Failed step: ${step.id} (precheck)`,
        trailers: { Workflow: workflow.name, Step: step.id },
      });
      ctx.writeLine("");
      return "failed";
    }

    ctx.writeLine(fmt.ok(`Precheck passed${precheckResult.stdout ? `: ${precheckResult.stdout}` : ""}`));
  }

  // Capture precheck output for pass-output feature
  const precheckOutput =
    step.precheck?.passOutput && precheckResult?.stdout
      ? precheckResult.stdout
      : undefined;

  // ── Run ──
  if (!step.run) {
    ctx.writeLine(fmt.warn("  No run phase defined"));
    await updateStepInRunCard({
      runCardPath,
      stepId: step.id,
      update: {
        status: "completed",
        completedAt: new Date().toISOString(),
      },
    });
    await stageAll(boxRoot);
    await commit(boxRoot, {
      message: `[workflow] Complete step: ${step.id}`,
      trailers: { Workflow: workflow.name, Step: step.id },
    });
    ctx.writeLine("");
    return "completed";
  }

  let sessionId: string | undefined;
  let runStdout: string | undefined;

  // Execute agents
  for (const agent of step.run.agents) {
    ctx.writeLine(fmt.dim(`  Running agent${agent.model ? ` (${agent.model})` : ""}...`));

    // Build context block
    const stepLineRange = await getStepLineRange(workflowCardPath, step.id);
    const contextBlock = buildContextBlock({
      runCardPath: relRunCardPath,
      stepId: step.id,
      workflowPath: relWorkflowPath,
      ...(stepLineRange && { stepLineRange }),
      ...(precheckOutput && { precheckOutput }),
    });

    const systemPrompt = contextBlock + "\n\n" + agent.prompt;

    const agentOpts: AgentOptions = {
      boxRoot,
      systemPrompt,
      prompt: `Execute the ${step.id} step of the ${workflow.name} workflow. Follow the instructions in your system prompt.`,
      onOutput: (text) => ctx.write(text),
      maxTurns: agent.maxTurns ?? 20,
    };
    if (agent.model) {
      agentOpts.model = MODEL_MAP[agent.model] ?? agent.model;
    }

    const agentResult = await runAgent(agentOpts);

    sessionId = agentResult.sessionId;

    if (!agentResult.success) {
      ctx.writeLine(fmt.fail(`Agent failed: ${agentResult.error ?? "unknown error"}`));
    }
  }

  // Execute shell commands in run phase
  for (const script of step.run.shells) {
    ctx.writeLine(fmt.dim("  Running shell command..."));
    const result = await runShell(boxRoot, script);
    runStdout = result.stdout;

    if (result.exitCode !== 0 && !result.skipped) {
      ctx.writeLine(fmt.fail(`Shell command failed (exit ${result.exitCode})`));
      if (result.stderr) {
        ctx.writeLine(fmt.dim(`  ${result.stderr}`));
      }
    } else if (result.stdout) {
      ctx.writeLine(fmt.dim(`  ${result.stdout}`));
    }
  }

  // Ensure git is clean after run phase
  const gitRef = await ensureGitClean({
    boxRoot,
    stepId: step.id,
    workflowName: workflow.name,
    ...(sessionId && { sessionId }),
  });

  // ── Validate ──
  let validateResult: { status: string; stdout?: string; review?: string } | undefined;

  if (step.validate) {
    ctx.writeLine(fmt.dim("  Validating..."));
    validateResult = await executeValidation({
      ctx,
      boxRoot,
      step,
      _workflow: workflow,
      _workflowCardPath: workflowCardPath,
      _runCardPath: runCardPath,
      _relWorkflowPath: relWorkflowPath,
      _gitRef: gitRef,
    });
  }

  // ── Record results ──
  const stepUpdate: StepUpdate = {
    status: validateResult?.status === "fail" && step.validate?.severity === "abort"
      ? "failed"
      : "completed",
    completedAt: new Date().toISOString(),
  };

  if (step.precheck) {
    stepUpdate.precheck = { status: "pass", stdout: "" };
  }

  const runResult: NonNullable<StepUpdate["run"]> = { gitRef };
  if (sessionId) {
    runResult.sessionId = sessionId;
  }
  if (runStdout) {
    runResult.stdout = runStdout;
  }
  stepUpdate.run = runResult;

  if (validateResult) {
    const valUpdate: NonNullable<StepUpdate["validate"]> = {
      status: validateResult.status,
    };
    if (validateResult.stdout) {
      valUpdate.stdout = validateResult.stdout;
    }
    if (validateResult.review) {
      valUpdate.review = validateResult.review;
    }
    stepUpdate.validate = valUpdate;
  }

  await updateStepInRunCard({ runCardPath, stepId: step.id, update: stepUpdate });
  await stageAll(boxRoot);
  await commit(boxRoot, {
    message: `[workflow] Complete step: ${step.id}`,
    trailers: { Workflow: workflow.name, Step: step.id },
  });

  const succeeded = stepUpdate.status !== "failed";
  if (succeeded) {
    ctx.writeLine(fmt.ok(`Step completed: ${step.id}`));
  } else {
    ctx.writeLine(fmt.fail(`Step failed: ${step.id}`));
  }
  ctx.writeLine("");

  return succeeded ? "completed" : "failed";
}

/**
 * Execute shell commands in a phase, returning the combined result.
 */
async function executePhaseShells(
  boxRoot: string,
  phase: ParsedPhase
): Promise<{ exitCode: number; stdout: string; stderr: string; skipped: boolean }> {
  let combinedStdout = "";
  let combinedStderr = "";

  for (const script of phase.shells) {
    const result = await runShell(boxRoot, script);
    if (result.stdout) {
      combinedStdout += (combinedStdout ? "\n" : "") + result.stdout;
    }
    if (result.stderr) {
      combinedStderr += (combinedStderr ? "\n" : "") + result.stderr;
    }

    if (result.skipped) {
      return { exitCode: CHECK_SKIP_CODE, stdout: combinedStdout, stderr: combinedStderr, skipped: true };
    }
    if (result.exitCode !== 0) {
      return { exitCode: result.exitCode, stdout: combinedStdout, stderr: combinedStderr, skipped: false };
    }
  }

  return { exitCode: 0, stdout: combinedStdout, stderr: combinedStderr, skipped: false };
}

/**
 * Parameters for executeValidation
 */
interface ExecuteValidationParams {
  ctx: CommandContext;
  boxRoot: string;
  step: ParsedStep;
  _workflow: ParsedWorkflow;
  _workflowCardPath: string;
  _runCardPath: string;
  _relWorkflowPath: string;
  _gitRef: string;
}

/**
 * Execute validation phase.
 */
async function executeValidation(params: ExecuteValidationParams): Promise<{ status: string; stdout?: string; review?: string }> {
  const { ctx, boxRoot, step, _workflow, _workflowCardPath, _runCardPath, _relWorkflowPath, _gitRef } = params;
  const validate = step.validate!;
  const { phase, severity } = validate;
  let status = "pass";
  let stdout = "";
  let review: string | undefined;

  // Run shell checks
  if (phase.shells.length > 0) {
    const shellResult = await executePhaseShells(boxRoot, phase);
    stdout = shellResult.stdout;

    if (shellResult.exitCode !== 0) {
      status = severity === "warn" ? "warn" : "fail";
      ctx.writeLine(
        severity === "warn"
          ? fmt.warn(`  Validation warning: ${stdout || shellResult.stderr}`)
          : fmt.fail(`  Validation failed: ${stdout || shellResult.stderr}`)
      );
    } else {
      ctx.writeLine(fmt.ok(`Validation passed${stdout ? `: ${stdout}` : ""}`));
    }
  }

  // Run instruction checks (model evaluation)
  if (phase.instructions.length > 0 && status !== "fail") {
    // For now, instruction validation is logged but not evaluated by a model.
    // The model review feature will be added when needed.
    const whyText = phase.whys.join("\n");
    ctx.writeLine(
      fmt.dim(`  Instruction check: ${phase.instructions[0]?.slice(0, 80)}...`)
    );
    if (whyText) {
      ctx.writeLine(fmt.dim(`  Why: ${whyText.slice(0, 80)}...`));
    }
    // TODO: Invoke review model with instruction + git diff + why
    // For now, instruction checks pass by default
  }

  // Handle severity="review" failure with retry
  if (status === "fail" && severity === "review") {
    ctx.writeLine(fmt.warn("  Validation failed with severity=review — would retry agent"));
    // TODO: Re-invoke agent with failure context and <why>
    // For now, downgrade to warn and continue
    status = "warn";
  }

  const result: { status: string; stdout?: string; review?: string } = { status };
  if (stdout) {
    result.stdout = stdout;
  }
  if (review) {
    result.review = review;
  }
  return result;
}

/**
 * Parameters for ensureGitClean
 */
interface EnsureGitCleanParams {
  boxRoot: string;
  stepId: string;
  workflowName: string;
  sessionId?: string;
}

/**
 * Ensure git is clean after a step's run phase.
 * If there are uncommitted changes, make a fallback commit.
 * Returns the git ref of the step's work.
 */
async function ensureGitClean(params: EnsureGitCleanParams): Promise<string> {
  const { boxRoot, stepId, workflowName, sessionId } = params;
  const gitStatus = await getStatus(boxRoot);

  if (!gitStatus.clean) {
    // Fallback commit — the agent didn't commit its own work
    await stageAll(boxRoot);
    const trailers: Record<string, string> = {
      Workflow: workflowName,
      Step: stepId,
      "Commit-Source": "workflow-fallback",
    };
    if (sessionId) {
      trailers["Session"] = sessionId;
    }

    // Build a summary of what changed
    const allFiles = [...gitStatus.staged, ...gitStatus.modified, ...gitStatus.untracked];
    const summary = buildFallbackSummary(allFiles, boxRoot);

    return await commit(boxRoot, {
      message: `[workflow] ${stepId}: ${summary}`,
      trailers,
    });
  }

  // Git is clean — get the latest commit ref
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: boxRoot,
  });
  return stdout.trim();
}

/**
 * Build a short summary of changed files for fallback commit messages.
 */
function buildFallbackSummary(files: string[], _boxRoot: string): string {
  if (files.length === 0) return "uncommitted changes";

  // Extract basenames and count by directory
  const dirCounts = new Map<string, number>();
  for (const f of files) {
    const dir = path.dirname(f);
    dirCounts.set(dir, (dirCounts.get(dir) || 0) + 1);
  }

  // If all files are in one directory, mention it
  if (dirCounts.size === 1) {
    const entry = [...dirCounts.entries()][0]!;
    const dir = entry[0];
    const count = entry[1];
    const shortDir = dir.replace(/^.*?\//, ""); // trim leading segment
    if (count === 1) {
      return `update ${path.basename(files[0]!)}`;
    }
    return `update ${count} files in ${shortDir}`;
  }

  // Multiple dirs — summarize
  return `update ${files.length} files`;
}

/**
 * Parameters for buildContextBlock
 */
interface BuildContextBlockParams {
  runCardPath: string;
  stepId: string;
  workflowPath: string;
  stepLineRange?: string;
  precheckOutput?: string;
}

/**
 * Build the context block prepended to agent system prompts.
 */
function buildContextBlock(params: BuildContextBlockParams): string {
  const { runCardPath, stepId, workflowPath, stepLineRange, precheckOutput } = params;
  const date = new Date().toISOString().slice(0, 10);
  const stepRef = stepLineRange
    ? `${stepId} (defined at ${workflowPath} ${stepLineRange})`
    : stepId;

  let block = `# Context

Current date: ${date}
Workflow run: ${runCardPath}
Step: ${stepRef}`;

  if (precheckOutput) {
    block += `

<precheck>
${precheckOutput}
</precheck>`;
  }

  return block;
}

/**
 * Find the line range of a step definition in the workflow card.
 */
async function getStepLineRange(
  workflowCardPath: string,
  stepId: string
): Promise<string | undefined> {
  try {
    const content = await fs.readFile(workflowCardPath, "utf-8");
    const lines = content.split("\n");

    let startLine: number | undefined;
    let endLine: number | undefined;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (
        line.includes("<step") &&
        line.includes(`id="${stepId}"`)
      ) {
        startLine = i + 1; // 1-indexed
      }
      if (startLine && !endLine && line.includes("</step>")) {
        endLine = i + 1;
        break;
      }
    }

    if (startLine && endLine) {
      return `lines ${startLine}-${endLine}`;
    }
  } catch {
    // If we can't read the file, just skip the line range
  }
  return undefined;
}

// ─── Run card updates ────────────────────────────────────────────────

interface StepUpdate {
  status: string;
  startedAt?: string;
  completedAt?: string;
  precheck?: { status: string; stdout?: string };
  run?: { sessionId?: string; stdout?: string; gitRef?: string };
  validate?: { status: string; stdout?: string; review?: string };
}

/**
 * Parameters for updateRunCardStatus
 */
interface UpdateRunCardStatusParams {
  runCardPath: string;
  status: string;
  completedAt?: string;
}

/**
 * Update the run card's overall status.
 */
async function updateRunCardStatus(params: UpdateRunCardStatusParams): Promise<void> {
  const { runCardPath, status, completedAt } = params;
  const content = await fs.readFile(runCardPath, "utf-8");
  const root = await parseXml(content, runCardPath);

  root.attrs["status"] = status;
  if (completedAt) {
    root.attrs["completed-at"] = completedAt;
  }

  await fs.writeFile(runCardPath, serialize(root, { indent: "  " }) + "\n");
}

/**
 * Parameters for updateStepInRunCard
 */
interface UpdateStepInRunCardParams {
  runCardPath: string;
  stepId: string;
  update: StepUpdate;
}

/**
 * Update a specific step in the run card.
 */
async function updateStepInRunCard(params: UpdateStepInRunCardParams): Promise<void> {
  const { runCardPath, stepId, update } = params;
  const content = await fs.readFile(runCardPath, "utf-8");
  const root = await parseXml(content, runCardPath);

  for (const child of root.children as ElementNode[]) {
    if (child.tagName === "step" && child.attrs["id"] === stepId) {
      child.attrs["status"] = update.status;
      if (update.startedAt) {
        child.attrs["started-at"] = update.startedAt;
      }
      if (update.completedAt) {
        child.attrs["completed-at"] = update.completedAt;
      }

      // Build child elements for results
      const resultChildren: ElementNode[] = [];

      if (update.precheck) {
        const precheckChildren: ElementNode[] = [];
        if (update.precheck.stdout) {
          precheckChildren.push(
            createElement("stdout", { children: update.precheck.stdout })
          );
        }
        resultChildren.push(
          createElement("precheck", {
            status: update.precheck.status,
            children: precheckChildren,
          })
        );
      }

      if (update.run) {
        const runChildren: ElementNode[] = [];
        if (update.run.sessionId) {
          runChildren.push(
            createElement("session-id", { children: update.run.sessionId })
          );
        }
        if (update.run.stdout) {
          runChildren.push(
            createElement("stdout", { children: update.run.stdout })
          );
        }
        if (update.run.gitRef) {
          runChildren.push(
            createElement("git-ref", { children: update.run.gitRef })
          );
        }
        resultChildren.push(createElement("run", { children: runChildren }));
      }

      if (update.validate) {
        const validateChildren: ElementNode[] = [];
        if (update.validate.stdout) {
          validateChildren.push(
            createElement("stdout", { children: update.validate.stdout })
          );
        }
        if (update.validate.review) {
          validateChildren.push(
            createElement("review", { children: update.validate.review })
          );
        }
        resultChildren.push(
          createElement("validate", {
            status: update.validate.status,
            children: validateChildren,
          })
        );
      }

      child.children = resultChildren;
      break;
    }
  }

  await fs.writeFile(runCardPath, serialize(root, { indent: "  " }) + "\n");
}
