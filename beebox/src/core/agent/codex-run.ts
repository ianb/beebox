/** Drive one batch-agent turn through the official Codex SDK. */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fmt } from "../../lib/format.js";
import { buildTimezoneContext } from "../box/config.js";
import type { AgentResult } from "./types.js";
import { ensureCodexPluginInstalled } from "./ensure-codex-plugin.js";
import { checkCodexAuth } from "./auth-preflight.js";
import { expandClaudeIncludes } from "../agent-context-includes.js";
import { getBoxShape } from "../../lib/box-shape.js";
import { validateHookPathsResult } from "../../cli/commands/validate-hook.js";
import { codexRunErrorText, resultFromCodexTurn } from "./codex-run-result.js";
import { applyEngineUnavailability } from "./engine-unavailability-apply.js";
import { recordCodexAgentUsage } from "./codex-run-usage.js";
import { codexUsageDelta, totalCodexSessionUsage } from "../codex-usage.js";
import {
  codexSdkUsage,
  createCodexSdkSession,
  type CodexSdkSessionFactory,
} from "../../services/codex-sdk-session.js";
import { emitObservedActivity, renderCodexCommand, type CodexObservedActivity } from "./codex-run-activity.js";
import { normalizeCodexSdkToolItem } from "../../services/codex-tool-activity.js";

export type { CodexObservedActivity } from "./codex-run-activity.js";

export interface CodexRunOptions {
  boxRoot: string;
  task?: string | undefined;
  systemPrompt: string;
  prompt: string;
  onOutput?: ((text: string) => void) | undefined;
  onActivity?: ((activity: CodexObservedActivity) => void) | undefined;
  dryRun?: boolean | undefined;
  maxTurns?: number | undefined;
  maxBudgetUsd?: number | undefined;
  model?: string | undefined;
  resumeSessionId?: string | undefined;
  onSessionId?: ((id: string) => void) | undefined;
  outputSchema?: Record<string, unknown> | undefined;
  cwd?: string | undefined;
  additionalDirectories?: string[] | undefined;
}

/** Run one fresh or resumed Codex turn and map it to the existing Agent result. */
export async function runCodexAgent(
  options: CodexRunOptions,
  createSession?: CodexSdkSessionFactory,
): Promise<AgentResult> {
  if (options.dryRun === true) {
    return {
      success: true,
      output: `[DRY RUN] Would run Codex SDK with prompt:\n${options.prompt}`,
      exitCode: 0,
      sessionId: options.resumeSessionId ?? "",
    };
  }
  const activity = { seen: false };
  let observedSessionId = options.resumeSessionId ?? "";
  try {
    await checkCodexAuth();
    await ensureCodexPluginInstalled();
    const tzContext = options.resumeSessionId === undefined ? await buildTimezoneContext(options.boxRoot) : "";
    const { packageRoot } = await getBoxShape(options.boxRoot);
    const includedContext = await expandClaudeIncludes({
      claudePath: join(options.boxRoot, "CLAUDE.md"),
      packageRoot,
    });
    if (options.maxBudgetUsd !== undefined) {
      options.onOutput?.(
        `${fmt.warn("Codex does not expose a per-turn USD budget; beebox will enforce the configured tool-turn limit only.")}\n`,
      );
    }
    const session = (createSession ?? createCodexSdkSession)({
      cwd: options.cwd ?? options.boxRoot,
      systemPrompt: [options.systemPrompt + tzContext, includedContext].filter(Boolean).join("\n\n"),
      model: options.model,
      resumeSessionId: options.resumeSessionId,
      additionalDirectories: options.additionalDirectories,
    });
    const controller = new AbortController();
    const changedPaths = new Set<string>();
    let toolCount = 0;
    const completed = await session.run({
      input: options.prompt,
      outputSchema: options.outputSchema,
      signal: controller.signal,
      onSessionId(sessionId) {
        observedSessionId = sessionId;
        options.onSessionId?.(sessionId);
      },
      onEvent(event) {
        if (event.type !== "item.completed") return;
        activity.seen = true;
        const { item } = event;
        if (item.type === "agent_message") {
          options.onOutput?.(`${item.text}\n`);
          return;
        }
        emitObservedActivity(item, options.onActivity);
        if (item.type === "file_change" && item.status === "completed") {
          for (const change of item.changes) changedPaths.add(change.path);
        }
        if (normalizeCodexSdkToolItem(item) !== null) toolCount += 1;
        const rendered = renderCodexCommand(item);
        if (rendered !== "") options.onOutput?.(`${rendered}\n`);
        if (toolCount > (options.maxTurns ?? 20)) controller.abort();
      },
    });
    observedSessionId = completed.sessionId;
    options.onSessionId?.(completed.sessionId);
    try {
      const cumulative = completed.usage === null ? null : codexSdkUsage(completed.usage);
      const previous = cumulative === null
        ? null
        : await totalCodexSessionUsage(options.boxRoot, completed.sessionId);
      await recordCodexAgentUsage({
        boxRoot: options.boxRoot,
        threadId: completed.sessionId,
        invocationId: randomUUID(),
        task: options.task,
        model: options.model,
        usage: cumulative === null || previous === null ? null : codexUsageDelta(cumulative, previous),
        onOutput: options.onOutput,
      });
    } catch (error) {
      options.onOutput?.(`${fmt.warn(`Could not record Codex token usage: ${codexRunErrorText(error)}`)}\n`);
    }
    const validation = await validateHookPathsResult([...changedPaths]);
    if (validation.feedback !== null && !validation.hasErrors) {
      options.onOutput?.(`Bee Box validation warning:\n${validation.feedback}\n`);
    }
    if (validation.hasErrors) {
      const output = [completed.output, `Bee Box validation failed:\n${validation.feedback ?? "Unknown validation error"}`]
        .filter(Boolean)
        .join("\n");
      return {
        success: false,
        output,
        resultText: completed.resultText,
        error: "Codex edits failed Bee Box validation",
        exitCode: 1,
        sessionId: completed.sessionId,
      };
    }
    let structuredOutput: unknown;
    if (options.outputSchema !== undefined && completed.status === "completed") {
      structuredOutput = JSON.parse(completed.resultText);
    }
    return await applyEngineUnavailability(
      resultFromCodexTurn({
        ...completed,
        threadId: completed.sessionId,
        structuredOutput,
        hadAssistantActivity: activity.seen,
      }),
      { provider: "codex", boxRoot: options.boxRoot },
    );
  } catch (error) {
    return applyEngineUnavailability(
      {
        success: false,
        output: "",
        error: codexRunErrorText(error),
        exitCode: -1,
        sessionId: observedSessionId,
        ...(!activity.seen && { invocationFailure: true }),
      },
      { provider: "codex", boxRoot: options.boxRoot },
    );
  }
}
