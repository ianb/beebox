/**
 * One live Claude Agent SDK query as a `ChatBackendRun`: the input queue, the
 * pump that publishes the assigned session id, and the two ways to end it.
 */

import type { Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { cleanupSessionIdFile, writeSessionIdFile } from "../../core/chat/session/id-file.js";
import { toSdkUserContent } from "../claude-chat-content.js";
import type { createAsyncIterableQueue } from "../claude-chat-queue.js";
import type { ChatBackendRun, ChatBackendSendOptions, ChatBackendStartOptions, ChatContentBlock } from "../claude-chat-types.js";

/** Pull a string `session_id` off a raw SDK message, or null if absent. */
function messageSessionId(msg: SDKMessage): string | null {
  if ("session_id" in msg && typeof msg.session_id === "string" && msg.session_id.length > 0) {
    return msg.session_id;
  }
  return null;
}

/** Wrap a live SDK query in the backend run interface. */
export function buildRunFromQuery(params: {
  q: Pick<Query, "interrupt" | "close"> & AsyncIterable<SDKMessage>;
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
    send(content: ChatContentBlock[], options?: ChatBackendSendOptions): void {
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
        // Text the user did not type: the CLI must not expand `@path`
        // mentions in it into file attachments.
        ...(options?.clientComposed === true ? { client_composed: true as const } : {}),
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
    async abort(): Promise<void> {
      if (run.closed) return;
      inputQueue.end();
      q.close();
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
