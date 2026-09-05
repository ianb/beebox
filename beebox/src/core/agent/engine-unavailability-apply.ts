/**
 * Wire engine-unavailability recognition into the two engine run paths.
 *
 * `applyEngineUnavailability` post-processes a failed {@link AgentResult}:
 * when the error matches a recognized provider signal it attaches the typed
 * `unavailability`, rewrites `error` to the informative one-liner, records
 * the machine store, and (for batch contexts) announces new episodes to the
 * operator. `noteEngineUnavailability` is the store-only variant for the
 * chat path, where no AgentResult exists and the human sees the message
 * inline.
 *
 * Design: docs/plans/deferred-recoverable-agent-failures.md
 */

import { getBoxTime } from "../../lib/time.js";
import { notifyBoxholder } from "../notify-boxholder.js";
import type { AgentResult } from "./types.js";
import {
  describeEngineUnavailability,
  formatRetryAt,
  recognizeEngineUnavailability,
  type EngineProvider,
  type EngineUnavailability,
} from "./engine-unavailability.js";
import {
  markEngineUnavailabilityNotified,
  recordEngineUnavailability,
} from "./engine-availability-store.js";

const PROVIDER_NAMES: Record<EngineProvider, string> = { codex: "Codex", claude: "Claude" };

async function notifyEpisode(
  boxRoot: string,
  unavailability: EngineUnavailability,
): Promise<void> {
  const name = PROVIDER_NAMES[unavailability.provider];
  const now = getBoxTime(boxRoot);
  await notifyBoxholder(boxRoot, {
    title: `${name} is out of usage quota`,
    body:
      `${name} quota is exhausted until ${formatRetryAt(unavailability.retryAt)}. ` +
      `Scheduled work is deferred until then; chat on ${name}-engine boxes will fail. ` +
      "No action needed unless this recurs.",
    url: "/box/health",
    tag: `engine-unavailable-${unavailability.provider}`,
    name: "engine-unavailable",
    deliver: true,
    now,
  });
  await markEngineUnavailabilityNotified({ provider: unavailability.provider, now });
}

/**
 * Recognize and record an engine-level failure message. Returns the
 * informative description when recognized, else null. Never notifies —
 * chat-path variant.
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
 * field, rewrite the error, record the store, and announce a new episode.
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
    const { shouldNotify } = await recordEngineUnavailability(unavailability);
    if (shouldNotify) {
      try {
        await notifyEpisode(options.boxRoot, unavailability);
      } catch (e) {
        console.warn("Could not notify the boxholder about engine unavailability:", e);
      }
    }
    return { ...result, error: describeEngineUnavailability(unavailability), unavailability };
  } catch (e) {
    console.warn("Engine-unavailability classification failed; keeping the original error:", e);
    return result;
  }
}
