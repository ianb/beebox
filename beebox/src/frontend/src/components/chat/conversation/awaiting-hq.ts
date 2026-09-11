/**
 * Finishing a voice send that a reload interrupted while it waited for its HQ
 * transcript (`docs/plans/resilient-voice-recording.md`, Track 4). The saved
 * row holds the realtime emission staged when the segment ended; the user
 * picks "Send HQ transcript" (claim) or "Send live text" (fallBack, which
 * answers with the HQ result instead if it is already ready). Nothing here
 * sends — the caller dispatches the returned emission through the row's
 * original destination.
 */

import type { Emission } from "../../../input/emission";
import { prepareVoiceSubmitEmission } from "../../../input/voice-intent";
import { sendKeywordIn } from "../../../lib/audio/speech-keywords";
import { outcomeOfClaim, outcomeOfFallBack, type HqWaitDeps, type HqWaitOutcome } from "../../../lib/audio/hq-wait";
import type { PendingConversationSend } from "./pending-sends";

export type AwaitingHqChoice = "hq" | "live";

export type AwaitingHqResolution =
  /** `outcome` lets the caller raise a permanent failure's notice. */
  | { kind: "send"; emission: Emission; outcome: HqWaitOutcome }
  /** "Send HQ transcript" raced a status change: the result is not ready. */
  | { kind: "not-ready" };

export async function resolveAwaitingHq(opts: {
  row: PendingConversationSend;
  recordingId: string;
  choice: AwaitingHqChoice;
  box: Pick<HqWaitDeps, "claim" | "fallBack">;
}): Promise<AwaitingHqResolution> {
  const { row, recordingId, choice, box } = opts;
  const emissionId = row.emission.id;
  let outcome: HqWaitOutcome;
  if (choice === "hq") {
    const claimed = outcomeOfClaim(await box.claim({ recordingId, emissionId }), null);
    if (claimed === null) return { kind: "not-ready" };
    outcome = claimed;
  } else {
    outcome = outcomeOfFallBack(await box.fallBack({ recordingId, emissionId }), { reason: "user", service: null });
  }
  const emission = prepareVoiceSubmitEmission({ realtime: row.emission, outcome, keyword: sendKeywordIn(row.emission.text) });
  return { kind: "send", emission, outcome };
}
