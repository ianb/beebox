/** Long-lived Codex app-server backend for interactive box chat. */

import { z } from "zod";
import { CodexAppServer, CodexRpcError } from "./codex-app-server.js";
import { createAsyncIterableQueue } from "./claude-chat-queue.js";
import type {
  ChatBackend,
  ChatBackendRun,
  ChatBackendStartOptions,
  ChatContentBlock,
  NativeChatBackendMessage,
} from "./claude-chat-types.js";
import { ensureCodexPluginInstalled } from "../core/agent/ensure-codex-plugin.js";
import { expandClaudeIncludes } from "../core/agent-context-includes.js";
import { getBoxShape } from "../lib/box-shape.js";
import { join } from "node:path";
import { findBoxRoot } from "../lib/paths.js";
import { validateHookPathsResult } from "../cli/commands/validate-hook.js";
import { appendCodexTurnUsage, codexTokenUsageSchema, type CodexTokenUsage } from "../core/codex-usage.js";
import { codexBoxThreadSettings, codexBoxTurnSettings } from "./codex-sandbox.js";

const threadSchema = z.looseObject({ thread: z.looseObject({ id: z.string() }) });
const turnSchema = z.looseObject({ turn: z.looseObject({ id: z.string() }) });
const itemSchema = z.looseObject({
  threadId: z.string(),
  turnId: z.string(),
  item: z.looseObject({
    id: z.string(),
    type: z.string(),
    text: z.string().optional(),
    phase: z.enum(["commentary", "final_answer"]).nullable().optional(),
    status: z.enum(["inProgress", "completed", "failed", "declined"]).optional(),
    changes: z.array(z.looseObject({ path: z.string() })).optional(),
  }),
});
const completedSchema = z.looseObject({
  threadId: z.string(),
  turn: z.looseObject({
    id: z.string(),
    status: z.enum(["completed", "interrupted", "failed", "inProgress"]),
    error: z.unknown().optional(),
    durationMs: z.number().nullable(),
  }),
});
const tokenUsageSchema = z.looseObject({
  turnId: z.string(),
  tokenUsage: z.looseObject({ last: codexTokenUsageSchema }),
});

class CodexChatNotInitializedError extends Error {
  constructor() {
    super("Codex chat thread was not initialized");
    this.name = "CodexChatNotInitializedError";
  }
}

class CodexChatTurnTimeoutError extends Error {
  constructor() {
    super("Codex chat turn did not complete before the timeout");
    this.name = "CodexChatTurnTimeoutError";
  }
}

function event(message: NativeChatBackendMessage["message"]): NativeChatBackendMessage {
  return { provider: "codex", message };
}

function errorText(error: unknown): string {
  if (error instanceof CodexRpcError) return `${error.message}: ${error.method}: ${error.rpcMessage}`;
  return error instanceof Error ? error.message : String(error);
}

/** Prefer the API's inner error message over its JSON-encoded envelope. */
export function codexTurnErrorText(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  if (typeof error === "string") return error;
  if (typeof error !== "object" || !("message" in error) || typeof error.message !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(error.message);
    if (
      parsed !== null && typeof parsed === "object" && "error" in parsed &&
      parsed.error !== null && typeof parsed.error === "object" && "message" in parsed.error &&
      typeof parsed.error.message === "string"
    ) {
      return parsed.error.message;
    }
  } catch (_error) {
    // Plain-text provider error; use it as-is below.
  }
  return "additionalDetails" in error && typeof error.additionalDetails === "string"
    ? error.additionalDetails
    : error.message;
}

function codexInput(content: ChatContentBlock[]): Array<Record<string, unknown>> {
  return content.map((block) => {
    if (block.type === "text") return { type: "text", text: block.text, text_elements: [] };
    const source = block.source;
    const url = source.type === "url"
      ? source.url
      : `data:${source.media_type ?? "image/png"};base64,${source.data ?? ""}`;
    return { type: "image", url };
  });
}

async function openThread(server: CodexAppServer, opts: ChatBackendStartOptions): Promise<string> {
  const raw = opts.resumeSessionId === undefined
    ? await server.request({ method: "thread/start", params: codexChatThreadParams(opts) })
    : await server.request({ method: "thread/resume", params: codexChatThreadParams(opts) });
  return threadSchema.parse(raw).thread.id;
}

export function codexChatThreadParams(opts: ChatBackendStartOptions): Record<string, unknown> {
  const common = {
    cwd: opts.cwd,
    ...codexBoxThreadSettings(),
    developerInstructions: opts.systemPrompt,
    model: opts.model,
  };
  return opts.resumeSessionId === undefined
    ? { ...common, ephemeral: false, sessionStartSource: "startup" }
    : { ...common, threadId: opts.resumeSessionId };
}

export function codexChatTurnParams(options: {
  opts: ChatBackendStartOptions;
  threadId: string;
  content: ChatContentBlock[];
}): Record<string, unknown> {
  const { opts, threadId, content } = options;
  return {
    threadId,
    input: codexInput(content),
    cwd: opts.cwd,
    ...codexBoxTurnSettings(),
    model: opts.model,
  };
}

