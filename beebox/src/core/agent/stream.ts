/**
 * SDK query-stream consumption for the agent runner.
 *
 * The SDK's message stream only ends when the spawned Claude Code process
 * exits. The `result` message is the stream's terminal *message*, so once it
 * arrives we treat the run as complete: we give the CLI a short grace period
 * to exit on its own (sub-second in healthy runs), then dispose the query —
 * which closes the transport and kills the subprocess. Without this, a
 * lingering CLI makes a successful run look like a failure when the
 * scheduler's timeout eventually SIGKILLs the whole tree.
 */

import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { fmt } from "../../lib/format.js";
import { renderSdkMessage } from "./render.js";
import { stopPromptLogger, type PromptLogger } from "./prompt-logger.js";

/** How long after the result message the CLI gets to exit by itself. */
const STREAM_END_GRACE_MS = 10_000;
/** How long disposing the query may take before we stop waiting on it. */
const DISPOSE_GRACE_MS = 5_000;

type SDKResultMessage = Extract<SDKMessage, { type: "result" }>;

export interface RunStreamOutcome {
  outputBuf: string;
  resultMessage: SDKResultMessage | null;
  assignedSessionId: string | null;
  errorText: string | null;
  /** At least one assistant message arrived, including thinking/tool use. */
  hadAssistantActivity: boolean;
}

export interface ConsumeStreamOptions {
  prompt: string;
  queryOptions: Record<string, unknown>;
  onOutput?: ((text: string) => void) | undefined;
  onSessionId?: ((id: string) => void) | undefined;
  logger: PromptLogger | null;
}

const DEADLINE = Symbol("deadline");

/**
 * Race a promise against a deadline. The timer never holds the event loop
 * open and is cleared as soon as the race settles.
 */
async function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | typeof DEADLINE> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<typeof DEADLINE>((resolve) => {
        timer = setTimeout(() => resolve(DEADLINE), ms);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Dispose the query: `Query.return()` runs the SDK's cleanup (closes the
 * transport, which SIGTERMs the CLI with a SIGKILL fallback) before
 * resolving. Bounded because we may dispose while a `next()` is pending.
 */
async function disposeQuery(q: Query): Promise<void> {
  try {
    await withDeadline(q.return(), DISPOSE_GRACE_MS);
  } catch (e) {
    // The run already has its result; a dispose error only means the CLI
    // resisted graceful shutdown. The SDK's process-exit handler still
    // SIGTERMs any survivor, so log and move on.
    console.error(`agent: error disposing SDK query: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Drive the SDK query stream to completion: render each message, capture the
 * session id and final result, and surface any thrown error as text. After
 * the result message, waits at most STREAM_END_GRACE_MS for the stream to
 * end naturally before disposing the query.
 */
export async function consumeAgentStream(
  options: ConsumeStreamOptions,
): Promise<RunStreamOutcome> {
  const { onOutput } = options;
  let outputBuf = "";
  let resultMessage: SDKResultMessage | null = null;
  let assignedSessionId: string | null = null;
  let errorText: string | null = null;
  let hadAssistantActivity = false;

  const handleMessage = (msg: SDKMessage): void => {
    if (msg.type === "system" && msg.subtype === "init" && assignedSessionId === null) {
      assignedSessionId = msg.session_id;
      options.onSessionId?.(msg.session_id);
    }
    if (msg.type === "assistant") hadAssistantActivity = true;
    const rendered = renderSdkMessage(msg);
    if (rendered) {
      outputBuf += rendered;
      onOutput?.(rendered);
    }
  };

  try {
    // Dynamic: the SDK is a heavy module, and this file sits behind the
    // `core/commands` graph that nearly every `bbx` command pulls in — so a
    // static import made the SDK load for commands that never run an agent
    // (the pre-commit hook among them). Node caches the module, so a real
    // agent run pays the load once. (docs/plans/commit-performance.md, 1b.)
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const q = query({
      prompt: options.prompt,
      options: options.queryOptions,
    });

    const iterator: AsyncIterator<SDKMessage> = q[Symbol.asyncIterator]();
    for (;;) {
      const next: IteratorResult<SDKMessage> | typeof DEADLINE =
        resultMessage === null
          ? await iterator.next()
          : await withDeadline(iterator.next(), STREAM_END_GRACE_MS);
      if (next === DEADLINE) {
        onOutput?.(fmt.dim(
          `(claude did not exit within ${String(STREAM_END_GRACE_MS / 1000)}s of its result — terminating it)\n`,
        ));
        await disposeQuery(q);
        break;
      }
      if (next.done === true) break;
      if (next.value.type === "result") {
        resultMessage = next.value;
      }
      handleMessage(next.value);
    }
  } catch (e) {
    errorText = e instanceof Error ? e.message : String(e);
  } finally {
    if (options.logger) stopPromptLogger(options.logger);
  }

  return { outputBuf, resultMessage, assignedSessionId, errorText, hadAssistantActivity };
}
