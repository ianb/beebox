/**
 * Phase-level helpers for the procedure engine: running a phase's shell
 * commands, validation, git-clean enforcement, agent context blocks, and
 * locating a step's line range in its definition card.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getStatus, stageAll, commit, getHead } from "../../cli/lib/git.js";
import { fmt } from "../../cli/lib/format.js";
import { runShell, CHECK_SKIP_CODE } from "./shell.js";
import type { CommandContext } from "../command-runner.js";
import type { ParsedPhase, ParsedStep } from "./engine-types.js";

export interface PhaseShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  skipped: boolean;
}

/**
 * Execute shell commands in a phase, returning the combined result.
 */
export async function executePhaseShells(
  boxRoot: string,
  phase: ParsedPhase
): Promise<PhaseShellResult> {
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
export interface ExecuteValidationParams {
  ctx: CommandContext;
  boxRoot: string;
  step: ParsedStep;
}

/**
 * Execute validation phase.
 */
export async function executeValidation(
  params: ExecuteValidationParams
): Promise<{ status: string; stdout?: string; review?: string }> {
  const { ctx, boxRoot, step } = params;
  const validate = step.validate!;
  const { phase, severity } = validate;
  let status = "pass";
  let stdout = "";
  const review: string | undefined = undefined;

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
export interface EnsureGitCleanParams {
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
export async function ensureGitClean(params: EnsureGitCleanParams): Promise<string> {
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
    const summary = buildFallbackSummary(allFiles);

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
function buildFallbackSummary(files: string[]): string {
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
export interface BuildContextBlockParams {
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
export function buildContextBlock(params: BuildContextBlockParams): string {
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
export async function getStepLineRange(
  procedureCardPath: string,
  stepId: string
): Promise<string | undefined> {
  try {
    const content = await fs.readFile(procedureCardPath, "utf-8");
    const lines = content.split("\n");

    // Steps are YAML list items: `  - id: <stepId>`. The step runs until
    // the next list item at the same indent (another `- id:`) or EOF.
    const idRe = /^(\s*)-\s+id:\s*["']?([^\s"']+)/;
    let startLine: number | undefined;
    let endLine: number | undefined;
    let stepIndent = "";

    for (const [i, line_] of lines.entries()) {
      const line = line_!;
      const m = idRe.exec(line);
      if (startLine === undefined) {
        if (m && m[2] === stepId) {
          startLine = i + 1; // 1-indexed
          stepIndent = m[1] ?? "";
        }
        continue;
      }
      // A subsequent list item at the same indent ends this step.
      if (m && (m[1] ?? "") === stepIndent) {
        endLine = i; // previous line is the last of this step
        break;
      }
    }
    if (startLine !== undefined && endLine === undefined) {
      endLine = lines.length;
    }

    if (startLine !== undefined && endLine !== undefined) {
      return `lines ${startLine}-${endLine}`;
    }
  } catch (e) {
    // If we can't read the file, just skip the line range
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Could not read procedure card for step line range ${procedureCardPath}:`, e);
    }
  }
  return undefined;
}
