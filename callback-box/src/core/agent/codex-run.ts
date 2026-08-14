/** Drive one batch-agent turn through Codex app-server. */

import { z } from "zod";
import { fmt } from "../../lib/format.js";
import { buildTimezoneContext } from "../box/config.js";
import {
  CodexAppServer,
  CodexAppServerTimeoutError,
  CodexRpcError,
} from "../../services/codex-app-server.js";
import type { AgentResult } from "./types.js";
import { ensureCodexPluginInstalled } from "./ensure-codex-plugin.js";
import { expandClaudeIncludes } from "../agent-context-includes.js";
import { getBoxShape } from "../../lib/box-shape.js";
import { join } from "node:path";
import { validateHookPaths } from "../../cli/commands/validate-hook.js";
import { resultFromCodexTurn } from "./codex-run-result.js";

const threadResultSchema = z.looseObject({
  thread: z.looseObject({ id: z.string() }),
});

const turnResultSchema = z.looseObject({
  turn: z.looseObject({ id: z.string() }),
});

const itemCompletedSchema = z.looseObject({
  threadId: z.string(),
  turnId: z.string(),
  item: z.discriminatedUnion("type", [
    z.looseObject({
      type: z.literal("agentMessage"),
      text: z.string(),
      phase: z.enum(["commentary", "final_answer"]).nullable(),
    }),
    z.looseObject({
      type: z.literal("commandExecution"),
      command: z.string(),
      aggregatedOutput: z.string().nullable(),
      exitCode: z.number().nullable(),
    }),
    z.looseObject({
      type: z.literal("fileChange"),
      status: z.enum(["inProgress", "completed", "failed", "declined"]),
      changes: z.array(z.looseObject({ path: z.string() })),
    }),
    z.looseObject({ type: z.literal("mcpToolCall") }),
    z.looseObject({ type: z.literal("dynamicToolCall") }),
  ]),
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

export interface CodexRunOptions {
  boxRoot: string;
  systemPrompt: string;
  prompt: string;
  onOutput?: ((text: string) => void) | undefined;
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

class CodexTurnFailedError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super("Codex turn failed");
    this.name = "CodexTurnFailedError";
    this.detail = detail;
  }
}

class CodexTurnCompletionTimeoutError extends Error {
  constructor() {
    super("Codex turn did not complete before the timeout");
    this.name = "CodexTurnCompletionTimeoutError";
  }
}

function errorText(error: unknown): string {
  if (error instanceof CodexRpcError) {
    return `${error.message}: ${error.method}: ${error.rpcMessage}`;
  }
  if (error instanceof CodexAppServerTimeoutError) {
    return `${error.message}: ${error.operation}`;
  }
  if (error instanceof CodexTurnFailedError) return `${error.message}: ${error.detail}`;
  return error instanceof Error ? error.message : String(error);
}

function renderCommand(item: z.infer<typeof itemCompletedSchema>["item"]): string {
  if (item.type !== "commandExecution") return "";
  const output = item.aggregatedOutput ?? "";
  const suffix = item.exitCode === null ? "" : ` [exit ${item.exitCode}]`;
  return `${fmt.dim("$ ")}${fmt.cmd(item.command)}${fmt.dim(suffix)}\n${output}`;
}

function waitForTurn(options: {
  server: CodexAppServer;
  threadId: string;
  turnId: string;
  maxTurns: number;
  onOutput?: ((text: string) => void) | undefined;
}): Promise<{ output: string; resultText: string; durationMs: number; status: "completed" | "interrupted" | "failed"; changedPaths: string[] }> {
  const output: string[] = [];
  const finalText: string[] = [];
  let toolCount = 0;
  let interruptSent = false;
  const changedPaths = new Set<string>();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      remove();
      reject(new CodexTurnCompletionTimeoutError());
    }, 600_000);
    const remove = options.server.onNotification((notification) => {
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
        if (item.type === "fileChange" && item.status === "completed") {
          for (const change of item.changes) changedPaths.add(change.path);
        }
        toolCount += 1;
        const rendered = renderCommand(item);
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
      });
    });
  });
}

async function openThread(server: CodexAppServer, options: CodexRunOptions): Promise<string> {
  if (options.resumeSessionId !== undefined) {
    const resumed = await server.request({
      method: "thread/resume",
      params: {
        threadId: options.resumeSessionId,
        cwd: options.cwd ?? options.boxRoot,
        approvalPolicy: "never",
        sandbox: "workspace-write",
        developerInstructions: options.systemPrompt,
      },
    });
    return threadResultSchema.parse(resumed).thread.id;
  }
  const started = await server.request({
    method: "thread/start",
    params: {
      cwd: options.cwd ?? options.boxRoot,
      approvalPolicy: "never",
      sandbox: "workspace-write",
      developerInstructions: options.systemPrompt,
      model: options.model,
      ephemeral: false,
      sessionStartSource: "startup",
    },
  });
  return threadResultSchema.parse(started).thread.id;
}

function startTurn(options: {
  server: CodexAppServer;
  run: CodexRunOptions;
  threadId: string;
}): Promise<unknown> {
  const { server, run, threadId } = options;
  const cwd = run.cwd ?? run.boxRoot;
  const writableRoots = [cwd, ...(run.additionalDirectories ?? [])];
  return server.request({
    method: "turn/start",
    params: {
      threadId,
      input: [{ type: "text", text: run.prompt, text_elements: [] }],
      cwd,
      approvalPolicy: "never",
      model: run.model,
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots,
        networkAccess: true,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
      outputSchema: run.outputSchema,
    },
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
      error: errorText(error),
      exitCode: -1,
      sessionId: options.resumeSessionId ?? "",
    };
  } finally {
    server?.close();
  }
}
