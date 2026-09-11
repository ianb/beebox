/**
 * Voice-recording GC sweep (`docs/plans/resilient-voice-recording.md`,
 * Track 1). Runs on the same awake-timeout cadence as the capture
 * abandonment sweep (`core/capture/sweep.ts`'s `scheduleAbandonmentSweep`,
 * wired from `webapp/routes/voice-lifecycle.ts`).
 *
 * Deletes a voice session's staging directory:
 * - `VOICE_STAGING_RETENTION_MS` after creation, if it was never sealed
 *   (abandoned recording — closed tab, cancelled before finalize); or
 * - `VOICE_STAGING_RETENTION_MS` after `voice.terminalAt` — see
 *   {@link isVoiceTerminal} for what counts as terminal.
 *
 * `lateDeliveryPending` is a named hook for the next chunk: sessions whose
 * handoff is `late`/`delivering` (so `isVoiceTerminal` never fires for them)
 * are collected here rather than acted on — Track 1's late-delivery chunk
 * re-probes them on this same tick instead of adding a second timer.
 */

import { getBoxTime } from "../../lib/time.js";
import { listStagingSessions, isVoiceSession, type StagingSession } from "../capture/staging-store.js";
import { cleanupStagingSession } from "../capture/staging-teardown.js";
import { isVoiceTerminal } from "./voice-staging.js";

/** How long a voice recording's staging directory survives past "never sealed" or "terminal". */
export const VOICE_STAGING_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface VoiceSweepResult {
  /** Session ids whose staging directory was deleted this pass. */
  deleted: string[];
  /**
   * Session ids sealed with a ready HQ result and a `late`/`delivering`
   * handoff — not yet terminal, and not acted on by this chunk. Named hook
   * point: the late-delivery chunk re-probes these on this same tick.
   */
  lateDeliveryPending: string[];
}

function isPastRetention(opts: { sinceIso: string; now: number }): boolean {
  const { sinceIso, now } = opts;
  return now - new Date(sinceIso).getTime() >= VOICE_STAGING_RETENTION_MS;
}

async function sweepOneVoiceSession(opts: { boxRoot: string; session: StagingSession; now: number }): Promise<{
  deleted: boolean;
  lateDeliveryPending: boolean;
}> {
  const { boxRoot, session, now } = opts;
  const { voice } = session;
  if (voice === undefined) return { deleted: false, lateDeliveryPending: false }; // schema invariant guards this in practice

  if (session.state === "open") {
    if (isPastRetention({ sinceIso: session.createdAt, now })) {
      await cleanupStagingSession({ boxRoot, id: session.id });
      return { deleted: true, lateDeliveryPending: false };
    }
    return { deleted: false, lateDeliveryPending: false };
  }

  if (isVoiceTerminal(voice)) {
    const terminalSince = voice.terminalAt ?? session.lastActivityAt;
    if (isPastRetention({ sinceIso: terminalSince, now })) {
      await cleanupStagingSession({ boxRoot, id: session.id });
      return { deleted: true, lateDeliveryPending: false };
    }
    return { deleted: false, lateDeliveryPending: false };
  }

  const pendingLateDelivery = voice.handoff.mode === "late" || voice.handoff.mode === "delivering";
  return { deleted: false, lateDeliveryPending: pendingLateDelivery };
}

/** Sweep one box's voice staging sessions once. Idempotent and safe to double-fire. */
export async function sweepVoiceSessions(opts: { boxRoot: string }): Promise<VoiceSweepResult> {
  const { boxRoot } = opts;
  const now = getBoxTime(boxRoot).getTime();
  const sessions = (await listStagingSessions({ boxRoot })).filter(isVoiceSession);
  const result: VoiceSweepResult = { deleted: [], lateDeliveryPending: [] };
  for (const session of sessions) {
    const outcome = await sweepOneVoiceSession({ boxRoot, session, now });
    if (outcome.deleted) result.deleted.push(session.id);
    if (outcome.lateDeliveryPending) result.lateDeliveryPending.push(session.id);
  }
  return result;
}
