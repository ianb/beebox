/** Drive one batch-agent turn through Codex app-server. */

import { z } from "zod";
import { fmt } from "../../lib/format.js";
import { buildTimezoneContext } from "../box/config.js";
import {
  CodexAppServer,
} from "../../services/codex-app-server.js";
import type { AgentResult } from "./types.js";
import { ensureCodexPluginInstalled } from "./ensure-codex-plugin.js";
import { expandClaudeIncludes } from "../agent-context-includes.js";
import { getBoxShape } from "../../lib/box-shape.js";
import { join } from "node:path";
import { validateHookPaths } from "../../cli/commands/validate-hook.js";
import { codexRunErrorText, resultFromCodexTurn } from "./codex-run-result.js";
import { codexTokenUsageSchema, type CodexTokenUsage } from "../codex-usage.js";
import { recordCodexAgentUsage } from "./codex-run-usage.js";
import {
  codexBoxThreadSettings,
  codexBoxTurnSettings,
} from "../../services/codex-sandbox.js";
import {
  emitObservedActivity,
  itemCompletedSchema,
  renderCodexCommand,
  type CodexObservedActivity,
} from "./codex-run-activity.js";

export type { CodexObservedActivity } from "./codex-run-activity.js";

const threadResultSchema = z.looseObject({
  thread: z.looseObject({ id: z.string() }),
});

const turnResultSchema = z.looseObject({
  turn: z.looseObject({ id: z.string() }),
});

const turnCompletedSchema = z.looseObject({
  threadId: z.string(),
  turn: z.looseObject({
    id: z.string(),
    status: z.enum(["completed", "interrupted", "failed", "inProgress"]),
    durationMs: z.number().nullable(),
    error: z.looseObject({ message: z.string() }).nullable(),
  }),
});

const tokenUsageSchema = z.looseObject({
  threadId: z.string(),
  turnId: z.string(),
  tokenUsage: z.looseObject({ last: codexTokenUsageSchema }),
});

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
  /** Retained for parity with the Agent contract. Full-access Codex box turns
   * already include these paths; this becomes meaningful if policy narrows. */
  additionalDirectories?: string[] | undefined;
}

class CodexTurnCompletionTimeoutError extends Error {
  constructor() {
    super("Codex turn did not complete before the timeout");
    this.name = "CodexTurnCompletionTimeoutError";
  }
}

function waitForTurn(options: {
  server: CodexAppServer;
  threadId: string;
  turnId: string;
  maxTurns: number;
  onOutput?: ((text: string) => void) | undefined;
  onActivity?: ((activity: CodexObservedActivity) => void) | undefined;
}): Promise<{ output: string; resultText: string; durationMs: number; status: "completed" | "interrupted" | "failed"; changedPaths: string[]; usage: CodexTokenUsage | null }> {
  const output: string[] = [];
  const finalText: string[] = [];
  let toolCount = 0;
  let interruptSent = false;
  const changedPaths = new Set<string>();
  let usage: CodexTokenUsage | null = null;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      remove();
      reject(new CodexTurnCompletionTimeoutError());
    }, 600_000);
    const remove = options.server.onNotification((notification) => {
      if (notification.method === "thread/tokenUsage/updated") {
        const parsed = tokenUsageSchema.safeParse(notification.params);
        if (parsed.success && parsed.data.turnId === options.turnId) usage = parsed.data.tokenUsage.last;
        return;
      }
      if (notification.method === "item/completed") {
        const parsed = itemCompletedSchema.safeParse(notification.params);
        if (!parsed.success || parsed.data.turnId !== options.turnId) return;
        const { item } = parsed.data;
        if (item.type === "agentMessage") {
          output.push(item.text);
          if (item.phase === "final_answer" || item.phase === null) finalText.push(item.text);
          options.onOutput?.(`${item.text}\n`);
          return;
        }
        emitObservedActivity(item, options.onActivity);
        if (item.type === "fileChange" && item.status === "completed") {
          for (const change of item.changes) changedPaths.add(change.path);
        }
        toolCount += 1;
        const rendered = renderCodexCommand(item);
        if (rendered !== "") options.onOutput?.(`${rendered}\n`);
        if (toolCount > options.maxTurns && !interruptSent) {
          interruptSent = true;
          void options.server.request({
            method: "turn/interrupt",
            params: { threadId: options.threadId, turnId: options.turnId },
            timeoutMs: 10_000,
          }).catch((error: unknown) => {
            clearTimeout(timer);
            remove();
            reject(error);
          });
        }
        return;
      }
      if (notification.method !== "turn/completed") return;
      const parsed = turnCompletedSchema.safeParse(notification.params);
      if (!parsed.success || parsed.data.turn.id !== options.turnId) return;
      remove();
      clearTimeout(timer);
      const { turn } = parsed.data;
      if (turn.status === "inProgress") return;
      resolve({
        output: output.join("\n"),
        resultText: finalText.join("\n"),
        durationMs: turn.durationMs ?? 0,
        status: turn.status,
        changedPaths: [...changedPaths],
        usage,
      });
    });
  });
}

