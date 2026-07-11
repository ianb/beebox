/**
 * Claude chat backend — wraps `@anthropic-ai/claude-agent-sdk`'s `query()`
 * for long-lived bidirectional chat sessions. The chat session pushes user
 * messages and consumes SDK message events, one turn after another, against
 * a single SDK query handle.
 *
 * Real implementation calls `query()` and adapts SDKMessage events into a
 * stream the chat session iterates.
 *
 * Fake implementation lets tests script messages onto the stream and
 * inspect what was sent.
 *
 * The interface stays narrow: start a run, push user content, iterate
 * messages, interrupt or close. Renaming/replacing of session id and
 * resume semantics live one level up in `ChatSession`.
 */

import {
  query,
  startup,
  type Options,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type WarmQuery,
} from "@anthropic-ai/claude-agent-sdk";
import { cardValidatorHook, gitMvNudgeHook } from "../core/sdk-hooks.js";
import { resolveClaudeCodeBinary } from "../core/sdk-binary-path.js";
import { dropUndefined } from "../lib/drop-undefined.js";
import { createAsyncIterableQueue } from "./claude-chat-queue.js";
import {
  CB_CHAT_SESSION_ID_ENV,
  CB_CHAT_SESSION_ID_FILE_ENV,
  allocateSessionIdFilePath,
  cleanupSessionIdFile,
  writeSessionIdFile,
} from "../core/chat/session/session-id-file.js";

// Fake implementation lives in a sibling; re-exported here so the public
// surface stays a single module.
export {
  createFakeChatBackend,
  type FakeChatBackend,
  type FakeChatBackendRun,
} from "./claude-chat-fake.js";

// ─── Backend interface ───────────────────────────────────────────────────────

/** Content blocks accepted by `ChatBackendRun.send()`. */
export type ChatContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64" | "url";
        media_type?: string;
        data?: string;
        url?: string;
      };
    };

export interface ChatBackendStartOptions {
  /** Working directory for the underlying SDK subprocess. */
  cwd: string;
  /**
   * Extra directories the agent can read/write beyond `cwd`. Equivalent to
   * the CLI's `--add-dir`. Landmark sessions set `cwd` to the landmark dir
   * and add the box root here so the agent retains full box access.
   */
  additionalDirectories?: string[] | undefined;
  /** Appended to the `claude_code` system-prompt preset. */
  systemPrompt: string;
  /** If set, resumes the given SDK session; otherwise a fresh session. */
  resumeSessionId?: string | undefined;
  /** Pin to a specific model; omit for SDK default. */
  model?: string | undefined;
  /**
   * If true, the SDK emits `stream_event` (`SDKPartialAssistantMessage`)
   * messages as the model streams its response. Off by default to keep
   * the message rate low.
   */
  includePartialMessages?: boolean | undefined;
  /** Subprocess env. Keys with undefined values are dropped. */
  env: Record<string, string | undefined>;
}

export interface ChatBackendRun {
  /** Push a user message into the running query. */
  send(content: ChatContentBlock[]): void;
  /** Async iterable of SDK message events. Iterate exactly once per run. */
  messages: AsyncIterable<SDKMessage>;
  /** Interrupt the in-progress turn, if any. */
  interrupt(): Promise<void>;
  /**
   * End the conversation gracefully — the messages iterator will return.
   * Idempotent.
   */
  close(): Promise<void>;
  /** True after the messages iterator has returned (close or end-of-query). */
  closed: boolean;
}

export interface ChatBackend {
  start(opts: ChatBackendStartOptions): ChatBackendRun;
  /**
   * Pre-warm a Claude subprocess against `opts` so the next `start()` with
   * compatible options skips spawn + initialize latency. Compatibility means:
   * same `cwd`, same `systemPrompt`, no `resumeSessionId`,
   * and matching `includePartialMessages`/`model`. The warm slot is
   * single-use; the backend re-warms automatically after consumption.
   *
   * Idempotent (only one slot is held at a time). Optional — fakes don't
   * have to implement it.
   */
  prewarm?(opts: ChatBackendStartOptions): Promise<void>;
}

// ─── Real implementation ─────────────────────────────────────────────────────

