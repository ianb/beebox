/**
 * Procedure engine — executes procedure definitions step by step.
 *
 * Loads a procedure definition card, creates a run directory with a run card,
 * executes steps sequentially, records results, and maintains git-clean state
 * between steps.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createElement, serialize, parseXml, type ElementNode } from "cardworks";
import { createAgent as realCreateAgent, type AgentInvokeOptions } from "../agent.js";
import {
  getStatus,
  stageAll,
  commit,
  getHead,
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

/** Agent factory type — matches createAgent() signature */
export type AgentFactory = typeof realCreateAgent;

export interface ProcedureOptions {
  dryRun?: boolean;
  force?: boolean;
  /** Run only this step (by id), skip all others */
  step?: string;
  /** Runtime directive string passed to procedure agents */
  directive?: string;
  /** Override the agent factory (default: createAgent from agent.ts) */
  createAgent?: AgentFactory;
}

// ─── Types for parsed procedure definitions ───────────────────────────

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

interface ParsedProcedure {
  name: string;
  description: string;
  steps: ParsedStep[];
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Parameters for startProcedure
 */
export interface StartProcedureParams {
  ctx: CommandContext;
  procedureNameOrPath: string;
  options?: ProcedureOptions;
}

/**
 * Start a new procedure run.
 */
export async function startProcedure(
  params: StartProcedureParams
): Promise<CommandResult> {
  const { ctx, procedureNameOrPath, options = {} } = params;
  const { boxRoot } = ctx;

  // Resolve procedure definition: accept a path or a bare name
  let procedureCardPath: string;
  if (
    procedureNameOrPath.endsWith(".procedure.card") ||
    procedureNameOrPath.includes("/")
  ) {
    // Treat as a path (absolute or relative to boxRoot)
    procedureCardPath = path.isAbsolute(procedureNameOrPath)
      ? procedureNameOrPath
      : path.join(boxRoot, procedureNameOrPath);
  } else {
    // Bare name → config/procedures/<name>.procedure.card
    procedureCardPath = path.join(
      boxRoot,
      "config/procedures",
      `${procedureNameOrPath}.procedure.card`
    );
  }

  try {
    await fs.access(procedureCardPath);
  } catch {
    return {
      success: false,
      error: `Procedure definition not found: ${procedureCardPath}`,
    };
  }

  // Parse procedure definition
  const procedure = await loadProcedureDefinition(procedureCardPath);
  const procedureName = procedure.name;

  if (options.dryRun) {
    ctx.writeLine(fmt.header(`Procedure: ${procedure.name}`));
    ctx.writeLine(fmt.dim(procedure.description));
    if (options.directive) {
      ctx.writeLine(fmt.kv("Directive", options.directive));
    }
    ctx.writeLine("");
    for (const step of procedure.steps) {
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
    const found = procedure.steps.find((s) => s.id === options.step);
    if (!found) {
      const validIds = procedure.steps.map((s) => s.id).join(", ");
      return {
        success: false,
        error: `Unknown step "${options.step}". Available steps: ${validIds}`,
      };
    }
  }

  // Create run directory
  const timestamp = new Date()
    .toISOString()
    .replace(/[.:]/g, "")
    .replace("T", "T")
    .slice(0, 15);
  const runDirName = `${procedureName}_${timestamp}`;
  const runDir = path.join(boxRoot, "procedure/runs", runDirName);
  await fs.mkdir(runDir, { recursive: true });

  const runCardPath = path.join(runDir, "run.procedure-run.card");

  // Generate initial run card
  const now = new Date().toISOString();
  const relProcedurePath = path.relative(boxRoot, procedureCardPath);
  const initialRunCard = buildInitialRunCard({ procedure, procedurePath: relProcedurePath, startedAt: now, ...(options.directive && { directive: options.directive }) });
  await fs.writeFile(runCardPath, initialRunCard);

  // Commit start
  await stageAll(boxRoot);
  await commit(boxRoot, {
    message: `Start procedure: ${procedureName}`,
    trailers: { Procedure: procedureName },
  });

  ctx.writeLine(fmt.header(`Starting procedure: ${procedure.name}`));
  ctx.writeLine(fmt.dim(`Run: ${path.relative(boxRoot, runDir)}`));
  ctx.writeLine("");

  // Execute steps (optionally filtered to a single step)
  const stepsToRun = options.step
    ? procedure.steps.filter((s) => s.id === options.step)
    : procedure.steps;
  let allSucceeded = true;
  let failedStepId: string | null = null;
  for (const step of stepsToRun) {
    const result = await executeStep({
      ctx,
      boxRoot,
      step,
      procedure,
      procedureCardPath,
      runCardPath,
      relProcedurePath,
      ...(options.directive && { directive: options.directive }),
      ...(options.createAgent && { createAgent: options.createAgent }),
    });

    if (result === "failed") {
      allSucceeded = false;
      failedStepId = step.id;
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
    message: `${allSucceeded ? "Complete" : "Failed"} procedure: ${procedureName}`,
    trailers: { Procedure: procedureName },
  });

  if (allSucceeded) {
    ctx.writeLine(fmt.ok(`Procedure completed: ${procedureName}`));
  } else {
    ctx.writeLine(fmt.fail(`Procedure failed: ${procedureName}`));
  }

  return {
    success: allSucceeded,
    ...(!allSucceeded && { error: `Procedure ${procedureName} failed at step: ${failedStepId ?? "unknown"}` }),
  };
}

/**
 * List available procedure definitions.
 */
export async function listProcedures(
  ctx: CommandContext
): Promise<CommandResult> {
  const procedureDir = path.join(ctx.boxRoot, "config/procedures");

  try {
    const files = await fs.readdir(procedureDir);
    const cards = files.filter((f) => f.endsWith(".procedure.card"));

    if (cards.length === 0) {
      ctx.writeLine(fmt.dim("No procedure definitions found."));
      return { success: true, data: [] };
    }

    for (const card of cards) {
      const name = card.replace(".procedure.card", "");
      ctx.writeLine(`  ${fmt.strong(name)} ${fmt.dim(card)}`);
    }

    return { success: true, data: cards };
  } catch {
    ctx.writeLine(fmt.dim("No config/procedures/ directory."));
    return { success: true, data: [] };
  }
}

/**
 * Show status of a procedure run.
 */
export async function procedureStatus(
  ctx: CommandContext,
  runDir?: string
): Promise<CommandResult> {
  const { boxRoot } = ctx;

  // If no run dir specified, find the latest
  if (!runDir) {
    const runsDir = path.join(boxRoot, "procedure/runs");
    try {
      const dirs = await fs.readdir(runsDir);
      const sorted = dirs.toSorted().toReversed();
      if (sorted.length === 0) {
        ctx.writeLine(fmt.dim("No procedure runs found."));
        return { success: true };
      }
      runDir = path.join(runsDir, sorted[0]!);
    } catch {
      ctx.writeLine(fmt.dim("No procedure/runs/ directory."));
      return { success: true };
    }
  }

  const runCardPath = path.join(
    runDir.startsWith("/") ? runDir : path.join(boxRoot, runDir),
    "run.procedure-run.card"
  );

  try {
    const content = await fs.readFile(runCardPath, "utf-8");
    const element = await parseXml(content, runCardPath);

    ctx.writeLine(
      fmt.header(`Procedure Run: ${element.attrs["procedure"]}`)
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
 * Parse a procedure definition card into a structured object.
 */
async function loadProcedureDefinition(
  cardPath: string
): Promise<ParsedProcedure> {
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
  procedure: ParsedProcedure;
  procedurePath: string;
  startedAt: string;
  directive?: string;
}

/**
 * Build the initial run card XML.
 */
function buildInitialRunCard(params: BuildInitialRunCardParams): string {
  const { procedure, procedurePath, startedAt, directive } = params;
  const stepElements = procedure.steps.map((step) =>
    createElement("step", {
      id: step.id,
      status: "pending",
    })
  );

  const root = createElement("procedure-run", {
    procedure: procedurePath,
    status: "running",
    "started-at": startedAt,
    ...(directive && { directive }),
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
  procedure: ParsedProcedure;
  procedureCardPath: string;
  runCardPath: string;
  relProcedurePath: string;
  directive?: string;
  createAgent?: AgentFactory;
}

/**
 * Execute a single procedure step.
 *
 * Returns "completed", "skipped", or "failed".
 */
async function executeStep(params: ExecuteStepParams): Promise<"completed" | "skipped" | "failed"> {
  const { ctx, boxRoot, step, procedure, procedureCardPath, runCardPath, relProcedurePath } = params;
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
        message: `[procedure] Skip step: ${step.id}`,
        trailers: { Procedure: procedure.name, Step: step.id },
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
        message: `[procedure] Failed step: ${step.id} (precheck)`,
        trailers: { Procedure: procedure.name, Step: step.id },
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
      message: `[procedure] Complete step: ${step.id}`,
      trailers: { Procedure: procedure.name, Step: step.id },
    });
    ctx.writeLine("");
    return "completed";
  }

  let sessionId: string | undefined;
  let runStdout: string | undefined;

  // Execute agents
  for (const agentDef of step.run.agents) {
    ctx.writeLine(fmt.dim(`  Running agent${agentDef.model ? ` (${agentDef.model})` : ""}...`));

    // Build context block
    const stepLineRange = await getStepLineRange(procedureCardPath, step.id);
    const contextBlock = buildContextBlock({
      runCardPath: relRunCardPath,
      stepId: step.id,
      procedurePath: relProcedurePath,
      ...(stepLineRange && { stepLineRange }),
      ...(precheckOutput && { precheckOutput }),
      ...(params.directive && { directive: params.directive }),
    });

    const systemPrompt = contextBlock + "\n\n" + agentDef.prompt;

    const agentFactory = params.createAgent ?? realCreateAgent;
    const agent = agentFactory({
      name: `procedure-${procedure.name}-${step.id}`,
      onOutput: (text) => ctx.write(text),
    });

    const invokeOpts: AgentInvokeOptions = {
      boxRoot,
      systemPrompt,
      prompt: `Execute the ${step.id} step of the ${procedure.name} procedure. Follow the instructions in your system prompt.`,
      maxTurns: agentDef.maxTurns ?? 20,
    };
    if (agentDef.model) {
      invokeOpts.model = MODEL_MAP[agentDef.model] ?? agentDef.model;
    }

    const agentResult = await agent.invoke(invokeOpts);

    sessionId = agent.sessionId;

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
    procedureName: procedure.name,
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
      _procedure: procedure,
      _procedureCardPath: procedureCardPath,
      _runCardPath: runCardPath,
      _relProcedurePath: relProcedurePath,
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
    message: `[procedure] Complete step: ${step.id}`,
    trailers: { Procedure: procedure.name, Step: step.id },
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
  _procedure: ParsedProcedure;
  _procedureCardPath: string;
  _runCardPath: string;
  _relProcedurePath: string;
  _gitRef: string;
}

/**
 * Execute validation phase.
 */
async function executeValidation(params: ExecuteValidationParams): Promise<{ status: string; stdout?: string; review?: string }> {
  const { ctx, boxRoot, step } = params;
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
  procedureName: string;
  sessionId?: string;
}

/**
 * Ensure git is clean after a step's run phase.
 * If there are uncommitted changes, make a fallback commit.
 * Returns the git ref of the step's work.
 */
async function ensureGitClean(params: EnsureGitCleanParams): Promise<string> {
  const { boxRoot, stepId, procedureName, sessionId } = params;
  const gitStatus = await getStatus(boxRoot);

  if (!gitStatus.clean) {
    // Fallback commit — the agent didn't commit its own work
    await stageAll(boxRoot);
    const trailers: Record<string, string> = {
      Procedure: procedureName,
      Step: stepId,
      "Commit-Source": "procedure-fallback",
    };
    if (sessionId) {
      trailers["Session"] = sessionId;
    }

    // Build a summary of what changed
    const allFiles = [...gitStatus.staged, ...gitStatus.modified, ...gitStatus.untracked];
    const summary = buildFallbackSummary(allFiles, boxRoot);

    return await commit(boxRoot, {
      message: `[procedure] ${stepId}: ${summary}`,
      trailers,
    });
  }

  // Git is clean — get the latest commit ref
  return await getHead(boxRoot);
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
  procedurePath: string;
  stepLineRange?: string;
  precheckOutput?: string;
  directive?: string;
}

/**
 * Build the context block prepended to agent system prompts.
 */
function buildContextBlock(params: BuildContextBlockParams): string {
  const { runCardPath, stepId, procedurePath, stepLineRange, precheckOutput, directive } = params;
  const date = new Date().toISOString().slice(0, 10);
  const stepRef = stepLineRange
    ? `${stepId} (defined at ${procedurePath} ${stepLineRange})`
    : stepId;

  let block = `# Context

Current date: ${date}
Procedure run: ${runCardPath}
Step: ${stepRef}`;

  if (precheckOutput) {
    block += `

<precheck>
${precheckOutput}
</precheck>`;
  }

  if (directive) {
    block += `

<directive>
${directive}
</directive>`;
  }

  return block;
}

/**
 * Find the line range of a step definition in the procedure card.
 */
async function getStepLineRange(
  procedureCardPath: string,
  stepId: string
): Promise<string | undefined> {
  try {
    const content = await fs.readFile(procedureCardPath, "utf-8");
    const lines = content.split("\n");

    let startLine: number | undefined;
    let endLine: number | undefined;

    for (const [i, line_] of lines.entries()) {
      const line = line_!;
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
