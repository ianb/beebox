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

const threadSchema = z.looseObject({ thread: z.looseObject({ id: z.string() }) });
const turnSchema = z.looseObject({ turn: z.looseObject({ id: z.string() }) });
const itemSchema = z.looseObject({
  threadId: z.string(),
  turnId: z.string(),
  item: z.looseObject({
    type: z.string(),
    text: z.string().optional(),
    phase: z.enum(["commentary", "final_answer"]).nullable().optional(),
  }),
});
const completedSchema = z.looseObject({
  threadId: z.string(),
  turn: z.looseObject({
    id: z.string(),
    status: z.enum(["completed", "interrupted", "failed", "inProgress"]),
    durationMs: z.number().nullable(),
  }),
});

class CodexChatNotInitializedError extends Error {
  constructor() {
    super("Codex chat thread was not initialized");
    this.name = "CodexChatNotInitializedError";
  }
}

function event(message: NativeChatBackendMessage["message"]): NativeChatBackendMessage {
  return { provider: "codex", message };
}

function errorText(error: unknown): string {
  if (error instanceof CodexRpcError) return `${error.message}: ${error.method}: ${error.rpcMessage}`;
  return error instanceof Error ? error.message : String(error);
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
  const common = {
    cwd: opts.cwd,
    approvalPolicy: "never",
    sandbox: "workspace-write",
    developerInstructions: opts.systemPrompt,
    model: opts.model,
  };
  const raw = opts.resumeSessionId === undefined
    ? await server.request({ method: "thread/start", params: { ...common, ephemeral: false, sessionStartSource: "startup" } })
    : await server.request({ method: "thread/resume", params: { ...common, threadId: opts.resumeSessionId } });
  return threadSchema.parse(raw).thread.id;
}

function waitForTurn(options: {
  server: CodexAppServer;
  queue: ReturnType<typeof createAsyncIterableQueue<NativeChatBackendMessage>>;
  threadId: string;
  turnId: string;
  setActiveTurn(id: string | null): void;
}): Promise<void> {
  return new Promise((resolve) => {
    const remove = options.server.onNotification((notification) => {
      if (notification.method === "item/completed") {
        const parsed = itemSchema.safeParse(notification.params);
        if (!parsed.success || parsed.data.turnId !== options.turnId) return;
        const { item } = parsed.data;
        if (item.type === "agentMessage" && item.text !== undefined) {
          options.queue.push(event({
            type: "assistant",
            session_id: options.threadId,
            message: { role: "assistant", content: [{ type: "text", text: item.text }] },
          }));
        }
        return;
      }
      if (notification.method !== "turn/completed") return;
      const parsed = completedSchema.safeParse(notification.params);
      if (!parsed.success || parsed.data.turn.id !== options.turnId) return;
      if (parsed.data.turn.status === "inProgress") return;
      remove();
      options.setActiveTurn(null);
      options.queue.push(event({
        type: "result",
        subtype: parsed.data.turn.status,
        session_id: options.threadId,
        is_error: parsed.data.turn.status !== "completed",
        duration_ms: parsed.data.turn.durationMs ?? 0,
        num_turns: 1,
      }));
      resolve();
    });
  });
}

function createRun(opts: ChatBackendStartOptions): ChatBackendRun {
  const queue = createAsyncIterableQueue<NativeChatBackendMessage>();
  const server = new CodexAppServer({ cwd: opts.cwd, env: opts.env });
  let activeTurnId: string | null = null;
  let threadId: string | null = null;
  let chain = server.initialize().then(async () => {
    threadId = await openThread(server, opts);
    queue.push(event({ type: "system", subtype: "init", session_id: threadId }));
  });
  const run: ChatBackendRun = {
    closed: false,
    messages: queue.iterable,
    send(content): void {
      if (run.closed) return;
      chain = chain.then(async () => {
        if (threadId === null) throw new CodexChatNotInitializedError();
        queue.push(event({ type: "user", session_id: threadId, message: { role: "user", content } }));
        const raw = await server.request({
          method: "turn/start",
          params: {
            threadId,
            input: codexInput(content),
            cwd: opts.cwd,
            approvalPolicy: "never",
            model: opts.model,
            sandboxPolicy: {
              type: "workspaceWrite",
              writableRoots: [opts.cwd, ...(opts.additionalDirectories ?? [])],
              networkAccess: true,
              excludeTmpdirEnvVar: false,
              excludeSlashTmp: false,
            },
          },
        });
        activeTurnId = turnSchema.parse(raw).turn.id;
        await waitForTurn({ server, queue, threadId, turnId: activeTurnId, setActiveTurn: (id) => { activeTurnId = id; } });
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
      if (threadId === null || activeTurnId === null) return;
      await server.request({ method: "turn/interrupt", params: { threadId, turnId: activeTurnId }, timeoutMs: 10_000 });
    },
    async close(): Promise<void> {
      if (run.closed) return;
      await chain;
      run.closed = true;
      server.close();
      queue.end();
    },
  };
  return run;
}

export function createCodexChatBackend(): ChatBackend {
  return { start: createRun };
}
