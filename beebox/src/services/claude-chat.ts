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
import { gitMvNudgeHook } from "../core/sdk-hooks.js";
import { resolveClaudeCodeBinary } from "../core/sdk-binary-path.js";
import { dropUndefined } from "../lib/drop-undefined.js";
import { createAsyncIterableQueue } from "./claude-chat-queue.js";
import {
  allocateSessionIdFilePath,
  cleanupSessionIdFile,
  writeSessionIdFile,
} from "../core/chat/session/session-id-file.js";
import { toSdkUserContent } from "./claude-chat-content.js";
import { resolveHarnessPluginPath } from "../core/agent/plugin-paths.js";
import { createCodexChatBackend } from "./codex-chat.js";
import type {
  ChatBackend,
  ChatBackendRun,
  ChatBackendStartOptions,
  ChatContentBlock,
} from "./claude-chat-types.js";

const BBX_CHAT_SESSION_ID_ENV = "BBX_CHAT_SESSION_ID";
const BBX_CHAT_SESSION_ID_FILE_ENV = "BBX_CHAT_SESSION_ID_FILE";

// The interface, content-block, and options types live in a leaf module so the
// real impl (here) and the fake can share them without a value cycle. Re-exported
// here so the public surface stays a single module.
export type {
  ChatBackend,
  ChatBackendRun,
  ChatBackendStartOptions,
  ChatContentBlock,
} from "./claude-chat-types.js";

// Fake implementation lives in a sibling; re-exported here so the public
// surface stays a single module.
export {
  createFakeChatBackend,
  type FakeChatBackend,
  type FakeChatBackendRun,
} from "./claude-chat-fake.js";

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
 * `BBX_CHAT_SESSION_ID_FILE` and returned so the run's pump can write the id
 * into it once the SDK assigns one. Resumes (id already in env as
 * `BBX_CHAT_SESSION_ID`) and any spawn that already carries the id skip it.
 */