async function openThread(server: CodexAppServer, options: CodexRunOptions): Promise<string> {
  if (options.resumeSessionId !== undefined) {
    const resumed = await server.request({
      method: "thread/resume",
      params: codexRunThreadParams(options),
    });
    return threadResultSchema.parse(resumed).thread.id;
  }
  const started = await server.request({
    method: "thread/start",
    params: codexRunThreadParams(options),
  });
  return threadResultSchema.parse(started).thread.id;
}

export function codexRunThreadParams(options: CodexRunOptions): Record<string, unknown> {
  const common = {
    cwd: options.cwd ?? options.boxRoot,
    ...codexBoxThreadSettings(),
    developerInstructions: options.systemPrompt,
  };
  return options.resumeSessionId === undefined
    ? { ...common, model: options.model, ephemeral: false, sessionStartSource: "startup" }
    : { ...common, threadId: options.resumeSessionId };
}

export function codexRunTurnParams(run: CodexRunOptions, threadId: string): Record<string, unknown> {
  return {
    threadId,
    input: [{ type: "text", text: run.prompt, text_elements: [] }],
    cwd: run.cwd ?? run.boxRoot,
    ...codexBoxTurnSettings(),
    model: run.model,
    outputSchema: run.outputSchema,
  };
}

function startTurn(options: {
  server: CodexAppServer;
  run: CodexRunOptions;
  threadId: string;
}): Promise<unknown> {
  const { server, run, threadId } = options;
  return server.request({
    method: "turn/start",
    params: codexRunTurnParams(run, threadId),
  });
}

/** Run one fresh or resumed Codex turn and map it to the existing Agent result. */
export async function runCodexAgent(options: CodexRunOptions): Promise<AgentResult> {
  if (options.dryRun === true) {
    return {
      success: true,
      output: `[DRY RUN] Would run Codex app-server with prompt:\n${options.prompt}`,
      exitCode: 0,
      sessionId: options.resumeSessionId ?? "",
    };
  }
  const tzContext = options.resumeSessionId === undefined
    ? await buildTimezoneContext(options.boxRoot)
    : "";
  let server: CodexAppServer | null = null;
  try {
    await ensureCodexPluginInstalled();
    const { packageRoot } = await getBoxShape(options.boxRoot);
    const includedContext = await expandClaudeIncludes({
      claudePath: join(options.boxRoot, "CLAUDE.md"),
      packageRoot,
    });
    server = new CodexAppServer({ cwd: options.cwd ?? options.boxRoot });
    if (options.maxBudgetUsd !== undefined) {
      options.onOutput?.(
        `${fmt.warn("Codex does not expose a per-turn USD budget; callback-box will enforce the configured tool-turn limit only.")}\n`,
      );
    }
    await server.initialize();
    const threadId = await openThread(server, {
      ...options,
      systemPrompt: [options.systemPrompt + tzContext, includedContext].filter(Boolean).join("\n\n"),
    });
    options.onSessionId?.(threadId);
    const rawTurn = await startTurn({ server, run: options, threadId });
    const turnId = turnResultSchema.parse(rawTurn).turn.id;
    const completed = await waitForTurn({
      server,
      threadId,
      turnId,
      maxTurns: options.maxTurns ?? 20,
      onOutput: options.onOutput,
      onActivity: options.onActivity,
    });
    await recordCodexAgentUsage({
      boxRoot: options.boxRoot,
      threadId,
      turnId,
      task: options.task,
      model: options.model,
      usage: completed.usage,
      onOutput: options.onOutput,
    });
    const validationFeedback = await validateHookPaths(completed.changedPaths);
    if (validationFeedback !== null) {
      const output = [completed.output, `Callback Box validation failed:\n${validationFeedback}`]
        .filter(Boolean)
        .join("\n");
      return {
        success: false,
        output,
        resultText: completed.resultText,
        error: "Codex edits failed Callback Box validation",
        exitCode: 1,
        sessionId: threadId,
      };
    }
    let structuredOutput: unknown;
    if (options.outputSchema !== undefined && completed.status === "completed") {
      structuredOutput = JSON.parse(completed.resultText);
    }
    return resultFromCodexTurn({ ...completed, threadId, structuredOutput });
  } catch (error) {
    return {
      success: false,
      output: "",
      error: codexRunErrorText(error),
      exitCode: -1,
      sessionId: options.resumeSessionId ?? "",
    };
  } finally {
    server?.close();
  }
}
