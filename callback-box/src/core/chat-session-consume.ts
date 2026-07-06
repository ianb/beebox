/**
 * The SDK message-pump skeleton shared in shape by ChatSession and
 * ChatThreadSession: iterate a run's messages, adapt each, hand it to the
 * session, surface iterator errors as an "error" signal, and run a teardown
 * step in a `finally` when the run ends. The per-message and teardown bodies
 * differ between the two sessions (durability, queue draining, chat-response
 * extraction), so those stay as callbacks — this owns only the try/catch/finally
 * scaffolding, which was duplicated verbatim.
 */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ChatBackendRun } from "../services/claude-chat.js";
import type { ChatMessage } from "./chat-session-messages.js";

export interface PumpChatRunOptions {
  run: ChatBackendRun;
  /** Adapt a raw SDK message; returning null drops it (partial/internal event). */
  adapt: (sdkMsg: SDKMessage) => ChatMessage | null;
  /** Handle one adapted message. May be async (e.g. await durability). */
  onMessage: (msg: ChatMessage) => Promise<void> | void;
  /** The run's messages iterator threw. */
  onError: (err: Error) => void;
  /** The run ended (gracefully or by error). Runs in `finally`. */
  onClose: () => Promise<void> | void;
}

/** Drive one SDK run's message stream through the supplied callbacks. */
export async function pumpChatRun(opts: PumpChatRunOptions): Promise<void> {
  const { run, adapt, onMessage, onError, onClose } = opts;
  try {
    for await (const sdkMsg of run.messages) {
      const msg = adapt(sdkMsg);
      if (msg === null) continue;
      await onMessage(msg);
    }
  } catch (e) {
    onError(e instanceof Error ? e : new Error(String(e)));
  } finally {
    await onClose();
  }
}
