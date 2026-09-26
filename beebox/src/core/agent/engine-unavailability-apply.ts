/**
 * Wire engine-unavailability recognition into the two engine run paths.
 *
 * `applyEngineUnavailability` post-processes a failed {@link AgentResult}:
 * when the error matches a recognized provider signal it attaches the typed
 * `unavailability`, rewrites `error` to the informative one-liner, and records
 * the machine store. The episode reaches the boxholder as the `engine-quota`
 * health check, never as a notification of its own.
 * `noteEngineUnavailability` is the variant for the chat path, where no
 * AgentResult exists and the human sees the message inline.
 *
 * Design: docs/plans/deferred-recoverable-agent-failures.md
 */

import { getBoxTime } from "../../lib/time.js";
import type { AgentResult } from "./types.js";
import {
  describeEngineUnavailability,
  recognizeEngineUnavailability,
  type EngineProvider,
} from "./engine-unavailability.js";
import { recordEngineUnavailability } from "./engine-availability-store.js";

/**
 * Recognize and record an engine-level failure message. Returns the
 * informative description when recognized, else null. Chat-path variant.
 */
export async function noteEngineUnavailability(options: {
  provider: EngineProvider;
  message: string | null | undefined;
  boxRoot: string;
}): Promise<string | null> {
  const now = getBoxTime(options.boxRoot);
  const unavailability = recognizeEngineUnavailability({ ...options, now });
  if (unavailability === null) return null;
  await recordEngineUnavailability(unavailability);
  return describeEngineUnavailability(unavailability);
}

/**
 * Classify a failed agent run. On a recognized signal: attach the typed
 * field, rewrite the error, and record the store.
 * Unrecognized failures (and successes) pass through untouched. Never
 * throws — a classification-path failure must not mask the run's own error.
 */
export async function applyEngineUnavailability(
  result: AgentResult,
  options: { provider: EngineProvider; boxRoot: string },
): Promise<AgentResult> {
  if (result.success) return result;
  try {
    const now = getBoxTime(options.boxRoot);
    const unavailability = recognizeEngineUnavailability({
      provider: options.provider,
      message: result.error,
      now,
    });
    if (unavailability === null) return result;
    await recordEngineUnavailability(unavailability);
    return { ...result, error: describeEngineUnavailability(unavailability), unavailability };
  } catch (e) {
    console.warn("Engine-unavailability classification failed; keeping the original error:", e);
    return result;
  }
}