function waitForTurn(options: {
  server: CodexAppServer;
  queue: ReturnType<typeof createAsyncIterableQueue<NativeChatBackendMessage>>;
  threadId: string;
  turnId: string;
  boxRoot: string | null;
  model?: string | undefined;
  setActiveTurn(id: string | null): void;
}): Promise<void> {
  const changedPaths = new Set<string>();
  let usage: CodexTokenUsage | null = null;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      remove();
      removeExit();
      reject(new CodexChatTurnTimeoutError());
    }, 600_000);
    const removeExit = options.server.onExit((error) => {
      clearTimeout(timer);
      remove();
      reject(error);
    });
    const remove = options.server.onNotification((notification) => {
      if (notification.method === "thread/tokenUsage/updated") {
        const parsed = tokenUsageSchema.safeParse(notification.params);
        if (parsed.success && parsed.data.turnId === options.turnId) usage = parsed.data.tokenUsage.last;
        return;
      }
      if (notification.method === "item/completed") {
        const parsed = itemSchema.safeParse(notification.params);
        if (!parsed.success || parsed.data.turnId !== options.turnId) return;
        const { item } = parsed.data;
        if (item.type === "agentMessage" && item.text !== undefined) {
          options.queue.push(event({
            type: "assistant",
            session_id: options.threadId,
            uuid: item.id,
            message: { role: "assistant", content: [{ type: "text", text: item.text }] },
          }));
        }
        if (item.type === "fileChange" && item.status === "completed") {
          for (const change of item.changes ?? []) changedPaths.add(change.path);
        }
        return;
      }
      if (notification.method !== "turn/completed") return;
      const parsed = completedSchema.safeParse(notification.params);
      if (!parsed.success || parsed.data.turn.id !== options.turnId) return;
      if (parsed.data.turn.status === "inProgress") return;
      remove();
      removeExit();
      clearTimeout(timer);
      options.setActiveTurn(null);
      const turnError = codexTurnErrorText(parsed.data.turn.error);
      void Promise.all([
        validateHookPathsResult([...changedPaths]),
        usage === null || options.boxRoot === null
          ? Promise.resolve()
          : appendCodexTurnUsage(options.boxRoot, {
            sessionId: options.threadId,
            turnId: options.turnId,
            task: "web-chat",
            timestamp: new Date().toISOString(),
            model: options.model ?? "codex-default",
            usage,
          }),
      ]).then(([validation]) => {
        if (validation.feedback !== null && !validation.hasErrors) {
          console.warn(`[CodexChat:validation-warning] ${validation.feedback}`);
        }
        options.queue.push(event({
        type: "result",
        subtype: validation.hasErrors ? "failed" : parsed.data.turn.status,
        session_id: options.threadId,
        is_error: parsed.data.turn.status !== "completed" || validation.hasErrors,
        duration_ms: parsed.data.turn.durationMs ?? 0,
        num_turns: 1,
        ...((turnError === null && !validation.hasErrors) ? {} : {
          result: [turnError, validation.hasErrors ? `Callback Box validation failed:\n${validation.feedback ?? "Unknown validation error"}` : null]
            .filter((detail): detail is string => detail !== null)
            .join("\n\n"),
        }),
        }));
        resolve();
      }).catch(reject);
    });
  });
}

function createRun(opts: ChatBackendStartOptions): ChatBackendRun {
  const queue = createAsyncIterableQueue<NativeChatBackendMessage>();
  let server: CodexAppServer | null = null;
  let activeTurnId: string | null = null;
  let threadId: string | null = null;
  let boxRoot: string | null = null;
  let initializationError: unknown = null;
  let chain = ensureCodexPluginInstalled().then(async () => {
    boxRoot = await findBoxRoot(opts.cwd);
    const included = boxRoot === null ? "" : await expandClaudeIncludes({
      claudePath: join(boxRoot, "CLAUDE.md"),
      packageRoot: (await getBoxShape(boxRoot)).packageRoot,
    });
    server = new CodexAppServer({ cwd: opts.cwd, env: opts.env });
    await server.initialize();
    threadId = await openThread(server, {
      ...opts,
      systemPrompt: [opts.systemPrompt, included].filter(Boolean).join("\n\n"),
    });
    queue.push(event({ type: "system", subtype: "init", session_id: threadId }));
  }).catch((error: unknown) => {
    initializationError = error;
    queue.push(event({
      type: "result",
      subtype: "failed",
      session_id: opts.resumeSessionId ?? "",
      is_error: true,
      duration_ms: 0,
      num_turns: 0,
      result: errorText(error),
    }));
  });
  const run: ChatBackendRun = {
    closed: false,
    messages: queue.iterable,
    send(content): void {
      if (run.closed) return;
      chain = chain.then(async () => {
        if (initializationError !== null) return;
        if (threadId === null) throw new CodexChatNotInitializedError();
        queue.push(event({ type: "user", session_id: threadId, message: { role: "user", content } }));
        if (server === null) throw new CodexChatNotInitializedError();
        const raw = await server.request({
          method: "turn/start",
          params: codexChatTurnParams({ opts, threadId, content }),
        });
        activeTurnId = turnSchema.parse(raw).turn.id;
        await waitForTurn({
          server,
          queue,
          threadId,
          turnId: activeTurnId,
          boxRoot,
          model: opts.model,
          setActiveTurn: (id) => { activeTurnId = id; },
        });
      }).catch((error: unknown) => {
        const id = threadId ?? opts.resumeSessionId ?? "";
        queue.push(event({
          type: "result",
          subtype: "failed",
          session_id: id,
          is_error: true,
          duration_ms: 0,
          num_turns: 0,
          result: errorText(error),
        }));
      });
    },
    async interrupt(): Promise<void> {
      if (server === null || threadId === null || activeTurnId === null) return;
      await server.request({ method: "turn/interrupt", params: { threadId, turnId: activeTurnId }, timeoutMs: 10_000 });
    },
    async close(): Promise<void> {
      if (run.closed) return;
      await chain;
      run.closed = true;
      server?.close();
      queue.end();
    },
  };
  return run;
}

export function createCodexChatBackend(): ChatBackend {
  return { start: createRun };
}