export function buildQueryOptions(
  opts: ChatBackendStartOptions,
): { queryOptions: Options; sessionIdFilePath: string | null } {
  const env = dropUndefined(opts.env);
  let sessionIdFilePath: string | null = null;
  // A coined id is known before the spawn, so it rides `BBX_CHAT_SESSION_ID`
  // like a resume does (`core/chat/session/start.ts` sets it) and needs no
  // post-spawn file. The file exists only for the case it was built for: an
  // id that does not exist until the harness reports it.
  if (opts.resumeSessionId === undefined && env[BBX_CHAT_SESSION_ID_ENV] === undefined) {
    sessionIdFilePath = allocateSessionIdFilePath();
    env[BBX_CHAT_SESSION_ID_FILE_ENV] = sessionIdFilePath;
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
  if (opts.coinedSessionId !== undefined) {
    queryOptions.sessionId = opts.coinedSessionId;
  }
  if (opts.model !== undefined) {
    queryOptions.model = opts.model;
  }
  if (opts.tools !== undefined) {
    queryOptions.tools = opts.tools;
  }
  queryOptions.hooks = { PreToolUse: [gitMvNudgeHook()] };
  queryOptions.plugins = [{
    type: "local",
    path: resolveHarnessPluginPath("claude"),
    skipMcpDiscovery: true,
  }];
  if (opts.includePartialMessages === true) {
    queryOptions.includePartialMessages = true;
  }
  return { queryOptions, sessionIdFilePath };
}

/**
 * Whether a `start()` call's options are compatible with a pre-warmed slot.
 * Exported for `test/services/service-claude-chat.doctest.md`: this and
 * `warmSlotKey` are the warm pool's whole decision surface, and getting either
 * wrong hands a chat a subprocess baked for a different conversation.
 * The warm subprocess has its options baked in, so we only consume it if
 * everything that affects the subprocess (cwd, system prompt, model,
 * partial-messages, no resume) matches.
 */
export function warmCompatible(
  warm: ChatBackendStartOptions,
  next: ChatBackendStartOptions,
): boolean {
  if (next.resumeSessionId !== undefined) return false;
  // A warm slot's session id is baked into its subprocess at spawn, so a slot
  // may only serve the chat it was warmed for — and a slot warmed with no id
  // may only serve a chat that brings none.
  if ((warm.coinedSessionId ?? null) !== (next.coinedSessionId ?? null)) return false;
  if (warm.cwd !== next.cwd) return false;
  if (warm.systemPrompt !== next.systemPrompt) return false;
  if ((warm.model ?? null) !== (next.model ?? null)) return false;
  if (warm.includePartialMessages !== next.includePartialMessages) return false;
  // The tool set is baked into the warm subprocess, so a slot warmed with a
  // different one would silently widen (or narrow) the next session. Absent and
  // empty are compared as different things on purpose: omitting the option
  // means "all built-in tools", `[]` means none.
  const wt = warm.tools;
  const nt = next.tools;
  if ((wt === undefined) !== (nt === undefined)) return false;
  if (wt !== undefined && nt !== undefined) {
    if (wt.length !== nt.length) return false;
    for (const [i, tool] of wt.entries()) {
      if (tool !== nt[i]) return false;
    }
  }
  const wd = warm.additionalDirectories ?? [];
  const nd = next.additionalDirectories ?? [];
  if (wd.length !== nd.length) return false;
  for (const [i, dir] of wd.entries()) {
    if (dir !== nd[i]) return false;
  }
  return true;
}

/**
 * A warm subprocess is keyed by the chat it can serve, because the session id
 * is baked into it at spawn (`--session-id`). The unkeyed slot — `""` — is the
 * speculative one: it serves whichever chat sends next without bringing an id
 * of its own (the legacy `"new"` send, or a Codex box).
 */
export function warmSlotKey(opts: ChatBackendStartOptions): string {
  return opts.coinedSessionId ?? "";
}

/**
 * How many warm subprocesses to hold at once. One speculative slot plus one
 * chat the user has open but has not written in yet is the shape this is sized
 * for; beyond that, an open tab is not worth a subprocess.
 */
const MAX_WARM_SLOTS = 2;

function createClaudeChatBackend(): ChatBackend {
  interface WarmSlot {
    warmQuery: WarmQuery;
    opts: ChatBackendStartOptions;
    sessionIdFilePath: string | null;
  }
  const warmSlots = new Map<string, WarmSlot>();
  const warming = new Map<string, Promise<void>>();
  // Bumped by closeWarm() to abandon an in-flight startup(): the warming
  // continuation installs its fresh WarmQuery only if the epoch is unchanged,
  // otherwise it closes it immediately. Covers the consume-then-re-warm path
  // in start() too — a closeWarm during that background re-warm wins.
  let warmEpoch = 0;

  function startWarming(opts: ChatBackendStartOptions): Promise<void> {
    const key = warmSlotKey(opts);
    const inFlight = warming.get(key);
    if (inFlight !== undefined) return inFlight;
    if (warmSlots.has(key)) return Promise.resolve();
    // Over the cap, the chat simply cold-spawns on its first message — the
    // state every chat was in before warming existed.
    if (warmSlots.size + warming.size >= MAX_WARM_SLOTS) return Promise.resolve();
    const epochAtStart = warmEpoch;
    const pending = (async (): Promise<void> => {
      try {
        const { queryOptions, sessionIdFilePath } = buildQueryOptions(opts);
        const wq = await startup({ options: queryOptions });
        if (warmEpoch !== epochAtStart) {
          // closeWarm() ran while we were warming — abandon this slot rather
          // than installing a process nobody asked to keep.
          wq.close();
        } else {
          warmSlots.set(key, { warmQuery: wq, opts, sessionIdFilePath });
        }
      } catch (e) {
        // Warming is best-effort; the next start() will fall back to a cold spawn.
        console.warn("Chat backend warm-up failed, will cold-spawn on next start:", e);
      } finally {
        warming.delete(key);
      }
    })();
    warming.set(key, pending);
    return pending;
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
        // Narrow our loose ChatContentBlock into the SDK's strict
        // ContentBlockParam, throwing on a malformed image rather than casting
        // it through (see claude-chat-content.ts). No cast: the converted
        // content makes the literal a valid SDKUserMessage.
        inputQueue.push({
          type: "user",
          message: { role: "user", content: toSdkUserContent(content) },
          session_id: opts.resumeSessionId ?? "",
          parent_tool_use_id: null,
        });
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
          // moment it first appears, so a mid-turn `bbx chat screenshot` in this
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
    requiresClaudeAuth: true,
    async prewarm(opts: ChatBackendStartOptions): Promise<void> {
      await startWarming(opts);
    },
    closeWarmFor(sessionId: string): void {
      const slot = warmSlots.get(sessionId);
      if (slot === undefined) return;
      slot.warmQuery.close();
      warmSlots.delete(sessionId);
    },
    closeWarm(): void {
      // Bump the epoch so any in-flight startup() abandons its result when it
      // lands (see startWarming), then drop every slot we're already holding.
      warmEpoch += 1;
      for (const slot of warmSlots.values()) slot.warmQuery.close();
      warmSlots.clear();
    },
    hasWarm(): boolean {
      // Answers for the speculative slot specifically: the registry uses this
      // to decide whether the box still has one to offer the next send, and a
      // subprocess reserved for one particular chat is not that.
      return warmSlots.has("") || warming.has("");
    },
    start(opts: ChatBackendStartOptions): ChatBackendRun {
      const inputQueue = createAsyncIterableQueue<SDKUserMessage>();
      const messageQueue = createAsyncIterableQueue<SDKMessage>();

      // Try to consume the warm slot for this chat, if it matches.
      const key = warmSlotKey(opts);
      const slot = warmSlots.get(key);
      if (slot !== undefined && warmCompatible(slot.opts, opts)) {
        const consumed = slot;
        warmSlots.delete(key);
        const q = consumed.warmQuery.query(inputQueue.iterable);
        // Re-warm only the speculative slot. Re-warming a coined one would
        // spawn a subprocess for a conversation that now exists, and the
        // harness refuses a session id it has already written.
        if (key === "") void startWarming(consumed.opts);
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

      // Cold path: drop this key's stale slot if its options don't match the
      // start (we'd never use it for a different cwd/prompt). Only this key's
      // — another chat's reserved subprocess is still exactly right for it.
      if (slot !== undefined) {
        slot.warmQuery.close();
        warmSlots.delete(key);
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

/** Dispatch each engine-pinned chat to its native harness backend. */
export function createChatBackend(): ChatBackend {
  const claude = createClaudeChatBackend();
  const codex = createCodexChatBackend();
  return {
    requiresClaudeAuth: true,
    requiresCodexAuth: true,
    start: (opts) => opts.engine === "codex" ? codex.start(opts) : claude.start(opts),
    prewarm: async (opts) => {
      if (opts.engine !== "codex") await claude.prewarm?.(opts);
    },
    closeWarm: () => claude.closeWarm?.(),
    closeWarmFor: (sessionId) => claude.closeWarmFor?.(sessionId),
    hasWarm: () => claude.hasWarm?.() ?? false,
  };
}