/** Pull a string `session_id` off a raw SDK message, or null if absent. */
function messageSessionId(msg: SDKMessage): string | null {
  if ("session_id" in msg && typeof msg.session_id === "string" && msg.session_id.length > 0) {
    return msg.session_id;
  }
  return null;
}

/**
 * Build SDK Options from a ChatBackendStartOptions for either `query()` or
 * `startup()` calls. Pulled out so the warm-pool path uses the same shape.
 *
 * Also mints the per-subprocess session-id file for a fresh (non-resume)
 * spawn whose id isn't known until after start: the path is injected as
 * `CB_CHAT_SESSION_ID_FILE` and returned so the run's pump can write the id
 * into it once the SDK assigns one. Resumes (id already in env as
 * `CB_CHAT_SESSION_ID`) and any spawn that already carries the id skip it.
 */
function buildQueryOptions(
  opts: ChatBackendStartOptions,
): { queryOptions: Options; sessionIdFilePath: string | null } {
  const env = dropUndefined(opts.env);
  let sessionIdFilePath: string | null = null;
  if (opts.resumeSessionId === undefined && env[CB_CHAT_SESSION_ID_ENV] === undefined) {
    sessionIdFilePath = allocateSessionIdFilePath();
    env[CB_CHAT_SESSION_ID_FILE_ENV] = sessionIdFilePath;
  }
  const queryOptions: Options = {
    cwd: opts.cwd,
    env,
    permissionMode: "bypassPermissions",
    systemPrompt: {
      type: "preset" as const,
      preset: "claude_code" as const,
      append: opts.systemPrompt,
    },
  };
  if (opts.additionalDirectories && opts.additionalDirectories.length > 0) {
    queryOptions.additionalDirectories = opts.additionalDirectories;
  }
  const binaryPath = resolveClaudeCodeBinary();
  if (binaryPath !== null) {
    queryOptions.pathToClaudeCodeExecutable = binaryPath;
  }
  if (opts.resumeSessionId !== undefined) {
    queryOptions.resume = opts.resumeSessionId;
  }
  if (opts.model !== undefined) {
    queryOptions.model = opts.model;
  }
  queryOptions.hooks = { PreToolUse: [gitMvNudgeHook()], PostToolUse: [cardValidatorHook()] };
  if (opts.includePartialMessages === true) {
    queryOptions.includePartialMessages = true;
  }
  return { queryOptions, sessionIdFilePath };
}

/**
 * Whether a `start()` call's options are compatible with a pre-warmed slot.
 * The warm subprocess has its options baked in, so we only consume it if
 * everything that affects the subprocess (cwd, system prompt, model,
 * partial-messages, no resume) matches.
 */
function warmCompatible(
  warm: ChatBackendStartOptions,
  next: ChatBackendStartOptions,
): boolean {
  if (next.resumeSessionId !== undefined) return false;
  if (warm.cwd !== next.cwd) return false;
  if (warm.systemPrompt !== next.systemPrompt) return false;
  if ((warm.model ?? null) !== (next.model ?? null)) return false;
  if (warm.includePartialMessages !== next.includePartialMessages) return false;
  const wd = warm.additionalDirectories ?? [];
  const nd = next.additionalDirectories ?? [];
  if (wd.length !== nd.length) return false;
  for (const [i, dir] of wd.entries()) {
    if (dir !== nd[i]) return false;
  }
  return true;
}

