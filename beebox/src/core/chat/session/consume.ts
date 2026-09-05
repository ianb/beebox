/**
 * The SDK message-pump skeleton shared in shape by ChatSession and
 * ChatThreadSession: iterate a run's messages, adapt each, hand it to the
 * session, surface iterator errors as an "error" signal, and run a teardown
 * step in a `finally` when the run ends. The per-message and teardown bodies
 * differ between the two sessions (durability, queue draining, chat-response
 * extraction), so those stay as callbacks — this owns only the try/catch/finally
 * scaffolding, which was duplicated verbatim.
 */

import type { ChatBackendRun } from "../../../services/claude-chat.js";
import { adaptBackendMessage, type ChatMessage } from "./messages.js";
import type { ChatBackendMessage } from "../../../services/claude-chat-types.js";

export interface PumpChatRunOptions {
  run: ChatBackendRun;
  /** Adapt a raw SDK message; returning null drops it (partial/internal event). */
  adapt: (sdkMsg: ChatBackendMessage) => ChatMessage | null;
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

/**
 * The `ChatSession` half of the pump: durability gating, the turn marker, and
 * the run-ended teardown (lifecycle reset, lock release, queue drain). Lives
 * here rather than inline in `ChatSession` because that class is at its size
 * cap and this is pump wiring, not session policy — the host below is the whole
 * of what it touches.
 */
export interface ChatRunPumpHost {
  /** Gate that holds a `result` until the transcript flush lands on disk. */
  durability: { observe: (msg: ChatMessage) => void; awaitDurability: () => Promise<void> };
  boxRoot: string;
  getSessionId: () => string | null;
  /** Record the "since my last reply" marker before the queue drains. */
  recordTurnMarker: (sessionId: string) => Promise<void>;
  handleMessage: (msg: ChatMessage) => void;
  /** True while the run is being closed on purpose — suppresses the drain. */
  isStopping: () => boolean;
  /** Return the lifecycle to idle unless it is already there. */
  toIdle: () => void;
  releaseRunLock: () => Promise<void>;
  emitError: (err: Error) => void;
  emitClose: (code: number | null) => void;
  queueLength: () => number;
  drainQueue: () => void;
  log: (label: string, msg: string) => void;
}

/** Wire one `ChatSession` run's message stream through its host. */
export function pumpSessionRun(run: ChatBackendRun, host: ChatRunPumpHost): Promise<void> {
  return pumpChatRun({
    run,
    adapt: adaptBackendMessage,
    onMessage: async (msg) => {
      host.durability.observe(msg);
      // Hold `result` until the transcript is flushed: consumers refetch history
      // the moment a turn ends, and the CLI writes the final assistant entry
      // ~150ms *after* emitting result.
      if (msg.type === "result") {
        await host.durability.awaitDurability();
        const sessionId = host.getSessionId();
        if (sessionId) await host.recordTurnMarker(sessionId);
      }
      host.handleMessage(msg);
    },
    onError: (err) => {
      host.log("error", `Run errored: ${err.message}`);
      host.emitError(err);
    },
    onClose: async () => {
      host.log("close", "Run ended");
      const wasIntentional = host.isStopping();
      host.toIdle();
      await host.releaseRunLock();
      host.emitClose(wasIntentional ? 0 : null);
      // Drain any messages queued while the run was busy into a fresh run,
      // unless this was an intentional stop (queue is already cleared).
      if (!wasIntentional && host.queueLength() > 0) {
        host.log("close", `Draining ${host.queueLength()} queued message(s) into fresh run`);
        host.drainQueue();
      }
    },
  });
}