export function createChatBackend(): ChatBackend {
  let warmSlot:
    | { warmQuery: WarmQuery; opts: ChatBackendStartOptions; sessionIdFilePath: string | null }
    | null = null;
  let warming: Promise<void> | null = null;

  function startWarming(opts: ChatBackendStartOptions): Promise<void> {
    if (warming !== null) return warming;
    if (warmSlot !== null) return Promise.resolve();
    warming = (async (): Promise<void> => {
      try {
        const { queryOptions, sessionIdFilePath } = buildQueryOptions(opts);
        const wq = await startup({ options: queryOptions });
        warmSlot = { warmQuery: wq, opts, sessionIdFilePath };
      } catch (e) {
        // Warming is best-effort; the next start() will fall back to a cold spawn.
        console.warn("Chat backend warm-up failed, will cold-spawn on next start:", e);
      } finally {
        warming = null;
      }
    })();
    return warming;
  }

  function buildRunFromQuery(params: {
    q: Query;
    opts: ChatBackendStartOptions;
    inputQueue: ReturnType<typeof createAsyncIterableQueue<SDKUserMessage>>;
    messageQueue: ReturnType<typeof createAsyncIterableQueue<SDKMessage>>;
    /** File to write the SDK-assigned session id into, or null (resume). */
    sessionIdFilePath: string | null;
  }): ChatBackendRun {
    const { q, opts, inputQueue, messageQueue, sessionIdFilePath } = params;
    const run: ChatBackendRun = {
      closed: false,
      messages: messageQueue.iterable,
      send(content: ChatContentBlock[]): void {
        if (run.closed) return;
        // eslint-disable-next-line no-restricted-syntax -- adapter boundary: our ChatContentBlock is intentionally looser than the SDK's ContentBlockParam (message.content), so the literal can't `satisfies` SDKUserMessage; sound because our blocks serialize to valid SDK content
        inputQueue.push({
          type: "user",
          message: { role: "user", content },
          session_id: opts.resumeSessionId ?? "",
          parent_tool_use_id: null,
        } as SDKUserMessage);
      },
      async interrupt(): Promise<void> {
        if (run.closed) return;
        await q.interrupt();
      },
      async close(): Promise<void> {
        if (run.closed) return;
        inputQueue.end();
        await pump.catch(() => {
          // Errors already surface via the messages iterator.
        });
      },
    };

    const pump = (async (): Promise<void> => {
      let sessionIdWritten = false;
      try {
        for await (const msg of q) {
          // Publish the SDK-assigned session id to the per-subprocess file the
          // moment it first appears, so a mid-turn `cb chat screenshot` in this
          // subprocess can target this exact conversation (new sessions only —
          // resumes carry the id in env and get no file).
          if (!sessionIdWritten && sessionIdFilePath !== null) {
            const id = messageSessionId(msg);
            if (id !== null) {
              writeSessionIdFile(sessionIdFilePath, id);
              sessionIdWritten = true;
            }
          }
          messageQueue.push(msg);
        }
      } finally {
        messageQueue.end();
        run.closed = true;
        if (sessionIdFilePath !== null) cleanupSessionIdFile(sessionIdFilePath);
      }
    })();
    pump.catch(() => {
      // messageQueue.end() already ran in the finally.
    });

    return run;
  }

  return {
    async prewarm(opts: ChatBackendStartOptions): Promise<void> {
      await startWarming(opts);
    },
    start(opts: ChatBackendStartOptions): ChatBackendRun {
      const inputQueue = createAsyncIterableQueue<SDKUserMessage>();
      const messageQueue = createAsyncIterableQueue<SDKMessage>();

      // Try to consume the warm slot if it matches.
      if (warmSlot !== null && warmCompatible(warmSlot.opts, opts)) {
        const consumed = warmSlot;
        warmSlot = null;
        const q = consumed.warmQuery.query(inputQueue.iterable);
        // Re-warm in the background using the same options we just consumed.
        void startWarming(consumed.opts);
        // Use the warm subprocess's OWN baked file path, not this call's opts:
        // warm reuse keeps the prewarmed env, so the consuming session's env
        // never reaches the subprocess (see session-id-file.ts).
        return buildRunFromQuery({
          q,
          opts,
          inputQueue,
          messageQueue,
          sessionIdFilePath: consumed.sessionIdFilePath,
        });
      }

      // Cold path: drop a stale warm slot if its options don't match this
      // start (we'd never use it for a different cwd/prompt). Caller can
      // re-prewarm later if they want another slot.
      if (warmSlot !== null) {
        warmSlot.warmQuery.close();
        warmSlot = null;
      }

      const { queryOptions, sessionIdFilePath } = buildQueryOptions(opts);
      const q: Query = query({
        prompt: inputQueue.iterable,
        options: queryOptions,
      });
      return buildRunFromQuery({ q, opts, inputQueue, messageQueue, sessionIdFilePath });
    },
  };
}
